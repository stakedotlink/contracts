// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;

import "./IStakingRewardsPool.sol";

interface IStakingPool {
    function stake(address _account, uint256 _amount) external;

    function withdraw(address _account, uint256 _amount) external;

    function strategyDeposit(uint8 _index, uint256 _amount) external;

    function strategyWithdraw(uint8 _index, uint256 _amount) external;

    function addStrategy(address _strategy) external;

    function removeStrategy(uint8 _index) external;

    function reorderStrategies(uint8[] calldata _newOrder) external;

    function setOwnersTakePercent(uint256 _ownersTakePercent) external;

    function setGovernance(address _governance) external;

    function strategies(uint8 _index) external view returns (address);

    function totalStrategies() external view returns (uint8);
}
