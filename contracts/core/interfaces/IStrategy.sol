// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

interface IStrategy {
    function deposit(uint256 _amount) external;

    function withdraw(uint256 _amount) external;

    function updateDeposits() external returns (address[] memory receivers, uint[] memory amounts);

    function totalDeposits() external view returns (uint256);

    function maxDeposits() external view returns (uint256);

    function minDeposits() external view returns (uint256);

    function canDeposit() external view returns (uint256);

    function canWithdraw() external view returns (uint256);

    function depositChange() external view returns (int256);
}
