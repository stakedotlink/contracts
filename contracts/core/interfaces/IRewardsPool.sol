// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "./IERC677.sol";

interface IRewardsPool is IERC677 {
    function updateReward(address _account) external;

    function withdraw(address _account) external;

    function distributeRewards() external;
}
