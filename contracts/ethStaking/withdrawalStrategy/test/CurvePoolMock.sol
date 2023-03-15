// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

/**
 * @title Curve Pool Mock
 * @notice Mocks contract for testing
 */
contract CurvePoolMock {
    uint256 private dy;

    constructor(uint256 _dy) {
        dy = _dy;
    }

    function get_dy(
        int128,
        int128,
        uint256
    ) external view returns (uint256) {
        return dy;
    }

    function setDy(uint256 _dy) external {
        dy = _dy;
    }
}
