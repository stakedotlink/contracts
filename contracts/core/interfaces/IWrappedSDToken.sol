// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "./IERC677.sol";

interface IWrappedSDToken is IERC677 {
    /**
     * @notice wraps tokens
     * @param _amount amount of unwrapped tokens to wrap
     */
    function wrap(uint _amount) external;

    /**
     * @notice unwraps tokens
     * @param _amount amount of wrapped tokens to unwrap
     */
    function unwrap(uint _amount) external;

    /**
     * @notice Returns amount of unwrapped tokens for an amount of wrapped tokens
     * @param _amount amount of wrapped tokens
     * @return amount of unwrapped tokens
     */
    function getUnderlyingByWrapped(uint _amount) external view returns (uint);

    function sdToken() external view returns (address);
}
