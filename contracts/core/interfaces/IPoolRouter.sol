// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

interface IPoolRouter {
    function allowanceInUse(address _token, uint16 _index) external view returns (uint);

    function maxAllowanceInUse() external view returns (uint);
}
