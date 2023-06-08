// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "./base/Vault.sol";
import "./interfaces/IOperatorVCS.sol";

/**
 * @title Operator Vault
 * @notice Vault contract for depositing LINK collateral into the Chainlink staking controller as an operator
 */
contract OperatorVault is Vault {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    address public operator;
    address public rewardsReceiver;

    uint256 private totalDeposits;
    uint256 private rewards;

    event AlertRaised();

    error OnlyOperator();
    error OnlyRewardsReceiver();
    error ZeroAddress();
    error OperatorAlreadySet();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

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

    modifier onlyOperator() {
        if (msg.sender != operator) revert OnlyOperator();
        _;
    }

    modifier onlyRewardsReceiver() {
        if (msg.sender != rewardsReceiver) revert OnlyRewardsReceiver();
        _;
    }

    /**
     * @notice deposits tokens into the Chainlink staking contract
     * @param _amount amount to deposit
     */
    function deposit(uint256 _amount) external override onlyVaultController {
        totalDeposits += _amount;
        token.safeTransferFrom(msg.sender, address(this), _amount);
        IERC677(address(token)).transferAndCall(address(stakeController), _amount, "0x00");
    }

    /**
     * @notice returns the total balance of this contract in the Chainlink staking contract
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
     */
    function raiseAlert() external onlyOperator {
        stakeController.raiseAlert();

        uint256 rewardAmount = token.balanceOf(address(this));
        token.safeTransfer(vaultController, rewardAmount);
        rewards += (rewardAmount * IOperatorVCS(vaultController).operatorRewardPercentage()) / 10000;

        emit AlertRaised();
    }

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

    function withdrawRewards() external onlyRewardsReceiver {
        uint256 curTotalDeposits = getTotalDeposits();
        uint256 newRewards;

        if (curTotalDeposits > totalDeposits) {
            newRewards =
                ((curTotalDeposits - totalDeposits) * IOperatorVCS(vaultController).operatorRewardPercentage()) /
                10000;
        }

        uint256 curRewards = rewards + newRewards;
        uint256 withdrawnRewards = IOperatorVCS(vaultController).withdrawVaultRewards(rewardsReceiver, curRewards);

        rewards = curRewards - withdrawnRewards;
        totalDeposits = curTotalDeposits;
    }

    /**
     * @notice sets the operator address if not already set
     * @param _operator operator address
     */
    function setOperator(address _operator) public onlyOwner {
        if (operator != address(0)) revert OperatorAlreadySet();
        if (_operator == address(0)) revert ZeroAddress();
        operator = _operator;
    }

    function setRewardsReceiver(address _rewardsReceiver) public {
        if (rewardsReceiver != address(0) && msg.sender != rewardsReceiver) revert OnlyRewardsReceiver();
        if (rewardsReceiver == address(0) && msg.sender != owner()) revert OnlyRewardsReceiver();
        if (_rewardsReceiver == address(0)) revert ZeroAddress();
        rewardsReceiver = _rewardsReceiver;
    }
}
