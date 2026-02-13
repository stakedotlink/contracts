// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "../interfaces/IWrappedLST.sol";

/**
 * @title WLSTUnderlyingChainlinkPriceAdapter
 * @notice Returns the price of wrappedLST denominated in the underlying asset
 */
contract WLSTUnderlyingChainlinkPriceAdapter {
    IWrappedLST public immutable wrappedLST;

    /**
     * @notice Initializes the adapter with the wrapped LST contract
     * @param _wrappedLST Address of the wrapped LST contract
     */
    constructor(address _wrappedLST) {
        wrappedLST = IWrappedLST(_wrappedLST);
    }

    /**
     * @notice Returns the number of decimals for the price
     * @return The number of decimals (18)
     */
    function decimals() external pure returns (uint8) {
        return 18;
    }

    /**
     * @notice Returns the latest exchange rate of wrappedLST to underlying
     * @return roundId Fixed value of 1
     * @return answer The amount of underlying tokens per 1 wrappedLST (18 decimals)
     * @return startedAt Current block timestamp
     * @return updatedAt Current block timestamp
     * @return answeredInRound Fixed value of 1
     */
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        answer = int256(wrappedLST.getUnderlyingByWrapped(1 ether));
        updatedAt = block.timestamp;
        startedAt = block.timestamp;
        roundId = 1;
        answeredInRound = 1;
    }
}
