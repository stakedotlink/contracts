// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

interface IRewardsReceiver {
    function withdraw() external returns (uint256);
}
