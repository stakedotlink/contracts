// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "./IStakingRewardsPool.sol";

interface IStakingPool is IStakingRewardsPool {
    function stake(address _account, uint256 _amount) external;

    function withdraw(
        address _account,
        address _receiver,
        uint256 _amount
    ) external;

    function strategyDeposit(uint256 _index, uint256 _amount) external;

    function strategyWithdraw(uint256 _index, uint256 _amount) external;

    function updateStrategyRewards(uint256[] memory _strategyIdxs) external;

    function getMaxDeposits() external view returns (uint256);

    function addStrategy(address _strategy) external;

    function removeStrategy(uint256 _index) external;

    function reorderStrategies(uint256[] calldata _newOrder) external;

    function getStrategies() external view returns (address[] memory);

    function setPoolIndex(uint16 _poolIndex) external;

    function canDeposit() external view returns (uint256);
}
