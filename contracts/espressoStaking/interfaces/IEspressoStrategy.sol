// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

interface IEspressoStrategy {
    function depositQueuedTokens(
        uint256[] calldata _vaultIds,
        uint256[] calldata _amounts
    ) external;

    function unbond(uint256 _toUnbond) external;

    function forceUnbond(uint256[] calldata _vaultIds, uint256[] calldata _amounts) external;

    function claimUnbond(uint256[] calldata _vaultIds) external;

    function restakeRewards(
        uint256[] calldata _vaultIds,
        uint256[] calldata _lifetimeRewards,
        bytes[] calldata _authData
    ) external;

    function totalQueued() external view returns (uint256);

    function getVaults() external view returns (address[] memory);

    function numVaultsUnbonding() external view returns (uint256);
}
