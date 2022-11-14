// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

interface IOperatorVault {
    function deposit(uint _amount) external;

    function withdraw(uint _amount) external view;

    function totalBalance() external view returns (uint);

    function totalDeposits() external view returns (uint);
}
