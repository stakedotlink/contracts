// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

/**
 * @title Delegator Pool Mock
 * @notice Mocks contract for testing
 */
contract DelegatorPoolMock {
    address public token;
    uint16 public index;
    uint256 public totalRewards;

    constructor(address _token, uint16 _index) {
        token = _token;
        index = _index;
    }

    function onTokenTransfer(
        address,
        uint256 _value,
        bytes calldata
    ) external {
        totalRewards += _value;
    }
}
