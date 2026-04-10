// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

import "../interfaces/IStakingVaultFactory.sol";

contract StakingVaultFactoryMock is IStakingVaultFactory {
    mapping(address => bool) public deployedVaults;
    mapping(address => bool) public deployedAdapters;

    function setDeployedVault(address _vault, bool _deployed) external {
        deployedVaults[_vault] = _deployed;
    }

    function setDeployedAdapter(address _adapter, bool _deployed) external {
        deployedAdapters[_adapter] = _deployed;
    }
}
