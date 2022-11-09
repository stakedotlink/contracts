// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

/**
 * @title Lending Pool Mock
 * @notice Mocks contract for testing
 */
contract LendingPoolMock {
    address public token;
    uint16 public index;
    uint public totalRewards;
    uint public rate;

    constructor(
        address _token,
        uint16 _index,
        uint _rate
    ) {
        token = _token;
        index = _index;
        rate = _rate;
    }

    function onTokenTransfer(
        address _sender,
        uint _value,
        bytes calldata _calldata
    ) external {
        totalRewards += _value;
    }

    function currentRate(address _token, uint16 _index) public view returns (uint) {
        if (_token != token || _index != index) {
            return 0;
        }
        return rate;
    }
}
