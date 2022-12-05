// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

/**
 * @title Delegator Pool Mock
 * @notice Mocks contract for testing
 */
contract DelegatorPoolMock {
    address public token;
    uint16 public index;
    uint256 public totalRewards;
    uint256 public rate;

    constructor(
        address _token,
        uint16 _index,
        uint256 _rate
    ) {
        token = _token;
        index = _index;
        rate = _rate;
    }

    function onTokenTransfer(
        address,
        uint256 _value,
        bytes calldata
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
