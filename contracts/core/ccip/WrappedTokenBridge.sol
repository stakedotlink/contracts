// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import {IRouterClient} from "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";
import {CCIPReceiver} from "@chainlink/contracts-ccip/src/v0.8/ccip/applications/CCIPReceiver.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/IWrappedLST.sol";

contract WrappedTokenBridge is Ownable, CCIPReceiver {
    using SafeERC20 for IERC20;

    enum ErrorStatus {
        RESOLVED,
        UNRESOLVED
    }

    IERC20 linkToken;

    IERC20 token;
    IWrappedLST wrappedToken;

    mapping(bytes32 => ErrorStatus) public messageErrorsStatus;
    mapping(bytes32 => Client.Any2EVMMessage) public failedMessages;

    event TokensTransferred(
        bytes32 indexed messageId,
        uint64 indexed destinationChainSelector,
        address indexed sender,
        address receiver,
        uint256 tokenAmount,
        address feeToken,
        uint256 fees
    );
    event TokensReceived(
        bytes32 indexed messageId,
        uint64 indexed destinationChainSelector,
        address indexed sender,
        address receiver,
        uint256 tokenAmount
    );
    event MessageFailed(bytes32 indexed messageId, bytes error);
    event MessageResolved(bytes32 indexed messageId);

    error InvalidSender();
    error InvalidValue();
    error InsufficientFee();
    error TransferFailed();
    error FeeExceedsLimit();
    error OnlySelf();
    error MessageIsResolved();
    error InvalidMessage();

    modifier onlySelf() {
        if (msg.sender != address(this)) revert OnlySelf();
        _;
    }

    constructor(
        address _router,
        address _linkToken,
        address _token,
        address _wrappedToken
    ) CCIPReceiver(_router) {
        linkToken = IERC20(_linkToken);

        token = IERC20(_token);
        wrappedToken = IWrappedLST(_wrappedToken);

        linkToken.approve(_router, type(uint256).max);
        token.approve(_wrappedToken, type(uint256).max);
        wrappedToken.approve(_router, type(uint256).max);
    }

    function onTokenTransfer(
        address _sender,
        uint256 _value,
        bytes calldata _calldata
    ) external {
        if (msg.sender != address(token)) revert InvalidSender();
        if (_value == 0) revert InvalidValue();

        (uint64 destinationChainSelector, address receiver, uint256 maxLINKFee, bytes memory extraArgs) = abi.decode(
            _calldata,
            (uint64, address, uint256, bytes)
        );
        _transferTokens(destinationChainSelector, _sender, receiver, _value, false, maxLINKFee, extraArgs);
    }

    function transferTokens(
        uint64 _destinationChainSelector,
        address _receiver,
        uint256 _amount,
        bool _payNative,
        uint256 _maxLINKFee,
        bytes memory _extraArgs
    ) external payable onlyOwner returns (bytes32 messageId) {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        return
            _transferTokens(_destinationChainSelector, msg.sender, _receiver, _amount, _payNative, _maxLINKFee, _extraArgs);
    }

    function getFee(
        uint64 _destinationChainSelector,
        bool _payNative,
        bytes memory _extraArgs
    ) external view returns (uint256) {
        Client.EVM2AnyMessage memory evm2AnyMessage = _buildCCIPMessage(
            address(this),
            1000 ether,
            _payNative ? address(0) : address(linkToken),
            _extraArgs
        );

        return IRouterClient(this.getRouter()).getFee(_destinationChainSelector, evm2AnyMessage);
    }

    function ccipReceive(Client.Any2EVMMessage calldata _any2EvmMessage) external override onlyRouter {
        try this.processMessage(_any2EvmMessage) {} catch (bytes memory err) {
            bytes32 messageId = _any2EvmMessage.messageId;
            messageErrorsStatus[messageId] = ErrorStatus.UNRESOLVED;
            failedMessages[messageId] = _any2EvmMessage;
            emit MessageFailed(messageId, err);
        }
    }

    function processMessage(Client.Any2EVMMessage calldata _any2EvmMessage) external onlySelf {
        _ccipReceive(_any2EvmMessage);
    }

    function retryFailedMessage(bytes32 _messageId, address tokenReceiver) external onlyOwner {
        if (messageErrorsStatus[_messageId] != ErrorStatus.UNRESOLVED) revert MessageIsResolved();

        messageErrorsStatus[_messageId] = ErrorStatus.RESOLVED;

        Client.Any2EVMMessage memory message = failedMessages[_messageId];
        for (uint256 i = 0; i < message.destTokenAmounts.length; ++i) {
            IERC20(message.destTokenAmounts[i].token).safeTransfer(tokenReceiver, message.destTokenAmounts[i].amount);
        }

        emit MessageResolved(_messageId);
    }

    function recoverTokens(address[] calldata _tokens, address _receiver) external onlyOwner {
        for (uint256 i = 0; i < _tokens.length; ++i) {
            IERC20 tokenToTransfer = IERC20(_tokens[i]);
            tokenToTransfer.safeTransfer(_receiver, tokenToTransfer.balanceOf(address(this)));
        }
    }

    function _transferTokens(
        uint64 _destinationChainSelector,
        address _sender,
        address _receiver,
        uint256 _amount,
        bool _payNative,
        uint256 _maxLINKFee,
        bytes memory _extraArgs
    ) internal returns (bytes32 messageId) {
        uint256 preWrapBalance = wrappedToken.balanceOf(address(this));
        wrappedToken.wrap(_amount);
        uint256 amountToTransfer = wrappedToken.balanceOf(address(this)) - preWrapBalance;

        Client.EVM2AnyMessage memory evm2AnyMessage = _buildCCIPMessage(
            _receiver,
            amountToTransfer,
            _payNative ? address(0) : address(linkToken),
            _extraArgs
        );

        IRouterClient router = IRouterClient(this.getRouter());
        uint256 fees = router.getFee(_destinationChainSelector, evm2AnyMessage);

        if (_payNative) {
            if (fees > msg.value) revert InsufficientFee();
            messageId = router.ccipSend{value: fees}(_destinationChainSelector, evm2AnyMessage);
            if (fees < msg.value) {
                (bool success, ) = _sender.call{value: msg.value - fees}("");
                if (!success) revert TransferFailed();
            }
        } else {
            if (fees > _maxLINKFee) revert FeeExceedsLimit();
            linkToken.safeTransferFrom(_sender, address(this), fees);
            messageId = router.ccipSend(_destinationChainSelector, evm2AnyMessage);
        }

        emit TokensTransferred(
            messageId,
            _destinationChainSelector,
            _sender,
            _receiver,
            amountToTransfer,
            _payNative ? address(0) : address(linkToken),
            fees
        );
        return messageId;
    }

    function _buildCCIPMessage(
        address _receiver,
        uint256 _amount,
        address _feeTokenAddress,
        bytes memory _extraArgs
    ) internal view returns (Client.EVM2AnyMessage memory) {
        Client.EVMTokenAmount[] memory tokenAmounts = new Client.EVMTokenAmount[](1);
        Client.EVMTokenAmount memory tokenAmount = Client.EVMTokenAmount({token: address(wrappedToken), amount: _amount});
        tokenAmounts[0] = tokenAmount;

        Client.EVM2AnyMessage memory evm2AnyMessage = Client.EVM2AnyMessage({
            receiver: abi.encode(_receiver),
            data: "",
            tokenAmounts: tokenAmounts,
            extraArgs: _extraArgs,
            feeToken: _feeTokenAddress
        });

        return evm2AnyMessage;
    }

    function _ccipReceive(Client.Any2EVMMessage memory any2EvmMessage) internal override {
        if (any2EvmMessage.destTokenAmounts.length != 1) revert InvalidMessage();

        address tokenAddress = any2EvmMessage.destTokenAmounts[0].token;
        uint256 tokenAmount = any2EvmMessage.destTokenAmounts[0].amount;
        address receiver = abi.decode(any2EvmMessage.data, (address));

        if (tokenAddress != address(wrappedToken) || receiver == address(0)) revert InvalidMessage();

        uint256 preUnwrapBalance = token.balanceOf(address(this));
        wrappedToken.unwrap(tokenAmount);
        uint256 amountToTransfer = token.balanceOf(address(this)) - preUnwrapBalance;
        token.safeTransfer(receiver, amountToTransfer);

        emit TokensReceived(
            any2EvmMessage.messageId,
            any2EvmMessage.sourceChainSelector,
            abi.decode(any2EvmMessage.sender, (address)),
            receiver,
            tokenAmount
        );
    }
}
