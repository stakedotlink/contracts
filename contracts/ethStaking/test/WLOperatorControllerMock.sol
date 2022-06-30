// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";

import "../interfaces/IOperatorController.sol";

/**
 * @title ETH Staking Node Operator Controller Mock
 * @notice Mocks contract for testing
 */
contract WLOperatorControllerMock is IOperatorController {
    uint public constant PUBKEY_LENGTH = 48;
    uint public constant SIGNATURE_LENGTH = 96;

    bytes public pubkeys;
    bytes public signatures;

    uint public addedKeys;
    uint public activeKeys;

    constructor(bytes memory _pubkeys, bytes memory _signatures) {
        require(_pubkeys.length % PUBKEY_LENGTH == 0, "Invalid pubkeys");
        require(_signatures.length % SIGNATURE_LENGTH == 0, "Invalid signatures");
        require(
            _pubkeys.length / PUBKEY_LENGTH == _signatures.length / SIGNATURE_LENGTH,
            "Inconsistent # of pubkeys and signatures"
        );
        pubkeys = _pubkeys;
        signatures = _signatures;
        addedKeys = _pubkeys.length / PUBKEY_LENGTH;
    }

    function onTokenTransfer(
        address _sender,
        uint256 _value,
        bytes calldata _data
    ) external {}

    function assignNextValidators(uint _numValidators) external virtual returns (bytes memory, bytes memory) {
        if (addedKeys == activeKeys) {
            return (new bytes(0), new bytes(0));
        }

        uint toAssign = Math.min(_numValidators, addedKeys - activeKeys);

        bytes memory retPubkeys = BytesLib.slice(pubkeys, activeKeys * PUBKEY_LENGTH, toAssign * PUBKEY_LENGTH);
        bytes memory retSignatures = BytesLib.slice(signatures, activeKeys * SIGNATURE_LENGTH, toAssign * SIGNATURE_LENGTH);

        activeKeys += toAssign;

        return (retPubkeys, retSignatures);
    }

    function activeValidators() external view returns (uint) {
        return activeKeys;
    }
}
