// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";

import "./WLOperatorControllerMock.sol";

/**
 * @title ETH Staking Node Operator Controller Mock
 * @notice Mocks contract for testing
 */
contract NWLOperatorControllerMock is WLOperatorControllerMock {
    uint public constant DEPOSIT_AMOUNT = 16 ether;

    constructor(bytes memory _pubkeys, bytes memory _signatures) WLOperatorControllerMock(_pubkeys, _signatures) {}

    receive() external payable {}

    function assignNextValidators(uint _numValidators) external override returns (bytes memory, bytes memory) {
        if (addedKeys == activeKeys) {
            return (new bytes(0), new bytes(0));
        }

        uint toAssign = Math.min(_numValidators, addedKeys - activeKeys);

        bytes memory retPubkeys = BytesLib.slice(pubkeys, activeKeys * PUBKEY_LENGTH, toAssign * PUBKEY_LENGTH);
        bytes memory retSignatures = BytesLib.slice(signatures, activeKeys * SIGNATURE_LENGTH, toAssign * SIGNATURE_LENGTH);

        activeKeys += toAssign;

        (bool success, ) = payable(msg.sender).call{value: toAssign * DEPOSIT_AMOUNT}("");
        require(success, "ETH transfer failed");

        return (retPubkeys, retSignatures);
    }

    function activeStake() external view returns (uint) {
        return activeKeys * DEPOSIT_AMOUNT;
    }
}
