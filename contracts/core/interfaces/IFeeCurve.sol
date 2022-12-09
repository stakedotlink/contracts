// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

interface IFeeCurve {
    function currentRate(uint256 _percentageBorrowed) external view returns (uint256);
}
