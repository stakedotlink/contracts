// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "./OperatorControllerMock.sol";

/**
 * @title Operator Controller Mock V2
 * @notice Mocks contract upgrade for testing
 */
contract OperatorControllerMockV2 is OperatorControllerMock {
    function contractVersion() external pure returns (uint) {
        return 2;
    }
}
