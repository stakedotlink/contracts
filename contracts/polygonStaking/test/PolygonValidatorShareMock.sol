// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "../interfaces/IPolygonStakeManager.sol";

interface IPolygonStakeManagerMock is IPolygonStakeManager {
    function deposit(address _account, uint256 _amount) external;

    function withdraw(address _account, uint256 _amount) external;
}

/**
 * @title Polygon Validator Share Mock
 * @notice Mocks contract for testing
 */
contract PolygonValidatorShareMock {
    struct Delegator {
        uint256 shares;
        uint256 withdrawEpoch;
    }

    IPolygonStakeManagerMock public stakeManager;
    mapping(address => uint256) private staked;
    mapping(address => uint256) private liquidRewards;
    mapping(address => Delegator) public delegators;

    error ZeroBalance();
    error IncompleteWithdrawalPeriod();

    constructor(address _stakeManager) {
        stakeManager = IPolygonStakeManagerMock(_stakeManager);
    }

    function buyVoucher(uint256 _amount, uint256) external {
        stakeManager.deposit(msg.sender, _amount);
        staked[msg.sender] += _amount;
    }

    function sellVoucher(uint256) external {
        uint256 amount = staked[msg.sender];
        if (staked[msg.sender] == 0) revert ZeroBalance();

        delete staked[msg.sender];
        delegators[msg.sender] = Delegator(amount, block.timestamp);

        uint256 rewards = liquidRewards[msg.sender];
        if (rewards != 0) {
            delete liquidRewards[msg.sender];
            stakeManager.withdraw(msg.sender, rewards);
        }
    }

    function unstakeClaimTokens() external {
        Delegator memory delegator = delegators[msg.sender];

        uint256 shares = delegator.shares;
        if (
            delegator.withdrawEpoch + stakeManager.withdrawalDelay() > stakeManager.epoch() ||
            shares == 0
        ) revert IncompleteWithdrawalPeriod();

        delete delegators[msg.sender];
        stakeManager.withdraw(msg.sender, shares);
    }

    function restake() external {
        uint256 rewards = liquidRewards[msg.sender];
        if (rewards == 0) revert ZeroBalance();

        delete liquidRewards[msg.sender];
        staked[msg.sender] += rewards;
    }

    function withdrawRewards() external {
        uint256 rewards = liquidRewards[msg.sender];
        if (rewards == 0) revert ZeroBalance();

        delete liquidRewards[msg.sender];
        stakeManager.withdraw(msg.sender, rewards);
    }

    function getLiquidRewards(address _user) external view returns (uint256) {
        return liquidRewards[_user];
    }

    function balanceOf(address _user) external view returns (uint256) {
        return staked[_user];
    }

    function exchangeRate() external pure returns (uint256) {
        return 1;
    }

    function withdrawExchangeRate() external pure returns (uint256) {
        return 1;
    }

    function addReward(address _user, uint256 _amount) external {
        liquidRewards[_user] += _amount;
        stakeManager.deposit(msg.sender, _amount);
    }
}
