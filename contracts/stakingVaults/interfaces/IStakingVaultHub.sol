// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

interface IStakingVaultHub {
    /// @notice Mint LST against vault collateral
    function mintLST(address _vault, address _recipient, uint256 _amount) external;

    /// @notice Burn LST to reduce vault liability
    function burnLST(address _vault, uint256 _amount) external;

    /// @notice Update the caller vault's reported total value
    function updateVaultValue(uint256 _value) external;

    /// @notice Record a deposit into the caller vault (increases inOutDelta)
    function recordDeposit(uint256 _amount) external;

    /// @notice Record a withdrawal from the caller vault (decreases inOutDelta)
    function recordWithdrawal(uint256 _amount) external;

    /// @notice Get the amount of tokens locked as collateral for minted LST
    function lockedAmount(address _vault) external view returns (uint256);

    /// @notice Check if vault's value report is fresh (not stale)
    function isFresh(address _vault) external view returns (bool);

    /// @notice Check if vault is healthy (above force rebalance threshold)
    function isHealthy(address _vault) external view returns (bool);

    /// @notice Check if vault is quarantined
    function isQuarantined(address _vault) external view returns (bool);

    /// @notice Check if vault is connected to the hub
    function isConnected(address _vault) external view returns (bool);

    /// @notice Get the maximum amount the vault can stake (respects idle reserve and fee status)
    function canStake(address _vault) external view returns (uint256);

    /// @notice Get the maximum amount the vault can withdraw (respects health, freshness, quarantine, fees, and locked amount)
    function canWithdraw(address _vault) external view returns (uint256);

    /// @notice Check if a vault's fees are overdue
    function isFeesOverdue(address _vault) external view returns (bool);
}
