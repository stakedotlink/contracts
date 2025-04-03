// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "./interfaces/IPolygonStakeManager.sol";
import "./interfaces/IPolygonStaking.sol";

/**
 * @title Polygon Vault
 * @notice Manages deposits of POL into a validator delegation contract
 */
contract PolygonVault is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // address of staking token
    IERC20Upgradeable public token;
    // address of strategy that controls this vault
    address public vaultController;
    // address of Polygon stake manager
    IPolygonStakeManager public stakeManager;
    // address of Polygon delegation contract for this vault's validator
    IPolygonStaking public validatorPool;

    error OnlyVaultController();
    error UnbondingInProgress();

    /**
     * @notice Initializes contract
     * @param _token address of POL token
     * @param _vaultController address of strategy that controls this vault
     * @param _stakeManager address of Polygon stake manager
     * @param _validatorPool address of Polygon delegation contract for this vault's validator
     **/
    function initialize(
        address _token,
        address _vaultController,
        address _stakeManager,
        address _validatorPool
    ) public initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();
        token = IERC20Upgradeable(_token);
        vaultController = _vaultController;
        stakeManager = IPolygonStakeManager(_stakeManager);
        validatorPool = IPolygonStaking(_validatorPool);
        token.safeApprove(_stakeManager, type(uint256).max);
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
        validatorPool.buyVoucherPOL(_amount, 0);

        uint256 balance = token.balanceOf(address(this));
        if (balance != 0) token.safeTransfer(msg.sender, balance);
    }

    /**
     * @notice Withdraws tokens from the validator pool and sends them to the vault controller
     */
    function withdraw() external onlyVaultController returns (uint256) {
        validatorPool.unstakeClaimTokensPOL();
        uint256 amount = token.balanceOf(address(this));
        token.safeTransfer(msg.sender, amount);
        return amount;
    }

    /**
     * @notice Queues tokens for withdrawal in the validator pool
     * @param _amount amount to unbond
     */
    function unbond(uint256 _amount) external onlyVaultController {
        (uint256 shares, ) = validatorPool.unbonds(address(this));
        if (shares != 0) revert UnbondingInProgress();

        validatorPool.sellVoucherPOL(_amount, type(uint256).max);
    }

    /**
     * @notice Restakes rewards in the validator pool
     **/
    function restakeRewards() external {
        validatorPool.restakePOL();
    }

    /**
     * @notice Returns the total balance of this contract
     * @dev includes principal, rewards, queued withdrawals, and tokens sitting in this contract
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
        return validatorPool.balanceOf(address(this)) * validatorPool.exchangeRate();
    }

    /**
     * @notice Returns the claimable rewards balance of this contract in the validator pool
     * @return rewards balance
     */
    function getRewards() public view returns (uint256) {
        return validatorPool.getLiquidRewards(address(this));
    }

    /**
     * @notice Returns the amount of queued withdrawals for this contract in the validator pool
     * @return amount of queued withdrawals
     */
    function getQueuedWithdrawals() public view returns (uint256) {
        (uint256 shares, ) = validatorPool.unbonds(address(this));
        return shares * validatorPool.withdrawExchangeRate();
    }

    /**
     * @notice Returns whether deposits can be withdrawn from the validator pool
     * @return whether deposits can be withdrawn
     */
    function isWithdrawable() external view returns (bool) {
        (uint256 shares, uint256 withdrawEpoch) = validatorPool.unbonds(address(this));
        return
            shares != 0 && stakeManager.epoch() >= (withdrawEpoch + stakeManager.withdrawalDelay());
    }

    /**
     * @notice Returns whether this vault is currently unbonding
     * @return whether vault is unbonding
     */
    function isUnbonding() external view returns (bool) {
        (, uint256 withdrawEpoch) = validatorPool.unbonds(address(this));
        return stakeManager.epoch() < (withdrawEpoch + stakeManager.withdrawalDelay());
    }

    /**
     * @dev Checks authorization for contract upgrades
     */
    function _authorizeUpgrade(address) internal override onlyOwner {}
}
