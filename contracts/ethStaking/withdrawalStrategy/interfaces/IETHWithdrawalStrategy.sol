// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

interface IETHWithdrawalStrategy {
    function availableDeposits() external view returns (uint256);

    function adapterDeposit() external payable;

    function adapterWithdraw(address _receiver, uint256 _amount) external;
}
