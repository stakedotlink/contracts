// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

interface IFeeAdapter {
    function getFee(uint256 _lsdAmountToSwap, uint256 _underlyingValue) external view returns (uint256);
}
