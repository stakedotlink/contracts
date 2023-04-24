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

    uint32 public minFeeBasisPoints;
    uint32 public maxFeeBasisPoints;
    uint32 public feeUndercutBasisPoints;

    event SetMinFeeBasisPoints(uint32 minFeeBasisPoints);
    event SetMaxFeeBasisPoints(uint32 maxFeeBasisPoints);
    event SetFeeUndercutBasisPoints(uint32 feeUndercutBasisPoints);

    error InvalidMinFeeBasisPoints();
    error InvalidMaxFeeBasisPoints();
    error InvalidFeeUndercutBasisPoints();

    constructor(
        address _curvePool,
        int128 _fromIndex,
        int128 _toIndex,
        uint32 _minFeeBasisPoints,
        uint32 _maxFeeBasisPoints,
        uint32 _feeUndercutBasisPoints
    ) {
        curvePool = ICurvePool(_curvePool);
        fromIndex = _fromIndex;
        toIndex = _toIndex;
        setMinFeeBasisPoints(_minFeeBasisPoints);
        setMaxFeeBasisPoints(_maxFeeBasisPoints);
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
        uint256 maxFee = (_underlyingValue * maxFeeBasisPoints) / BASIS_POINTS;
        uint256 fee;

        if (amountReceived < _underlyingValue) {
            fee = ((_underlyingValue - amountReceived) * (BASIS_POINTS - feeUndercutBasisPoints)) / BASIS_POINTS;
        }

        if (fee < minFee) {
            return minFee;
        } else if (fee > maxFee) {
            return maxFee;
        } else {
            return fee;
        }
    }

    /**
     * @notice sets the minimum fee basis point fee to be paid on withdrawals
     * @param _minFeeBasisPoints minimum basis point fee
     */
    function setMinFeeBasisPoints(uint32 _minFeeBasisPoints) public onlyOwner {
        if (_minFeeBasisPoints > 500) revert InvalidMinFeeBasisPoints();
        minFeeBasisPoints = _minFeeBasisPoints;
        emit SetMinFeeBasisPoints(_minFeeBasisPoints);
    }

    /**
     * @notice sets the maximum basis point fee to be paid on withdrawals
     * @param _maxFeeBasisPoints maximum basis point fee
     */
    function setMaxFeeBasisPoints(uint32 _maxFeeBasisPoints) public onlyOwner {
        if (_maxFeeBasisPoints > 3000) revert InvalidMaxFeeBasisPoints();
        maxFeeBasisPoints = _maxFeeBasisPoints;
        emit SetMaxFeeBasisPoints(_maxFeeBasisPoints);
    }

    /**
     * @notice sets the basis point amount to be subtracted off the current curve fee when
     * calculating a withdrawal fee
     * @param _feeUndercutBasisPoints basis point undercut amount
     */
    function setFeeUndercutBasisPoints(uint32 _feeUndercutBasisPoints) public onlyOwner {
        if (_feeUndercutBasisPoints > BASIS_POINTS) revert InvalidFeeUndercutBasisPoints();
        feeUndercutBasisPoints = _feeUndercutBasisPoints;
        emit SetFeeUndercutBasisPoints(_feeUndercutBasisPoints);
    }
}
