// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Flat Fee
 * @notice Sets a flat fee
 */
contract FlatFee is Ownable {
    uint256 public feeBasisPoints;

    event FeeSet(uint256 _feeBasisPoints);

    constructor(uint256 _feeBasisPoints) {
        feeBasisPoints = _feeBasisPoints;
    }

    /**
     * @notice sets the fee basis points
     * @param _feeBasisPoints
     **/
    function setFeeBasisPoints(uint256 _feeBasisPoints) public onlyOwner {
        require(_feeBasisPoints >= 0 && _feeBasisPoints <= 9500, "Invalid flat fee");
        feeBasisPoints = _feeBasisPoints;
        emit FeeSet(_feeBasisPoints);
    }

    /**
     * @notice returns the flat fee
     * @return current rate
     **/
    function currentRate(uint256) external view returns (uint256) {
        return feeBasisPoints;
    }
}
