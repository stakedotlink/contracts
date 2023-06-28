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

    uint256 private totalDeposits;
    uint256 private rewards;

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
            totalDeposits = getTotalDeposits();
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
        totalDeposits += _amount;
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
        stakeController.raiseAlert();

        uint256 rewardAmount = token.balanceOf(address(this));
        token.safeTransfer(vaultController, rewardAmount);
        rewards += (rewardAmount * IOperatorVCS(vaultController).operatorRewardPercentage()) / 10000;

        emit AlertRaised();
    }

    /**
     * @notice returns the total amount of unclaimed operator rewards for this vault
     * @return total unclaimed rewards
     */
    function getRewards() public view returns (uint256) {
        uint256 curTotalDeposits = getTotalDeposits();
        uint256 totalRewards = rewards;

        if (curTotalDeposits > totalDeposits) {
            totalRewards +=
                ((curTotalDeposits - totalDeposits) * IOperatorVCS(vaultController).operatorRewardPercentage()) /
                10000;
        }

        return totalRewards;
    }

    /**
     * @notice withdraws the unclaimed operator rewards for this vault
     * @dev
     * - will attempt to withdraw all rewards but will partially withdraw if
     *   there are not enough rewards available in vaultController
     * - reverts if sender is not rewardsReceiver
     */
    function withdrawRewards() external onlyRewardsReceiver {
        uint256 curRewards = getRewards();
        uint256 withdrawnRewards = IOperatorVCS(vaultController).withdrawVaultRewards(rewardsReceiver, curRewards);

        rewards = curRewards - withdrawnRewards;
        totalDeposits = getTotalDeposits();

        emit WithdrawRewards(rewardsReceiver, withdrawnRewards);
    }

    /**
     * @notice updates the operator rewards accounting for this vault
     * @dev called by vaultController before operatorRewardPercentage is changed to
     * credit any past rewards at the old rate
     */
    function updateRewards() external {
        rewards = getRewards();
        totalDeposits = getTotalDeposits();
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
