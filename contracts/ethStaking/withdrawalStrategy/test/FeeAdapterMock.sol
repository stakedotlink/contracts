// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

/**
 * @title Fee Adapter Mock
 * @notice Mocks contract for testing
 */
contract FeeAdapterMock {
    uint256 private fee;

    constructor(uint256 _fee) {
        fee = _fee;
    }

    function getFee(uint256, uint256) external view returns (uint256) {
        return fee;
    }

    function setFee(uint256 _fee) external {
        fee = _fee;
    }
}
