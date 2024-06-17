// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../../core/interfaces/IERC677.sol";
import "../interfaces/IStaking.sol";
import "../interfaces/IStakingRewards.sol";

/**
 * @title Vault
 * @notice Base vault contract for depositing LINK collateral into the Chainlink staking controller
 */
abstract contract Vault is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    IERC20Upgradeable public token;
    address public vaultController;
    IStaking public stakeController;
    IStakingRewards public rewardsController;

    uint256[9] private __gap;

    error OnlyVaultController();

    /**
     * @notice Initializes contract
     * @param _token address of LINK token
     * @param _vaultController address of the strategy that controls this vault
     * @param _stakeController address of Chainlink staking contract
     * @param _rewardsController address of Chainlink staking rewards contract
     **/
    function __Vault_init(
        address _token,
        address _vaultController,
        address _stakeController,
        address _rewardsController
    ) public onlyInitializing {
        __Ownable_init();
        __UUPSUpgradeable_init();
        token = IERC20Upgradeable(_token);
        vaultController = _vaultController;
        stakeController = IStaking(_stakeController);
        rewardsController = IStakingRewards(_rewardsController);
    }

    /**
     * @notice Reverts if sender is not vault controller
     **/
    modifier onlyVaultController() {
        if (msg.sender != vaultController) revert OnlyVaultController();
        _;
    }

    /**
     * @notice Deposits tokens from the vault controller into the Chainlink staking contract
     * @param _amount amount to deposit
     */
    function deposit(uint256 _amount) external virtual onlyVaultController {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        IERC677(address(token)).transferAndCall(address(stakeController), _amount, "");
    }

    /**
     * @notice Withdraws tokens from the Chainlink staking contract and sends them to the vault controller
     * @param _amount amount to withdraw
     */
    function withdraw(uint256 _amount) external virtual onlyVaultController {
        stakeController.unstake(_amount, false);
        token.safeTransfer(vaultController, _amount);
    }

    /**
     * @notice Unbonds tokens in the Chainlink staking contract
     */
    function unbond() external onlyVaultController {
        stakeController.unbond();
    }

    /**
     * @notice Returns the total balance of this contract in the Chainlink staking contract
     * @dev includes principal plus any rewards
     * @return total balance
     */
    function getTotalDeposits() public view returns (uint256) {
        return getPrincipalDeposits() + getRewards();
    }

    /**
     * @notice Returns the principal balance of this contract in the Chainlink staking contract
     * @return principal balance
     */
    function getPrincipalDeposits() public view virtual returns (uint256) {
        return stakeController.getStakerPrincipal(address(this));
    }

    /**
     * @notice Returns the claimable rewards balance of this contract in the Chainlink staking rewards contract
     * @return rewards balance
     */
    function getRewards() public view returns (uint256) {
        return rewardsController.getReward(address(this));
    }

    /**
     * @notice Returns whether the unbonding or claim period is active for this contract in the Chainlink staking contract
     * @return rewards balance
     */
    function unbondingActive() external view returns (bool) {
        return block.timestamp < stakeController.getClaimPeriodEndsAt(address(this));
    }

    /**
     * @dev Checks authorization for contract upgrades
     */
    function _authorizeUpgrade(address) internal override onlyOwner {}
}
