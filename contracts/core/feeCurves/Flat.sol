// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Flat Fee
 * @notice Sets a flat fee
 */
contract FlatFee is Ownable {
    uint public feeBasisPoints;

    event FeeSet(uint _feeBasisPoints);

    constructor(uint _feeBasisPoints) {
        feeBasisPoints = _feeBasisPoints;
    }

    /**
     * @notice sets the fee basis points
     * @param _feeBasisPoints
     **/
    function setFeeBasisPoints(uint _feeBasisPoints) public onlyOwner {
        require(_feeBasisPoints >= 0 && _feeBasisPoints <= 9500, "Invalid flat fee");
        feeBasisPoints = _feeBasisPoints;
        emit FeeSet(_feeBasisPoints);
    }

    /**
     * @notice returns the flat fee
     * @return current rate
     **/
    function currentRate(uint) external view returns (uint) {
        return feeBasisPoints;
    }
}
