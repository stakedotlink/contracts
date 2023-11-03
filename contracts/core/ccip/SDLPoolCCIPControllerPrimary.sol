// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import "./base/SDLPoolCCIPController.sol";
import "../interfaces/ISDLPool.sol";
import "../interfaces/IERC677.sol";

interface ISDLPoolPrimary is ISDLPool {
    function handleIncomingUpdate(uint256 _numNewRESDLTokens, int256 _totalRESDLSupplyChange) external returns (uint256);
}

contract SDLPoolCCIPControllerPrimary is SDLPoolCCIPController {
    using SafeERC20 for IERC20;

    uint64[] internal whitelistedChains;
    mapping(uint64 => address) public whitelistedDestinations;
    mapping(uint64 => bytes) public extraArgsByChain;

    mapping(uint64 => uint256) public reSDLSupplyByChain;

    mapping(address => address) public wrappedRewardTokens;

    event DistributeRewards(bytes32 indexed messageId, uint64 indexed destinationChainSelector, uint256 fees);
    event ChainAdded(uint64 indexed chainSelector, address destination, bytes extraArgs);
    event ChainRemoved(uint64 indexed destinationChainSelector, address destination);
    event SetExtraArgs(uint64 indexed chainSelector, bytes extraArgs);

    /**
     * @notice Initializes the contractMessageSent
     * @param _router address of the CCIP router
     * @param _linkToken address of the LINK token
     * @param _sdlToken address of the SDL token
     * @param _sdlPool address of the SDL Pool
     **/
    constructor(
        address _router,
        address _linkToken,
        address _sdlToken,
        address _sdlPool
    ) SDLPoolCCIPController(_router, _linkToken, _sdlToken, _sdlPool) {}

    function distributeRewards(bytes[] memory _extraArgs) external {
        uint256 totalRESDL = ISDLPoolPrimary(sdlPool).effectiveBalanceOf(address(this));
        address[] memory tokens = ISDLPoolPrimary(sdlPool).supportedTokens();
        uint256 numDestinations = whitelistedChains.length;

        ISDLPoolPrimary(sdlPool).withdrawRewards(tokens);

        uint256[][] memory distributionAmounts = new uint256[][](numDestinations);
        for (uint256 i = 0; i < numDestinations; ++i) {
            distributionAmounts[i] = new uint256[](tokens.length);
        }

        for (uint256 i = 0; i < tokens.length; ++i) {
            address token = tokens[i];
            uint256 tokenBalance = IERC20(token).balanceOf(address(this));

            address wrappedToken = wrappedRewardTokens[token];
            if (wrappedToken != address(0)) {
                IERC677(token).transferAndCall(wrappedToken, tokenBalance, "");
                token = wrappedToken;
                tokenBalance = IERC20(wrappedToken).balanceOf(address(this));
            }

            uint256 totalDistributed;
            for (uint256 j = 0; j < numDestinations; ++j) {
                uint64 chainSelector = whitelistedChains[j];
                uint256 rewards = j == numDestinations - 1
                    ? tokenBalance - totalDistributed
                    : (tokenBalance * reSDLSupplyByChain[chainSelector]) / totalRESDL;
                distributionAmounts[j][i] = rewards;
                totalDistributed += rewards;
            }
        }

        for (uint256 i = 0; i < numDestinations; ++i) {
            _distributeRewards(whitelistedChains[i], _extraArgs[i], tokens, distributionAmounts[i]);
        }
    }

    function handleOutgoingRESDL(
        uint64 _destinationChainSelector,
        address _sender,
        uint256 _tokenId
    )
        external
        onlyBridge
        returns (
            uint256,
            uint256,
            uint64,
            uint64,
            uint64
        )
    {
        (uint256 amount, uint256 boostAmount, uint64 startTime, uint64 duration, uint64 expiry) = ISDLPoolPrimary(sdlPool)
            .handleOutgoingRESDL(_sender, _tokenId, reSDLTokenBridge);
        reSDLSupplyByChain[_destinationChainSelector] += amount + boostAmount;
        return (amount, boostAmount, startTime, duration, expiry);
    }

    function handleIncomingRESDL(
        uint64 _sourceChainSelector,
        address _receiver,
        uint256 _tokenId,
        uint256 _amount,
        uint256 _boostAmount,
        uint64 _startTime,
        uint64 _duration,
        uint64 _expiry
    ) external onlyBridge {
        sdlToken.safeTransferFrom(reSDLTokenBridge, sdlPool, _amount);
        ISDLPoolPrimary(sdlPool).handleIncomingRESDL(
            _receiver,
            _tokenId,
            _amount,
            _boostAmount,
            _startTime,
            _duration,
            _expiry
        );
        reSDLSupplyByChain[_sourceChainSelector] -= _amount + _boostAmount;
    }

    function getWhitelistedChains() external view returns (uint64[] memory) {
        return whitelistedChains;
    }

    /**
     * @notice Whitelists a new chain
     * @param _chainSelector id of chain
     * @param _destination address to receive CCIP messages on chain
     * @param _extraArgs extraArgs for this destination as defined in CCIP docs
     **/
    function addWhitelistedChain(
        uint64 _chainSelector,
        address _destination,
        bytes calldata _extraArgs
    ) external onlyOwner {
        if (whitelistedDestinations[_chainSelector] != address(0)) revert AlreadyAdded();
        if (_destination == address(0)) revert InvalidDestination();
        whitelistedChains.push(_chainSelector);
        whitelistedDestinations[_chainSelector] = _destination;
        extraArgsByChain[_chainSelector] = _extraArgs;
        emit ChainAdded(_chainSelector, _destination, _extraArgs);
    }

    /**
     * @notice Removes an existing chain
     * @param _chainSelector id of chain
     **/
    function removeWhitelistedChain(uint64 _chainSelector) external onlyOwner {
        if (whitelistedDestinations[_chainSelector] == address(0)) revert InvalidDestination();
        emit ChainRemoved(_chainSelector, whitelistedDestinations[_chainSelector]);

        for (uint256 i = 0; i < whitelistedChains.length; ++i) {
            if (whitelistedChains[i] == _chainSelector) {
                whitelistedChains[i] = whitelistedChains[whitelistedChains.length - 1];
                whitelistedChains.pop();
            }
        }

        delete whitelistedDestinations[_chainSelector];
        delete extraArgsByChain[_chainSelector];
    }

    function setExtraArgs(uint64 _chainSelector, bytes calldata _extraArgs) external onlyOwner {
        if (whitelistedDestinations[_chainSelector] == address(0)) revert InvalidDestination();
        extraArgsByChain[_chainSelector] = _extraArgs;
        emit SetExtraArgs(_chainSelector, _extraArgs);
    }

    function _distributeRewards(
        uint64 _destinationChainSelector,
        bytes memory _extraArgs,
        address[] memory _rewardTokens,
        uint256[] memory _rewardTokenAmounts
    ) internal {
        address destination = whitelistedDestinations[_destinationChainSelector];
        if (destination == address(0)) revert InvalidDestination();

        uint256 numRewardTokensToTransfer;
        for (uint256 i = 0; i < _rewardTokens.length; ++i) {
            if (_rewardTokenAmounts[i] != 0) {
                numRewardTokensToTransfer++;
            }
        }

        if (numRewardTokensToTransfer == 0) return;

        address[] memory rewardTokens = new address[](numRewardTokensToTransfer);
        uint256[] memory rewardTokenAmounts = new uint256[](numRewardTokensToTransfer);
        uint256 tokensAdded;
        for (uint256 i = 0; i < _rewardTokens.length; ++i) {
            if (_rewardTokenAmounts[i] != 0) {
                rewardTokens[tokensAdded] = _rewardTokens[i];
                rewardTokenAmounts[tokensAdded] = _rewardTokenAmounts[i];
                tokensAdded++;
            }
        }

        Client.EVM2AnyMessage memory evm2AnyMessage = _buildCCIPMessage(
            destination,
            0,
            rewardTokens,
            rewardTokenAmounts,
            _extraArgs
        );

        IRouterClient router = IRouterClient(this.getRouter());
        uint256 fees = router.getFee(_destinationChainSelector, evm2AnyMessage);

        if (fees > maxLINKFee) revert FeeExceedsLimit(fees);
        bytes32 messageId = router.ccipSend(_destinationChainSelector, evm2AnyMessage);

        emit DistributeRewards(messageId, _destinationChainSelector, fees);
    }

    function _ccipReceive(Client.Any2EVMMessage memory _any2EvmMessage) internal override {
        address sender = abi.decode(_any2EvmMessage.sender, (address));
        uint64 sourceChainSelector = _any2EvmMessage.sourceChainSelector;
        if (sender != whitelistedDestinations[sourceChainSelector]) revert SenderNotAuthorized();

        (uint256 numNewRESDLTokens, int256 totalRESDLSupplyChange) = abi.decode(_any2EvmMessage.data, (uint256, int256));

        if (totalRESDLSupplyChange > 0) {
            reSDLSupplyByChain[sourceChainSelector] += uint256(totalRESDLSupplyChange);
        } else if (totalRESDLSupplyChange > 0) {
            reSDLSupplyByChain[sourceChainSelector] -= uint256(-1 * totalRESDLSupplyChange);
        }

        uint256 mintStartIndex = ISDLPoolPrimary(sdlPool).handleIncomingUpdate(numNewRESDLTokens, totalRESDLSupplyChange);

        _ccipSendUpdate(sourceChainSelector, mintStartIndex);

        emit MessageReceived(_any2EvmMessage.messageId, sourceChainSelector);
    }

    function _ccipSendUpdate(uint64 _destinationChainSelector, uint256 _mintStartIndex) internal {
        Client.EVM2AnyMessage memory evm2AnyMessage = _buildCCIPMessage(
            whitelistedDestinations[_destinationChainSelector],
            _mintStartIndex,
            new address[](0),
            new uint256[](0),
            extraArgsByChain[_destinationChainSelector]
        );

        IRouterClient router = IRouterClient(this.getRouter());
        uint256 fees = router.getFee(_destinationChainSelector, evm2AnyMessage);

        if (fees > maxLINKFee) revert FeeExceedsLimit(fees);
        bytes32 messageId = router.ccipSend(_destinationChainSelector, evm2AnyMessage);

        emit MessageSent(messageId, _destinationChainSelector, fees);
    }

    function _buildCCIPMessage(
        address _destination,
        uint256 _mintStartIndex,
        address[] memory _tokens,
        uint256[] memory _tokenAmounts,
        bytes memory _extraArgs
    ) internal view returns (Client.EVM2AnyMessage memory) {
        bool isRewardDistribution = _tokens.length != 0;

        Client.EVMTokenAmount[] memory tokenAmounts = new Client.EVMTokenAmount[](_tokens.length);
        for (uint256 i = 0; i < _tokenAmounts.length; ++i) {
            tokenAmounts[i] = Client.EVMTokenAmount({token: _tokens[i], amount: _tokenAmounts[i]});
        }

        Client.EVM2AnyMessage memory evm2AnyMessage = Client.EVM2AnyMessage({
            receiver: abi.encode(_destination),
            data: isRewardDistribution ? bytes("") : abi.encode(_mintStartIndex),
            tokenAmounts: tokenAmounts,
            extraArgs: _extraArgs,
            feeToken: address(linkToken)
        });

        return evm2AnyMessage;
    }
}
