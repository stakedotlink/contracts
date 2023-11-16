// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import {IRouterClient} from "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";
import {CCIPReceiver} from "@chainlink/contracts-ccip/src/v0.8/ccip/applications/CCIPReceiver.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

abstract contract SDLPoolCCIPController is Ownable, CCIPReceiver {
    using SafeERC20 for IERC20;

    IERC20 public immutable linkToken;

    IERC20 public immutable sdlToken;
    address public immutable sdlPool;
    address public reSDLTokenBridge;

    uint256 public maxLINKFee;

    event MessageSent(bytes32 indexed messageId, uint64 indexed destinationChainSelector, uint256 fees);
    event MessageReceived(bytes32 indexed messageId, uint64 indexed destinationChainSelector);
    event MessageFailed(bytes32 indexed messageId, bytes error);

    error OnlySelf();
    error OnlyRESDLTokenBridge();
    error AlreadyAdded();
    error InvalidDestination();
    error SenderNotAuthorized();
    error FeeExceedsLimit(uint256 fee);

    modifier onlySelf() {
        if (msg.sender != address(this)) revert OnlySelf();
        _;
    }

    modifier onlyBridge() {
        if (msg.sender != reSDLTokenBridge) revert OnlyRESDLTokenBridge();
        _;
    }

    /**
     * @notice Initializes the contract
     * @param _router address of the CCIP router
     * @param _linkToken address of the LINK token
     * @param _sdlToken address of the SDL token
     * @param _sdlPool address of the SDL Pool
     * @param _maxLINKFee max fee to be paid on an outgoing message
     **/
    constructor(
        address _router,
        address _linkToken,
        address _sdlToken,
        address _sdlPool,
        uint256 _maxLINKFee
    ) CCIPReceiver(_router) {
        linkToken = IERC20(_linkToken);
        sdlToken = IERC20(_sdlToken);
        sdlPool = _sdlPool;
        maxLINKFee = _maxLINKFee;
        linkToken.approve(_router, type(uint256).max);
    }

    /**
     * @notice Recovers tokens that were accidentally sent to this contract
     * @param _tokens list of tokens to recover
     * @param _receiver address to receive recovered tokens
     **/
    function recoverTokens(address[] calldata _tokens, address _receiver) external onlyOwner {
        for (uint256 i = 0; i < _tokens.length; ++i) {
            IERC20 tokenToTransfer = IERC20(_tokens[i]);
            tokenToTransfer.safeTransfer(_receiver, tokenToTransfer.balanceOf(address(this)));
        }
    }

    /**
     * @notice Sets the max LINK fee to be paid on an outgoing CCIP message
     * @param _maxLINKFee maximum fee in LINK
     **/
    function setMaxLINKFee(uint256 _maxLINKFee) external onlyOwner {
        maxLINKFee = _maxLINKFee;
    }

    /**
     * @notice Sets the address of the reSDL token bridge
     * @param _reSDLTokenBridge address of reSDL token bridge
     **/
    function setRESDLTokenBridge(address _reSDLTokenBridge) external onlyOwner {
        reSDLTokenBridge = _reSDLTokenBridge;
    }

    /**
     * @notice Called by the CCIP router to deliver a message
     * @param _any2EvmMessage CCIP message
     **/
    function ccipReceive(Client.Any2EVMMessage calldata _any2EvmMessage) external override onlyRouter {
        try this.processMessage(_any2EvmMessage) {} catch (bytes memory err) {
            emit MessageFailed(_any2EvmMessage.messageId, err);
        }
    }

    /**
     * @notice Processes a received message
     * @param _any2EvmMessage CCIP message
     **/
    function processMessage(Client.Any2EVMMessage calldata _any2EvmMessage) external onlySelf {
        _ccipReceive(_any2EvmMessage);
    }
}
