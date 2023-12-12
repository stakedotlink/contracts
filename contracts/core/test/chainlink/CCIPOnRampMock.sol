// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import {Client} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";

/**
 * @title CCIP OnRamp Mock
 * @notice Mocks CCIP onramp contract for testing
 */
contract CCIPOnRampMock {
    struct RequestData {
        uint256 feeTokenAmount;
        address originalSender;
    }

    mapping(address => address) public tokenPools;
    address public linkToken;

    Client.EVM2AnyMessage[] public requestMessages;
    RequestData[] public requestData;

    constructor(
        address[] memory _tokens,
        address[] memory _tokenPools,
        address _linkToken
    ) {
        for (uint256 i = 0; i < _tokens.length; ++i) {
            tokenPools[_tokens[i]] = _tokenPools[i];
        }
        linkToken = _linkToken;
    }

    function getLastRequestMessage() external view returns (Client.EVM2AnyMessage memory) {
        return requestMessages[requestMessages.length - 1];
    }

    function getLastRequestData() external view returns (RequestData memory) {
        return requestData[requestData.length - 1];
    }

    function getFee(Client.EVM2AnyMessage calldata _message) external view returns (uint256) {
        return _message.feeToken == linkToken ? 2 ether : 3 ether;
    }

    function getPoolBySourceToken(address _token) public view returns (address) {
        return tokenPools[_token];
    }

    function forwardFromRouter(
        Client.EVM2AnyMessage calldata _message,
        uint256 _feeTokenAmount,
        address _originalSender
    ) external returns (bytes32) {
        requestMessages.push(_message);
        requestData.push(RequestData(_feeTokenAmount, _originalSender));
        return keccak256(abi.encode(block.timestamp));
    }

    function setTokenPool(address _token, address _pool) external {
        tokenPools[_token] = _pool;
    }
}
