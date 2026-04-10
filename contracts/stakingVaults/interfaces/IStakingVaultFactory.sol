// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

interface IStakingVaultFactory {
    /// @notice Whether the vault was deployed by this factory
    function deployedVaults(address vault) external view returns (bool);

    /// @notice Whether the adapter was deployed by this factory
    function deployedAdapters(address adapter) external view returns (bool);
}
