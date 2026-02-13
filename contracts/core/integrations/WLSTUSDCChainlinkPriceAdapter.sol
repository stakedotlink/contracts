// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import "../interfaces/IWrappedLST.sol";

interface EACAggregatorProxy {
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

/**
 * @title WLSTUSDCChainlinkPriceAdapter
 * @notice Returns the price of wrappedLST denominated in USDC
 * @dev Combines underlying/USD price feed, USDC/USD price feed, and wrapped-to-underlying ratio
 */
contract WLSTUSDCChainlinkPriceAdapter {
    uint8 constant DECIMALS = 8;

    IWrappedLST public immutable wrappedLST;
    EACAggregatorProxy public immutable underlyingUSDFeed;
    EACAggregatorProxy public immutable usdcUSDFeed;

    constructor(address _wrappedLST, address _underlyingUSDFeed, address _usdcUSDFeed) {
        wrappedLST = IWrappedLST(_wrappedLST);
        underlyingUSDFeed = EACAggregatorProxy(_underlyingUSDFeed);
        usdcUSDFeed = EACAggregatorProxy(_usdcUSDFeed);
    }

    function decimals() external pure returns (uint8) {
        return DECIMALS;
    }

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
        // Get underlying/USD price
        (, int256 underlyingUSDPrice, , , ) = underlyingUSDFeed.latestRoundData();

        // Get USDC/USD price
        (, int256 usdcUSDPrice, , , ) = usdcUSDFeed.latestRoundData();

        // Get wrapped-to-underlying ratio (18 decimals)
        uint256 underlyingPerWrapped = wrappedLST.getUnderlyingByWrapped(1 ether);

        // Get decimals for normalization
        uint8 underlyingDecimals = underlyingUSDFeed.decimals();
        uint8 usdcDecimals = usdcUSDFeed.decimals();

        // Calculate USDC per wrapped LST
        answer = int256(
            (uint256(underlyingUSDPrice) * underlyingPerWrapped * (10 ** DECIMALS)) /
                ((1e18 * uint256(usdcUSDPrice) * (10 ** underlyingDecimals)) / (10 ** usdcDecimals))
        );
        updatedAt = block.timestamp;
        startedAt = block.timestamp;
        roundId = 1;
        answeredInRound = 1;
    }
}
