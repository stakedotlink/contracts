// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

interface ICurveGaugeDistributor {
    function distributeRewards(uint256 _minMintAmount) external;
}
