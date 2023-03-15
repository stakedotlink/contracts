// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts/access/Ownable.sol";

import "../interfaces/IFeeAdapter.sol";
import "../interfaces/ICurvePool.sol";

/**
 * @title Curve Fee
 * @notice Interfaces with Curve to fetch current swap fees
 */
contract CurveFee is IFeeAdapter, Ownable {
    ICurvePool public curvePool;
    int128 public fromIndex;
    int128 public toIndex;

    uint256 public minFeeBasisPoints;

    error InvalidMinFeeBasisPoints();

    constructor(
        address _curvePool,
        int128 _fromIndex,
        int128 _toIndex,
        uint256 _minFeeBasisPoints
    ) {
        curvePool = ICurvePool(_curvePool);
        fromIndex = _fromIndex;
        toIndex = _toIndex;
        minFeeBasisPoints = _minFeeBasisPoints;
    }

    function getFee(uint256 _lsdAmountToSwap, uint256 _underlyingValue) external view returns (uint256) {
        uint256 amountReceived = curvePool.get_dy(fromIndex, toIndex, _lsdAmountToSwap);
        uint256 minFee = (_underlyingValue * minFeeBasisPoints) / 10000;
        uint256 fee;

        if (amountReceived < _underlyingValue) {
            fee = _underlyingValue - amountReceived;
        }

        if (fee < minFee) {
            return minFee;
        } else {
            return fee;
        }
    }

    function setMinFeeBasisPoints(uint256 _minFeeBasisPoints) public onlyOwner {
        if (_minFeeBasisPoints > 500) revert InvalidMinFeeBasisPoints();
        minFeeBasisPoints = _minFeeBasisPoints;
    }
}
