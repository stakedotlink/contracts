// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "../base/LiquidSDAdapter.sol";

/**
 * @title Lido stETH Adapter
 * @notice Adapter for Lido's stETH
 */
contract LidoSTETHAdapter is LiquidSDAdapter {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _token, address _indexPool) public initializer {
        __LiquidSDAdapter_init(_token, _indexPool);
    }

    /**
     * @notice returns the exchange rate between this adapter's token and the underlying asset
     * @return exchange rate
     */
    function getExchangeRate() public view override returns (uint256) {
        return 1 ether;
    }
}
