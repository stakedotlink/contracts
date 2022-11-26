// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

interface IVault {
    function deposit(uint _amount) external;

    function withdraw(uint _amount) external view;

    function getTotalDeposits() external view returns (uint);

    function getPrincipalDeposits() external view returns (uint);

    function migrate(bytes calldata _data) external;
}
