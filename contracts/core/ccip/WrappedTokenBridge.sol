// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import {IRouterClient} from "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";
import {LinkTokenInterface} from "@chainlink/contracts/src/v0.8/shared/interfaces/LinkTokenInterface.sol";
import {CCIPReceiver} from "@chainlink/contracts-ccip/src/v0.8/ccip/applications/CCIPReceiver.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "../interfaces/IWrappedLST.sol";

contract WrappedTokenBridge is Ownable, CCIPReceiver {
    LinkTokenInterface linkToken;

    IERC20 token;
    IWrappedLST wrappedToken;

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

    error InvalidSender();
    error InvalidValue();
    error InsufficientFee();
    error TransferFailed();

    constructor(
        address _router,
        address _linkToken,
        address _token,
        address _wrappedToken
    ) CCIPReceiver(_router) {
        linkToken = LinkTokenInterface(_linkToken);

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
    ) external returns (bytes32 messageId) {
        if (msg.sender != address(token)) revert InvalidSender();
        if (_value == 0) revert InvalidValue();

        uint256 preWrapBalance = wrappedToken.balanceOf(address(this));
        wrappedToken.wrap(_value);
        uint256 amountToTransfer = wrappedToken.balanceOf(address(this)) - preWrapBalance;

        (uint64 destinationChainSelector, address receiver) = abi.decode(_calldata, (uint64, address));
        Client.EVM2AnyMessage memory evm2AnyMessage = _buildCCIPMessage(receiver, amountToTransfer, address(linkToken));

        IRouterClient router = IRouterClient(this.getRouter());

        uint256 fees = router.getFee(destinationChainSelector, evm2AnyMessage);
        linkToken.transferFrom(_sender, address(this), fees);

        messageId = router.ccipSend(destinationChainSelector, evm2AnyMessage);
        emit TokensTransferred(
            messageId,
            destinationChainSelector,
            _sender,
            receiver,
            amountToTransfer,
            address(linkToken),
            fees
        );

        return messageId;
    }

    function transferTokensPayNative(
        uint64 _destinationChainSelector,
        address _receiver,
        uint256 _amount
    ) external payable onlyOwner returns (bytes32 messageId) {
        token.transferFrom(msg.sender, address(this), _amount);

        uint256 preWrapBalance = wrappedToken.balanceOf(address(this));
        wrappedToken.wrap(_amount);
        uint256 amountToTransfer = wrappedToken.balanceOf(address(this)) - preWrapBalance;

        Client.EVM2AnyMessage memory evm2AnyMessage = _buildCCIPMessage(_receiver, amountToTransfer, address(0));

        IRouterClient router = IRouterClient(this.getRouter());

        uint256 fees = router.getFee(_destinationChainSelector, evm2AnyMessage);
        if (fees > msg.value) revert InsufficientFee();

        messageId = router.ccipSend{value: fees}(_destinationChainSelector, evm2AnyMessage);

        if (fees < msg.value) {
            (bool success, ) = msg.sender.call{value: msg.value - fees}("");
            if (!success) revert TransferFailed();
        }

        emit TokensTransferred(
            messageId,
            _destinationChainSelector,
            msg.sender,
            _receiver,
            amountToTransfer,
            address(0),
            fees
        );
        return messageId;
    }

    function getCurrentFee(uint64 _destinationChainSelector, bool _payNative) external view returns (uint256) {
        Client.EVM2AnyMessage memory evm2AnyMessage = _buildCCIPMessage(
            address(this),
            1000 ether,
            _payNative ? address(0) : address(linkToken)
        );

        return IRouterClient(this.getRouter()).getFee(_destinationChainSelector, evm2AnyMessage);
    }

    function _buildCCIPMessage(
        address _receiver,
        uint256 _amount,
        address _feeTokenAddress
    ) internal view returns (Client.EVM2AnyMessage memory) {
        Client.EVMTokenAmount[] memory tokenAmounts = new Client.EVMTokenAmount[](1);
        Client.EVMTokenAmount memory tokenAmount = Client.EVMTokenAmount({token: address(wrappedToken), amount: _amount});
        tokenAmounts[0] = tokenAmount;

        Client.EVM2AnyMessage memory evm2AnyMessage = Client.EVM2AnyMessage({
            receiver: abi.encode(_receiver),
            data: "",
            tokenAmounts: tokenAmounts,
            extraArgs: Client._argsToBytes(Client.EVMExtraArgsV1({gasLimit: 0, strict: false})),
            feeToken: _feeTokenAddress
        });

        return evm2AnyMessage;
    }

    function _ccipReceive(Client.Any2EVMMessage memory any2EvmMessage) internal override {
        address tokenAddress = any2EvmMessage.destTokenAmounts[0].token;
        uint256 tokenAmount = any2EvmMessage.destTokenAmounts[0].amount;
        address receiver = abi.decode(any2EvmMessage.data, (address));

        if (tokenAddress == address(wrappedToken)) {
            uint256 preUnwrapBalance = token.balanceOf(address(this));
            wrappedToken.unwrap(tokenAmount);
            uint256 amountToTransfer = token.balanceOf(address(this)) - preUnwrapBalance;
            token.transfer(receiver, amountToTransfer);
        }

        emit TokensReceived(
            any2EvmMessage.messageId,
            any2EvmMessage.sourceChainSelector,
            abi.decode(any2EvmMessage.sender, (address)),
            receiver,
            tokenAmount
        );
    }
}
