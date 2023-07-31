// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "./base/Vault.sol";
import "./interfaces/IOperatorVCS.sol";

/**
 * @title Operator Vault
 * @notice Vault contract for depositing LINK collateral into the Chainlink staking controller as an operator -
 * each vault represent a single operator
 */
contract OperatorVault is Vault {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    address public operator;
    address public rewardsReceiver;

    uint128 public trackedTotalDeposits;
    uint128 private unclaimedRewards;

    event AlertRaised();
    event WithdrawRewards(address indexed receiver, uint256 amount);

    error OnlyOperator();
    error OnlyRewardsReceiver();
    error ZeroAddress();
    error OperatorAlreadySet();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice initializes contract
     * @param _token address of LINK token
     * @param _vaultController address of the strategy that controls this vault
     * @param _stakeController address of Chainlink staking contract
     * @param _operator address of operator represented by this vault
     * @param _rewardsReceiver address authorized to claim rewards from this vault
     **/
    function initialize(
        address _token,
        address _vaultController,
        address _stakeController,
        address _operator,
        address _rewardsReceiver
    ) public reinitializer(3) {
        if (operator == address(0)) {
            __Vault_init(_token, _vaultController, _stakeController);
            setOperator(_operator);
        } else {
            trackedTotalDeposits = uint128(getTotalDeposits());
        }
        rewardsReceiver = _rewardsReceiver;
    }

    /**
     * @notice reverts if sender is not operator
     **/
    modifier onlyOperator() {
        if (msg.sender != operator) revert OnlyOperator();
        _;
    }

    /**
     * @notice reverts if sender is not rewardsReceiver
     **/
    modifier onlyRewardsReceiver() {
        if (msg.sender != rewardsReceiver) revert OnlyRewardsReceiver();
        _;
    }

    /**
     * @notice deposits tokens from the vaultController into the Chainlink staking contract
     * @dev reverts if sender is not vaultController
     * @param _amount amount to deposit
     */
    function deposit(uint256 _amount) external override onlyVaultController {
        trackedTotalDeposits += uint128(_amount);
        token.safeTransferFrom(msg.sender, address(this), _amount);
        IERC677(address(token)).transferAndCall(address(stakeController), _amount, "0x00");
    }

    /**
     * @notice returns the total balance of this contract in the Chainlink staking contract
     * @dev includes principal plus any rewards
     * @return total balance
     */
    function getTotalDeposits() public view override returns (uint256) {
        return
            stakeController.getStake(address(this)) +
            stakeController.getBaseReward(address(this)) +
            stakeController.getDelegationReward(address(this));
    }

    /**
     * @notice raises an alert in the Chainlink staking contract
     * @dev reverts if sender is not operator
     */
    function raiseAlert() external onlyOperator {
        uint256 prevBalance = token.balanceOf(address(this));

        stakeController.raiseAlert();

        uint256 rewards = token.balanceOf(address(this)) - prevBalance;
        uint256 opRewards = (rewards * IOperatorVCS(vaultController).operatorRewardPercentage()) / 10000;
        token.safeTransfer(vaultController, rewards - opRewards);

        emit AlertRaised();
    }

    function getUnclaimedRewards() public view returns (uint256) {
        return unclaimedRewards + token.balanceOf(address(this));
    }

    /**
     * @notice withdraws the unclaimed operator rewards for this vault
     * @dev reverts if sender is not rewardsReceiver
     */
    function withdrawRewards() external onlyRewardsReceiver {
        uint256 rewards = getUnclaimedRewards();
        uint256 balance = token.balanceOf(address(this));

        uint256 amountWithdrawn = IOperatorVCS(vaultController).withdrawOperatorRewards(rewardsReceiver, rewards - balance);
        unclaimedRewards -= uint128(amountWithdrawn);

        if (balance != 0) {
            token.safeTransfer(rewardsReceiver, balance);
        }

        emit WithdrawRewards(rewardsReceiver, amountWithdrawn + balance);
    }

    function getPendingRewards() public view returns (uint256) {
        int256 depositChange = int256(getTotalDeposits()) - int256(uint256(trackedTotalDeposits));

        if (depositChange > 0) {
            return (uint256(depositChange) * IOperatorVCS(vaultController).operatorRewardPercentage()) / 10000;
        }

        return 0;
    }

    function updateDeposits() external onlyVaultController returns (uint256, uint256) {
        uint256 totalDeposits = getTotalDeposits();
        int256 depositChange = int256(totalDeposits) - int256(uint256(trackedTotalDeposits));

        if (depositChange > 0) {
            uint256 rewards = (uint256(depositChange) * IOperatorVCS(vaultController).operatorRewardPercentage()) / 10000;
            unclaimedRewards += uint128(rewards);
            trackedTotalDeposits = uint128(totalDeposits);
            return (totalDeposits, rewards);
        }

        return (totalDeposits, 0);
    }

    /**
     * @notice sets the operator address if not already set
     * @dev
     * - only used for original vaults that are already deployed and don't have an operator set
     * - reverts is operator is already set
     * - reverts if `_operator` is zero adddress
     * - reverts if sender is not owner
     * @param _operator operator address
     */
    function setOperator(address _operator) public onlyOwner {
        if (operator != address(0)) revert OperatorAlreadySet();
        if (_operator == address(0)) revert ZeroAddress();
        operator = _operator;
    }

    /**
     * @notice sets the rewards receiver
     * @dev
     * - this address is authorized to withdraw rewards for this vault and/or change the rewardsReceiver
     * to a new a address
     * - reverts if rewardsReceiver is set and sender is not rewardsReceiver
     * - reverts if rewardsReceiver is not set and sender is not owner
     * - reverts if `_rewardsReceiver` is zero address
     * @param _rewardsReceiver rewards receiver address
     */
    function setRewardsReceiver(address _rewardsReceiver) public {
        if (rewardsReceiver != address(0) && msg.sender != rewardsReceiver) revert OnlyRewardsReceiver();
        if (rewardsReceiver == address(0) && msg.sender != owner()) revert OnlyRewardsReceiver();
        if (_rewardsReceiver == address(0)) revert ZeroAddress();
        rewardsReceiver = _rewardsReceiver;
    }
}
