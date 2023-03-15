// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

interface ICurvePool {
    /**
     * @notice Get the amount of coin j one would receive for swapping _dx of coin i
     */
    function get_dy(
        int128 i,
        int128 j,
        uint256 _dx
    ) external view returns (uint256);
}
