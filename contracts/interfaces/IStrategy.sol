// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;

interface IStrategy {
    function deposit(uint256 _amount) external;

    function withdraw(uint256 _amount) external;

    function updateDeposits() external returns (address[] memory receivers, uint[] memory amounts);

    function setDepositsMin(uint256 _depositsMin) external;

    function setDepositsMax(uint256 _depositsMax) external;

    function totalDeposits() external view returns (uint256);

    function canDeposit() external view returns (uint256);

    function canWithdraw() external view returns (uint256);

    function depositChange() external view returns (int256);
}
