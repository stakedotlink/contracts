// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;

import "./IERC677.sol";

interface IPoolOwners is IERC677 {
    function staked(address _account) external view returns (uint);
}
