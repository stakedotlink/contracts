// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;

import "./IERC677.sol";

interface IRewardsPool is IERC677 {
    function updateReward(address _account) external;
}
