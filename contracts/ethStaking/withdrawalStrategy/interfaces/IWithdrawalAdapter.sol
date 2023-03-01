// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

interface IWithdrawalAdapter {
    function getTotalDeposits() external view returns (uint256);
}
