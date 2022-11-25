// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

interface IStrategy {
    function deposit(uint256 _amount) external;

    function withdraw(uint256 _amount) external;

    function updateDeposits() external returns (address[] memory receivers, uint[] memory amounts);

    function getTotalDeposits() external view returns (uint256);

    function getMaxDeposits() external view returns (uint256);

    function getMinDeposits() external view returns (uint256);

    function canDeposit() external view returns (uint256);

    function canWithdraw() external view returns (uint256);

    function depositChange() external view returns (int256);
}
