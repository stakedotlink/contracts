// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;

import "./IRewardsPool.sol";

interface IOwnersRewardsPool is IRewardsPool {
    function withdraw(address _account) external;
}
