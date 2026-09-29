// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Token Forwarder
 * @notice Receives tokens sent with transferAndCall and forwards them to a receiver with a normal transfer
 * @dev Allows an address that cannot handle onTokenTransfer to receive tokens
 * that are always sent with transferAndCall
 */
contract TokenForwarder {
    using SafeERC20 for IERC20;

    // address that all received tokens are forwarded to
    address public immutable receiver;

    error InvalidAddress();

    /**
     * @notice Initializes the contract
     * @param _receiver address that all received tokens are forwarded to
     */
    constructor(address _receiver) {
        if (_receiver == address(0)) revert InvalidAddress();
        receiver = _receiver;
    }

    /**
     * @notice Forwards tokens received through transferAndCall to the receiver
     * @dev the calling token is the one forwarded, so a caller can only move its own token
     * @param _value amount of tokens received
     */
    function onTokenTransfer(address, uint256 _value, bytes calldata) external {
        IERC20(msg.sender).safeTransfer(receiver, _value);
    }
}
