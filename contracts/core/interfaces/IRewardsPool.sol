// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

interface IRewardsPool {
    function updateReward(address _account) external;

    function withdraw(address _account) external;

    function distributeRewards() external;

    function withdrawableRewards(address _account) external view returns (uint);
}
