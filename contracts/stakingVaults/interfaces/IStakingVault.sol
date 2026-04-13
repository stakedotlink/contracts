// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

interface IStakingVault {
    /// @notice Get the vault owner
    function owner() external view returns (address);

    /// @notice Get the idle token balance sitting in the vault
    function idleBalance() external view returns (uint256);

    /// @notice Get the total value held across all adapters (principal + accrued rewards, excludes idle balance)
    function stakedBalance() external view returns (uint256);

    /// @notice Force unstake to restore vault health (called by VaultHub)
    function rebalance(uint256 _amount) external;
}
