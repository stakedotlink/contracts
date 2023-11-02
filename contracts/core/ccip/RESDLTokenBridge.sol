// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import {IRouterClient} from "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";
import {CCIPReceiver} from "@chainlink/contracts-ccip/src/v0.8/ccip/applications/CCIPReceiver.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/ISDLPool.sol";
import "../interfaces/ISDLPoolCCIPController.sol";

/**
 * @title reSDL Token Bridge
 * @notice Handles CCIP transfers of reSDL NFTs
 */
contract RESDLTokenBridge is Ownable, CCIPReceiver {
    using SafeERC20 for IERC20;

    struct RESDLToken {
        uint256 amount;
        uint256 boostAmount;
        uint64 startTime;
        uint64 duration;
        uint64 expiry;
    }

    IERC20 public linkToken;

    IERC20 public sdlToken;
    ISDLPool public sdlPool;
    ISDLPoolCCIPController public sdlPoolCCIPController;

    mapping(uint64 => address) public whitelistedDestinations;

    event TokenTransferred(
        bytes32 indexed messageId,
        uint64 indexed destinationChainSelector,
        address indexed sender,
        address receiver,
        uint256 tokenId,
        address feeToken,
        uint256 fees
    );
    event TokenReceived(
        bytes32 indexed messageId,
        uint64 indexed sourceChainSelector,
        address indexed sender,
        address receiver,
        uint256 tokenId
    );
    event MessageFailed(bytes32 indexed messageId, bytes error);
    event DestinationAdded(uint64 indexed destinationChainSelector, address destination);
    event DestinationRemoved(uint64 indexed destinationChainSelector, address destination);

    error InsufficientFee();
    error TransferFailed();
    error FeeExceedsLimit();
    error OnlySelf();
    error SenderNotAuthorized();
    error InvalidDestination();
    error InvalidReceiver();
    error AlreadyAdded();
    error AlreadyRemoved();

    modifier onlySelf() {
        if (msg.sender != address(this)) revert OnlySelf();
        _;
    }

    /**
     * @notice Initializes the contract
     * @param _router address of the CCIP router
     * @param _linkToken address of the LINK token
     * @param _sdlToken address of the SDL token
     * @param _sdlPool address of the SDL Pool
     * @param _sdlPoolCCIPController address of the SDL Pool CCIP controller
     **/
    constructor(
        address _router,
        address _linkToken,
        address _sdlToken,
        address _sdlPool,
        address _sdlPoolCCIPController
    ) CCIPReceiver(_router) {
        linkToken = IERC20(_linkToken);
        sdlToken = IERC20(_sdlToken);
        sdlPool = ISDLPool(_sdlPool);
        sdlPoolCCIPController = ISDLPoolCCIPController(_sdlPoolCCIPController);
        linkToken.safeApprove(_router, type(uint256).max);
        sdlToken.safeApprove(_router, type(uint256).max);
        sdlToken.safeApprove(_sdlPoolCCIPController, type(uint256).max);
    }

    /**
     * @notice Transfers an reSDL token to a destination chain
     * @param _destinationChainSelector id of destination chain
     * @param _receiver address to receive reSDL on destination chain
     * @param _tokenId id of reSDL token
     * @param _payNative whether fee should be paid natively or with LINK
     * @param _maxLINKFee call will revert if LINK fee exceeds this value
     * @param _extraArgs encoded args as defined in CCIP API
     **/
    function transferRESDL(
        uint64 _destinationChainSelector,
        address _receiver,
        uint256 _tokenId,
        bool _payNative,
        uint256 _maxLINKFee,
        bytes memory _extraArgs
    ) external payable returns (bytes32 messageId) {
        address sender = msg.sender;
        if (sender != sdlPool.ownerOf(_tokenId)) revert SenderNotAuthorized();
        if (_receiver == address(0)) revert InvalidReceiver();

        address destination = whitelistedDestinations[_destinationChainSelector];
        if (destination == address(0)) revert InvalidDestination();

        RESDLToken memory reSDLToken;
        {
            (uint256 amount, uint256 boostAmount, uint64 startTime, uint64 duration, uint64 expiry) = sdlPoolCCIPController
                .handleOutgoingRESDL(sender, _tokenId);
            reSDLToken = RESDLToken(amount, boostAmount, startTime, duration, expiry);
        }

        Client.EVM2AnyMessage memory evm2AnyMessage = _buildCCIPMessage(
            _receiver,
            _tokenId,
            reSDLToken,
            destination,
            _payNative ? address(0) : address(linkToken),
            _extraArgs
        );

        IRouterClient router = IRouterClient(this.getRouter());
        uint256 fees = router.getFee(_destinationChainSelector, evm2AnyMessage);

        if (_payNative) {
            if (fees > msg.value) revert InsufficientFee();
            messageId = router.ccipSend{value: fees}(_destinationChainSelector, evm2AnyMessage);
            if (fees < msg.value) {
                (bool success, ) = sender.call{value: msg.value - fees}("");
                if (!success) revert TransferFailed();
            }
        } else {
            if (fees > _maxLINKFee) revert FeeExceedsLimit();
            linkToken.safeTransferFrom(sender, address(this), fees);
            messageId = router.ccipSend(_destinationChainSelector, evm2AnyMessage);
        }

        emit TokenTransferred(
            messageId,
            _destinationChainSelector,
            sender,
            _receiver,
            _tokenId,
            _payNative ? address(0) : address(linkToken),
            fees
        );
    }

    /**
     * @notice Returns the current fee for an reSDL transfer
     * @param _destinationChainSelector id of destination chain
     * @param _payNative whether fee should be paid natively or with LINK
     * @param _extraArgs encoded args as defined in CCIP API
     * @return fee current fee
     **/
    function getFee(
        uint64 _destinationChainSelector,
        bool _payNative,
        bytes memory _extraArgs
    ) external view returns (uint256) {
        Client.EVM2AnyMessage memory evm2AnyMessage = _buildCCIPMessage(
            address(this),
            0,
            RESDLToken(0, 0, 0, 0, 0),
            address(this),
            _payNative ? address(0) : address(linkToken),
            _extraArgs
        );

        return IRouterClient(this.getRouter()).getFee(_destinationChainSelector, evm2AnyMessage);
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
     * @notice Whitelists a new destination chain
     * @param _destinationChainSelector id of destination chain
     * @param _destination address to receive CCIP messages on destination chain
     **/
    function addWhitelistedDestination(uint64 _destinationChainSelector, address _destination) external onlyOwner {
        if (whitelistedDestinations[_destinationChainSelector] != address(0)) revert AlreadyAdded();
        if (_destination == address(0)) revert InvalidDestination();
        whitelistedDestinations[_destinationChainSelector] = _destination;
        emit DestinationAdded(_destinationChainSelector, _destination);
    }

    /**
     * @notice Removes an existing destination chain
     * @param _destinationChainSelector id of destination chain
     **/
    function removeWhitelistedDestination(uint64 _destinationChainSelector) external onlyOwner {
        if (whitelistedDestinations[_destinationChainSelector] == address(0)) revert AlreadyRemoved();
        emit DestinationRemoved(_destinationChainSelector, whitelistedDestinations[_destinationChainSelector]);
        delete whitelistedDestinations[_destinationChainSelector];
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

    /**
     * @notice Builds a CCIP message
     * @dev builds the message for outgoing reSDL transfers
     * @param _receiver address to receive reSDL token on destination chain
     * @param _tokenId id of reSDL token
     * @param _reSDLToken reSDL token
     * @param _destination address of destination contract
     * @param _feeTokenAddress address of token that fees will be paid in
     * @param _extraArgs encoded args as defined in CCIP API
     **/
    function _buildCCIPMessage(
        address _receiver,
        uint256 _tokenId,
        RESDLToken memory _reSDLToken,
        address _destination,
        address _feeTokenAddress,
        bytes memory _extraArgs
    ) internal view returns (Client.EVM2AnyMessage memory) {
        Client.EVMTokenAmount[] memory tokenAmounts = new Client.EVMTokenAmount[](1);
        Client.EVMTokenAmount memory tokenAmount = Client.EVMTokenAmount({
            token: address(sdlToken),
            amount: _reSDLToken.amount
        });
        tokenAmounts[0] = tokenAmount;

        Client.EVM2AnyMessage memory evm2AnyMessage = Client.EVM2AnyMessage({
            receiver: abi.encode(_destination),
            data: abi.encode(
                _receiver,
                _tokenId,
                _reSDLToken.amount,
                _reSDLToken.boostAmount,
                _reSDLToken.startTime,
                _reSDLToken.duration,
                _reSDLToken.expiry
            ),
            tokenAmounts: tokenAmounts,
            extraArgs: _extraArgs,
            feeToken: _feeTokenAddress
        });

        return evm2AnyMessage;
    }

    /**
     * @notice Processes a received message
     * @dev handles incoming reSDL transfers
     * @param _any2EvmMessage CCIP message
     **/
    function _ccipReceive(Client.Any2EVMMessage memory _any2EvmMessage) internal override {
        address sender = abi.decode(_any2EvmMessage.sender, (address));
        if (sender != whitelistedDestinations[_any2EvmMessage.sourceChainSelector]) revert SenderNotAuthorized();

        (
            address receiver,
            uint256 tokenId,
            uint256 amount,
            uint256 boostAmount,
            uint64 startTime,
            uint64 duration,
            uint64 expiry
        ) = abi.decode(_any2EvmMessage.data, (address, uint256, uint256, uint256, uint64, uint64, uint64));

        sdlPoolCCIPController.handleIncomingRESDL(receiver, tokenId, amount, boostAmount, startTime, duration, expiry);

        emit TokenReceived(_any2EvmMessage.messageId, _any2EvmMessage.sourceChainSelector, sender, receiver, tokenId);
    }
}
