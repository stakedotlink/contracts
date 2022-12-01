// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "../OperatorVault.sol";

/**
 * @title Operator Vault V2 Mock
 * @notice Mocks contract for testing
 */
contract OperatorVaultV2Mock is OperatorVault {
    uint256 public version;

    function initializeV2(uint256 _version) public reinitializer(3) {
        version = _version;
    }

    function isUpgraded() external view returns (bool) {
        return true;
    }

    function getVersion() external view returns (uint) {
        return version;
    }
}
