// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "./IStakingRewardsPool.sol";

interface IBorrowingPool is IStakingRewardsPool {
    function stake(address _account, uint _amount) external;

    function withdraw(address _account, uint _amount) external;
}
