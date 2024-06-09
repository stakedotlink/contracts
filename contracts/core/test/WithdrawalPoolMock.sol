// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

contract WithdrawalPoolMock {
    uint256 internal totalQueuedWithdrawals;

    constructor(uint256 _totalQueuedWithdrawals) {
        totalQueuedWithdrawals = _totalQueuedWithdrawals;
    }

    function getTotalQueuedWithdrawals() external view returns (uint256) {
        return totalQueuedWithdrawals;
    }

    function setTotalQueuedWithdrawals(uint256 _totalQueuedWithdrawals) external {
        totalQueuedWithdrawals = _totalQueuedWithdrawals;
    }
}
