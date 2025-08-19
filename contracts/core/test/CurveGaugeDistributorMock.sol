// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Curve Gauge Distributor
 * @notice Mocks contract for testing
 */
contract CurveGaugeDistributorMock {
    address public lst;

    uint256 public lastBalance;
    uint256 public lastMinMintAmount;

    constructor(address _lst) {
        lst = _lst;
    }

    /**
     * @notice Distributes rewards
     * @param _minMintAmount minimum LP tokens to be minted when rewards are distributed
     */
    function distributeRewards(uint256 _minMintAmount) external {
        lastBalance = IERC20(lst).balanceOf(address(this));
        lastMinMintAmount = _minMintAmount;
    }
}
