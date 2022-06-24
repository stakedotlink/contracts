// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;

import "../interfaces/IOperatorController.sol";

/**
 * @title ETH Staking Node Operator Controller Mock
 * @notice Mocks contract for testing
 */
contract OperatorControllerMock {
    uint public constant PUBKEY_LENGTH = 48;
    uint public constant SIGNATURE_LENGTH = 96;

    bytes public pubkeys;
    bytes public signatures;

    constructor(bytes memory _pubkeys, bytes memory _signatures) {
        require(_pubkeys.length % PUBKEY_LENGTH == 0, "Invalid pubkeys");
        require(signatures.length % SIGNATURE_LENGTH == 0, "Invalid signatures");
        require(
            _pubkeys.length / PUBKEY_LENGTH == signatures.length / SIGNATURE_LENGTH,
            "Inconsistent # of pubkeys and signatures"
        );
        pubkeys = _pubkeys;
        signatures = _signatures;
    }
}
