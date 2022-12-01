// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

interface IVault {
    function deposit(uint256 _amount) external;

    function withdraw(uint256 _amount) external view;

    function getTotalDeposits() external view returns (uint);

    function getPrincipalDeposits() external view returns (uint);

    function migrate(bytes calldata _data) external;

    function upgradeToAndCall(address newImplementation, bytes memory data) external;

    function upgradeTo(address newImplementation) external;
}
