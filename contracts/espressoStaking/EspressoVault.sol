// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "./interfaces/IEspressoStaking.sol";
import "./interfaces/IEspressoRewards.sol";

/**
 * @title Espresso Vault
 * @notice Manages deposits of ESP into the validator delegation contract
 */
contract EspressoVault is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // address of ESP token
    IERC20Upgradeable public token;
    // address of strategy that controls this vault
    address public vaultController;
    // address of Espresso delegation contract
    IEspressoStaking public espressoStaking;
    // address of Espresso rewards contract
    IEspressoRewards public espressoRewards;
    // address of validator that this vault delegates to
    address public validator;

    // total lifetime rewards for this vault
    uint256 private lifetimeRewards;

    error OnlyVaultController();
    error InvalidLifetimeRewards();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes contract
     * @param _token address of ESP token
     * @param _vaultController address of strategy that controls this vault
     * @param _espressoStaking address of Espresso delegation contract
     * @param _espressoRewards address of Espresso rewards contract
     * @param _validator address of validator that this vault delegates to
     **/
    function initialize(
        address _token,
        address _vaultController,
        address _espressoStaking,
        address _espressoRewards,
        address _validator
    ) public initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();
        token = IERC20Upgradeable(_token);
        vaultController = _vaultController;
        espressoStaking = IEspressoStaking(_espressoStaking);
        espressoRewards = IEspressoRewards(_espressoRewards);
        validator = _validator;
        token.safeApprove(_espressoStaking, type(uint256).max);
    }

    /**
     * @notice Reverts if sender is not vault controller
     **/
    modifier onlyVaultController() {
        if (msg.sender != vaultController) revert OnlyVaultController();
        _;
    }

    /**
     * @notice Deposits tokens from the vault controller into the validator pool
     * @param _amount amount to deposit
     */
    function deposit(uint256 _amount) external onlyVaultController {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        espressoStaking.delegate(validator, _amount);
    }

    /**
     * @notice Withdraws tokens from the validator pool and sends them to the vault controller
     */
    function withdraw() external onlyVaultController returns (uint256) {
        espressoStaking.claimWithdrawal(validator);
        uint256 amount = token.balanceOf(address(this));
        token.safeTransfer(msg.sender, amount);
        return amount;
    }

    /**
     * @notice Queues tokens for withdrawal in the validator pool
     * @param _amount amount to withdraw
     */
    function unbond(uint256 _amount) external onlyVaultController {
        espressoStaking.undelegate(validator, _amount);
    }

    /**
     * @notice Restakes rewards in the validator pool
     * @param _lifetimeRewards total lifetime rewards for this vault
     * @param _authData authorization data for claiming rewards
     **/
    function restakeRewards(
        uint256 _lifetimeRewards,
        bytes calldata _authData
    ) external onlyVaultController {
        _updateLifetimeRewards(_lifetimeRewards);

        if (getRewards() != 0) {
            espressoRewards.claimRewards(_lifetimeRewards, _authData);

            uint256 balance = token.balanceOf(address(this));
            espressoStaking.delegate(validator, balance);
        }
    }

    /**
     * @notice Claims rewards from the validator pool and then transfers all rewards held by this contract to the vault controller
     * @param _lifetimeRewards total lifetime rewards for this vault
     * @param _authData authorization data for claiming rewards
     **/
    function withdrawRewards(
        uint256 _lifetimeRewards,
        bytes calldata _authData
    ) external onlyVaultController {
        _updateLifetimeRewards(_lifetimeRewards);

        if (getRewards() != 0) {
            espressoRewards.claimRewards(_lifetimeRewards, _authData);

            uint256 balance = token.balanceOf(address(this));
            token.safeTransfer(msg.sender, balance);
        }
    }

    /**
     * @notice Updates the lifetime rewards tracking for this vault
     * @dev Used to sync lifetime rewards which is fetched off chain
     * @param _lifetimeRewards new lifetime rewards value
     */
    function updateLifetimeRewards(uint256 _lifetimeRewards) external onlyVaultController {
        _updateLifetimeRewards(_lifetimeRewards);
    }

    /**
     * @notice Withdraws tokens from the validator pool and sends them to the vault controller
     * @dev used when a validator has exited
     **/
    function claimValidatorExit() external onlyVaultController {
        espressoStaking.claimValidatorExit(validator);

        uint256 balance = token.balanceOf(address(this));
        token.safeTransfer(msg.sender, balance);
    }

    /**
     * @notice Returns the total balance of this contract
     * @dev includes principal, rewards, queued withdrawals, and tokens held by this contract
     * @return total balance
     */
    function getTotalDeposits() public view returns (uint256) {
        return
            getPrincipalDeposits() +
            getRewards() +
            getQueuedWithdrawals() +
            token.balanceOf(address(this));
    }

    /**
     * @notice Returns the principal balance of this contract in the validator pool
     * @return principal balance
     */
    function getPrincipalDeposits() public view returns (uint256) {
        return espressoStaking.delegations(validator, address(this));
    }

    /**
     * @notice Returns the claimable rewards balance of this contract in the validator pool
     * @return rewards balance
     */
    function getRewards() public view returns (uint256) {
        return lifetimeRewards - espressoRewards.claimedRewards(address(this));
    }

    /**
     * @notice Returns the amount of queued withdrawals for this contract in the validator pool
     * @return amount of queued withdrawals
     */
    function getQueuedWithdrawals() public view returns (uint256) {
        (uint256 amount, ) = espressoStaking.undelegations(validator, address(this));
        return amount;
    }

    /**
     * @notice Returns whether deposits can be withdrawn from the validator pool
     * @return whether deposits can be withdrawn
     */
    function isWithdrawable() external view returns (bool) {
        (uint256 amount, uint256 unlocksAt) = espressoStaking.undelegations(
            validator,
            address(this)
        );
        return amount > 0 && block.timestamp >= unlocksAt;
    }

    /**
     * @notice Returns whether this vault is currently unbonding
     * @return whether vault is unbonding
     */
    function isUnbonding() external view returns (bool) {
        (uint256 amount, uint256 unlocksAt) = espressoStaking.undelegations(
            validator,
            address(this)
        );
        return amount > 0 && block.timestamp < unlocksAt;
    }

    /**
     * @notice Returns whether the validator this vault delegates to is active
     * @return whether validator is active
     */
    function isActive() external view returns (bool) {
        (, IEspressoStaking.ValidatorStatus status) = espressoStaking.validators(validator);
        return status == IEspressoStaking.ValidatorStatus.Active;
    }

    /**
     * @notice Updates the lifetime rewards tracking for this vault
     * @dev Used to sync lifetime rewards which is fetched off chain
     * @param _lifetimeRewards new lifetime rewards value
     */
    function _updateLifetimeRewards(uint256 _lifetimeRewards) internal {
        if (_lifetimeRewards < lifetimeRewards) revert InvalidLifetimeRewards();

        lifetimeRewards = _lifetimeRewards;
    }

    /**
     * @dev Checks authorization for contract upgrades
     */
    function _authorizeUpgrade(address) internal override onlyOwner {}
}
