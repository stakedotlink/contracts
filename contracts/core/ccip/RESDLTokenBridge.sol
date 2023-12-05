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

    bytes public extraArgs;

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
    event DestinationAdded(uint64 indexed destinationChainSelector, address destination);
    event DestinationRemoved(uint64 indexed destinationChainSelector, address destination);
    event SetExtraArgs(bytes extraArgs);

    error InsufficientFee();
    error TransferFailed();
    error FeeExceedsLimit();
    error SenderNotAuthorized();
    error InvalidDestination();
    error InvalidReceiver();
    error AlreadyAdded();
    error AlreadyRemoved();

    /**
     * @notice Initializes the contract
     * @param _router address of the CCIP router
     * @param _linkToken address of the LINK token
     * @param _sdlToken address of the SDL token
     * @param _sdlPool address of the SDL Pool
     * @param _sdlPoolCCIPController address of the SDL Pool CCIP controller
     * @param _extraArgs encoded args as defined in CCIP API used for sending transfers
     **/
    constructor(
        address _router,
        address _linkToken,
        address _sdlToken,
        address _sdlPool,
        address _sdlPoolCCIPController,
        bytes memory _extraArgs
    ) CCIPReceiver(_router) {
        linkToken = IERC20(_linkToken);
        sdlToken = IERC20(_sdlToken);
        sdlPool = ISDLPool(_sdlPool);
        sdlPoolCCIPController = ISDLPoolCCIPController(_sdlPoolCCIPController);
        extraArgs = _extraArgs;
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
     **/
    function transferRESDL(
        uint64 _destinationChainSelector,
        address _receiver,
        uint256 _tokenId,
        bool _payNative,
        uint256 _maxLINKFee
    ) external payable returns (bytes32 messageId) {
        address sender = msg.sender;
        if (sender != sdlPool.ownerOf(_tokenId)) revert SenderNotAuthorized();
        if (_receiver == address(0)) revert InvalidReceiver();

        if (whitelistedDestinations[_destinationChainSelector] == address(0)) revert InvalidDestination();

        RESDLToken memory reSDLToken;
        {
            (uint256 amount, uint256 boostAmount, uint64 startTime, uint64 duration, uint64 expiry) = sdlPoolCCIPController
                .handleOutgoingRESDL(_destinationChainSelector, sender, _tokenId);
            reSDLToken = RESDLToken(amount, boostAmount, startTime, duration, expiry);
        }

        Client.EVM2AnyMessage memory evm2AnyMessage = _buildCCIPMessage(
            _receiver,
            _tokenId,
            reSDLToken,
            whitelistedDestinations[_destinationChainSelector],
            _payNative ? address(0) : address(linkToken),
            extraArgs
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
     * @return fee current fee
     **/
    function getFee(uint64 _destinationChainSelector, bool _payNative) external view returns (uint256) {
        Client.EVM2AnyMessage memory evm2AnyMessage = _buildCCIPMessage(
            address(this),
            0,
            RESDLToken(0, 0, 0, 0, 0),
            address(this),
            _payNative ? address(0) : address(linkToken),
            extraArgs
        );

        return IRouterClient(this.getRouter()).getFee(_destinationChainSelector, evm2AnyMessage);
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
     * @notice sets extra args used for reSDL transfers
     * @param _extraArgs encoded args as defined in CCIP API
     */
    function setExtraArgs(bytes calldata _extraArgs) external onlyOwner {
        extraArgs = _extraArgs;
        emit SetExtraArgs(_extraArgs);
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

        sdlPoolCCIPController.handleIncomingRESDL(
            _any2EvmMessage.sourceChainSelector,
            receiver,
            tokenId,
            amount,
            boostAmount,
            startTime,
            duration,
            expiry
        );

        emit TokenReceived(_any2EvmMessage.messageId, _any2EvmMessage.sourceChainSelector, sender, receiver, tokenId);
    }
}
