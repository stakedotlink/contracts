// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "./IStakingRewardsPool.sol";

interface IStakingPool is IStakingRewardsPool {
    function stake(address _account, uint256 _amount) external;

    function withdraw(address _account, uint256 _amount) external;

    function strategyDeposit(uint _index, uint256 _amount) external;

    function strategyWithdraw(uint _index, uint256 _amount) external;

    function updateStrategyRewards(uint[] memory _strategyIdxs) external;

    function maxDeposits() external view returns (uint256);

    function addStrategy(address _strategy) external;

    function removeStrategy(uint _index) external;

    function reorderStrategies(uint[] calldata _newOrder) external;

    function getStrategies() external view returns (address[] memory);
}
