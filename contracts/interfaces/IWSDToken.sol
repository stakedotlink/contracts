// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;

import "./IERC677.sol";

interface IWSDToken is IERC677 {
    /**
     * @notice wraps tokens
     * @param _amount amount of unwrapped tokens to wrap
     */
    function wrap(uint _amount) external;
}
