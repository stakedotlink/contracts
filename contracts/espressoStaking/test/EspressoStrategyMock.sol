// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

import "../interfaces/IEspressoStrategy.sol";

/**
 * @title Espresso Strategy Mock
 * @notice Mock contract for testing EspressoRewardsConsumer
 */
contract EspressoStrategyMock is IEspressoStrategy {
    uint256[] public lastVaultIds;
    uint256[] public lastLifetimeRewards;
    uint256 public updateCount;

    function updateLifetimeRewards(
        uint256[] calldata _vaultIds,
        uint256[] calldata _lifetimeRewards
    ) external override {
        lastVaultIds = _vaultIds;
        lastLifetimeRewards = _lifetimeRewards;
        updateCount++;
    }

    function getLastVaultIds() external view returns (uint256[] memory) {
        return lastVaultIds;
    }

    function getLastLifetimeRewards() external view returns (uint256[] memory) {
        return lastLifetimeRewards;
    }

    function depositQueuedTokens(uint256[] calldata, uint256[] calldata) external override {}

    function unbond(uint256) external override {}

    function forceUnbond(uint256[] calldata, uint256[] calldata) external override {}

    function claimUnbond(uint256[] calldata) external override {}

    function restakeRewards(
        uint256[] calldata,
        uint256[] calldata,
        bytes[] calldata
    ) external override {}

    function withdrawRewards(
        uint256[] calldata,
        uint256[] calldata,
        bytes[] calldata
    ) external override {}

    function totalQueued() external pure override returns (uint256) {
        return 0;
    }

    function getVaults() external pure override returns (address[] memory) {
        return new address[](0);
    }

    function numVaultsUnbonding() external pure override returns (uint256) {
        return 0;
    }
}