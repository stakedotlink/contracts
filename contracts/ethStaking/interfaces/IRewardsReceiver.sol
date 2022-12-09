// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

interface IRewardsReceiver {
    function withdraw() external returns (uint256);
}
