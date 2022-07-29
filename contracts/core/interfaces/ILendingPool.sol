// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

interface ILendingPool {
    function currentRate(address _token, uint16 _index) external view returns (uint256);
}
