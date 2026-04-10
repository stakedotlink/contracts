// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

import "../interfaces/IStakingVaultHub.sol";

contract StakingVaultHubMock is IStakingVaultHub {
    bool public connected;
    bool public healthy = true;
    bool public fresh = true;
    bool public quarantined;
    bool public feesOverdue;
    uint256 public lockedAmountValue;
    uint256 public stakeableAmount = type(uint256).max;
    uint256 public withdrawableAmount = type(uint256).max;

    uint256 public lastReportedValue;
    int256 public inOutDelta;

    receive() external payable {}

    function mintLST(address, address, uint256) external {}
    function burnLST(address, uint256) external {}

    function updateVaultValue(uint256 _value) external {
        lastReportedValue = _value;
    }

    function recordDeposit(uint256 _amount) external {
        inOutDelta += int256(_amount);
    }

    function recordWithdrawal(uint256 _amount) external {
        inOutDelta -= int256(_amount);
    }

    function lockedAmount(address) external view returns (uint256) {
        return lockedAmountValue;
    }

    function isFresh(address) external view returns (bool) {
        return fresh;
    }

    function isHealthy(address) external view returns (bool) {
        return healthy;
    }

    function isQuarantined(address) external view returns (bool) {
        return quarantined;
    }

    function isConnected(address) external view returns (bool) {
        return connected;
    }

    function canStake(address) external view returns (uint256) {
        return stakeableAmount;
    }

    function canWithdraw(address) external view returns (uint256) {
        return withdrawableAmount;
    }

    function isFeesOverdue(address) external view returns (bool) {
        return feesOverdue;
    }

    // --- Test setters ---

    function setConnected(bool _connected) external {
        connected = _connected;
    }

    function setHealthy(bool _healthy) external {
        healthy = _healthy;
    }

    function setFresh(bool _fresh) external {
        fresh = _fresh;
    }

    function setQuarantined(bool _quarantined) external {
        quarantined = _quarantined;
    }

    function setFeesOverdue(bool _feesOverdue) external {
        feesOverdue = _feesOverdue;
    }

    function setLockedAmount(uint256 _lockedAmount) external {
        lockedAmountValue = _lockedAmount;
    }

    function setStakeableAmount(uint256 _stakeableAmount) external {
        stakeableAmount = _stakeableAmount;
    }

    function setWithdrawableAmount(uint256 _withdrawableAmount) external {
        withdrawableAmount = _withdrawableAmount;
    }
}
