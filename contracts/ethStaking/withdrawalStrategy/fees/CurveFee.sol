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
    uint256 internal constant BASIS_POINTS = 10000;

    ICurvePool public curvePool;
    int128 public fromIndex;
    int128 public toIndex;

    uint256 public minFeeBasisPoints;
    uint256 public feeUndercutBasisPoints;

    error InvalidMinFeeBasisPoints();
    error InvalidFeeUndercutBasisPoints();

    constructor(
        address _curvePool,
        int128 _fromIndex,
        int128 _toIndex,
        uint256 _minFeeBasisPoints,
        uint256 _feeUndercutBasisPoints
    ) {
        curvePool = ICurvePool(_curvePool);
        fromIndex = _fromIndex;
        toIndex = _toIndex;
        setMinFeeBasisPoints(_minFeeBasisPoints);
        setFeeUndercutBasisPoints(_feeUndercutBasisPoints);
    }

    /**
     * @notice gets the fee for a withdrawal based on current curve fees
     * @param _lsdAmountToSwap amount of lsd tokens to swap
     * @param _underlyingValue underlying value of lsd tokens
     * @return fee amount
     */
    function getFee(uint256 _lsdAmountToSwap, uint256 _underlyingValue) external view returns (uint256) {
        uint256 amountReceived = curvePool.get_dy(fromIndex, toIndex, _lsdAmountToSwap);
        uint256 minFee = (_underlyingValue * minFeeBasisPoints) / BASIS_POINTS;
        uint256 fee;

        if (amountReceived < _underlyingValue) {
            fee = ((_underlyingValue - amountReceived) * (BASIS_POINTS - feeUndercutBasisPoints)) / BASIS_POINTS;
        }

        if (fee < minFee) {
            return minFee;
        } else {
            return fee;
        }
    }

    /**
     * @notice sets the minimum fee basis point fee to be paid on withdrawals
     * @param _minFeeBasisPoints minimum basis point fee
     */
    function setMinFeeBasisPoints(uint256 _minFeeBasisPoints) public onlyOwner {
        if (_minFeeBasisPoints > 500) revert InvalidMinFeeBasisPoints();
        minFeeBasisPoints = _minFeeBasisPoints;
    }

    /**
     * @notice sets the basis point amount to be subtracted off the current curve fee when
     * calculating a withdrawal fee
     * @param _feeUndercutBasisPoints basis point undercut amount
     */
    function setFeeUndercutBasisPoints(uint256 _feeUndercutBasisPoints) public onlyOwner {
        if (_feeUndercutBasisPoints > BASIS_POINTS) revert InvalidFeeUndercutBasisPoints();
        feeUndercutBasisPoints = _feeUndercutBasisPoints;
    }
}
