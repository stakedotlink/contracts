// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import "./base/SDLPoolCCIPController.sol";
import "../interfaces/IERC677.sol";

interface ISDLPoolPrimary is ISDLPool {
    function handleIncomingUpdate(uint256 _numNewRESDLTokens, int256 _totalRESDLSupplyChange) external returns (uint256);
}

contract SDLPoolCCIPControllerPrimary is SDLPoolCCIPController {
    using SafeERC20 for IERC20;

    uint64[] internal whitelistedChains;
    mapping(uint64 => address) public whitelistedDestinations;

    mapping(uint64 => bytes) public updateExtraArgsByChain;
    mapping(uint64 => bytes) public rewardsExtraArgsByChain;
    mapping(uint64 => uint256) public reSDLSupplyByChain;

    mapping(address => address) public wrappedRewardTokens;

    address public rewardsInitiator;

    event DistributeRewards(bytes32 indexed messageId, uint64 indexed destinationChainSelector, uint256 fees);
    event ChainAdded(uint64 indexed chainSelector, address destination, bytes updateExtraArgs, bytes rewardsExtraArgs);
    event ChainRemoved(uint64 indexed chainSelector, address destination);
    event SetUpdateExtraArgs(uint64 indexed chainSelector, bytes extraArgs);
    event SetRewardsExtraArgs(uint64 indexed chainSelector, bytes extraArgs);
    event SetWrappedRewardToken(address indexed token, address rewardToken);

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
    ) SDLPoolCCIPController(_router, _linkToken, _sdlToken, _sdlPool, _maxLINKFee) {}

    modifier onlyRewardsInitiator() {
        if (msg.sender != rewardsInitiator) revert SenderNotAuthorized();
        _;
    }

    /**
     * @notice Claims and distributes rewards between all secondary chains
     **/
    function distributeRewards() external onlyRewardsInitiator {
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
                tokens[i] = wrappedToken;
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
            _distributeRewards(whitelistedChains[i], tokens, distributionAmounts[i]);
        }
    }

    /**
     * @notice Handles the outgoing transfer of an reSDL token to another chain
     * @param _destinationChainSelector id of the destination chain
     * @param _sender sender of the transfer
     * @param _tokenId id of token
     * @return the destination address
     * @return the token being transferred
     **/
    function handleOutgoingRESDL(
        uint64 _destinationChainSelector,
        address _sender,
        uint256 _tokenId
    ) external override onlyBridge returns (address, ISDLPool.RESDLToken memory) {
        if (whitelistedDestinations[_destinationChainSelector] == address(0)) revert InvalidDestination();
        ISDLPool.RESDLToken memory reSDLToken = ISDLPoolPrimary(sdlPool).handleOutgoingRESDL(
            _sender,
            _tokenId,
            address(this)
        );
        reSDLSupplyByChain[_destinationChainSelector] += reSDLToken.amount + reSDLToken.boostAmount;
        return (whitelistedDestinations[_destinationChainSelector], reSDLToken);
    }

    /**
     * @notice Handles the incoming transfer of an reSDL token from another chain
     * @param _sourceChainSelector id of the source chain
     * @param _receiver receiver of the transfer
     * @param _tokenId id of reSDL token
     * @param _reSDLToken reSDL token
     **/
    function handleIncomingRESDL(
        uint64 _sourceChainSelector,
        address _receiver,
        uint256 _tokenId,
        ISDLPool.RESDLToken calldata _reSDLToken
    ) external override onlyBridge {
        sdlToken.safeTransfer(sdlPool, _reSDLToken.amount);
        ISDLPoolPrimary(sdlPool).handleIncomingRESDL(_receiver, _tokenId, _reSDLToken);
        reSDLSupplyByChain[_sourceChainSelector] -= _reSDLToken.amount + _reSDLToken.boostAmount;
    }

    /**
     * @notice Returns a list of all whitelisted chains
     * @return list of whitelisted chain ids
     **/
    function getWhitelistedChains() external view returns (uint64[] memory) {
        return whitelistedChains;
    }

    /**
     * @notice Whitelists a new chain
     * @param _chainSelector id of chain
     * @param _destination address to receive CCIP messages on chain
     * @param _updateExtraArgs extraArgs for sending updates to this destination as defined in CCIP docs
     * @param _rewardsExtraArgs extraArgs for sending rewards to this destination as defined in CCIP docs
     **/
    function addWhitelistedChain(
        uint64 _chainSelector,
        address _destination,
        bytes calldata _updateExtraArgs,
        bytes calldata _rewardsExtraArgs
    ) external onlyOwner {
        if (whitelistedDestinations[_chainSelector] != address(0)) revert AlreadyAdded();
        if (_destination == address(0)) revert InvalidDestination();
        whitelistedChains.push(_chainSelector);
        whitelistedDestinations[_chainSelector] = _destination;
        updateExtraArgsByChain[_chainSelector] = _updateExtraArgs;
        rewardsExtraArgsByChain[_chainSelector] = _rewardsExtraArgs;
        emit ChainAdded(_chainSelector, _destination, _updateExtraArgs, _rewardsExtraArgs);
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
        delete updateExtraArgsByChain[_chainSelector];
        delete rewardsExtraArgsByChain[_chainSelector];
    }

    /**
     * @notice Approves the CCIP router to transfer tokens on behalf of this contract
     * @param _tokens list of tokens to approve
     **/
    function approveRewardTokens(address[] calldata _tokens) external onlyOwner {
        address router = getRouter();
        for (uint256 i = 0; i < _tokens.length; i++) {
            IERC20(_tokens[i]).safeApprove(router, type(uint256).max);
        }
    }

    /**
     * @notice Sets the wrapped token address for a reward token
     * @param _token address of token
     * @param _wrappedToken address of wrapped token
     **/
    function setWrappedRewardToken(address _token, address _wrappedToken) external onlyOwner {
        wrappedRewardTokens[_token] = _wrappedToken;
        emit SetWrappedRewardToken(_token, _wrappedToken);
    }

    /**
     * @notice Sets the extra args used for sending updates to a chain
     * @param _chainSelector id of chain
     * @param _updateExtraArgs extra args as defined in CCIP API
     **/
    function setUpdateExtraArgs(uint64 _chainSelector, bytes calldata _updateExtraArgs) external onlyOwner {
        if (whitelistedDestinations[_chainSelector] == address(0)) revert InvalidDestination();
        updateExtraArgsByChain[_chainSelector] = _updateExtraArgs;
        emit SetUpdateExtraArgs(_chainSelector, _updateExtraArgs);
    }

    /**
     * @notice Sets the extra args used for sending rewards to a chain
     * @param _chainSelector id of chain
     * @param _rewardsExtraArgs extra args as defined in CCIP API
     **/
    function setRewardsExtraArgs(uint64 _chainSelector, bytes calldata _rewardsExtraArgs) external onlyOwner {
        if (whitelistedDestinations[_chainSelector] == address(0)) revert InvalidDestination();
        rewardsExtraArgsByChain[_chainSelector] = _rewardsExtraArgs;
        emit SetRewardsExtraArgs(_chainSelector, _rewardsExtraArgs);
    }

    /**
     * @notice Sets the rewards initiator
     * @dev this address has sole authority to update rewards
     * @param _rewardsInitiator address of rewards initiator
     **/
    function setRewardsInitiator(address _rewardsInitiator) external onlyOwner {
        rewardsInitiator = _rewardsInitiator;
    }

    /**
     * @notice Distributes rewards to a single chain
     * @param _destinationChainSelector id of chain
     * @param _rewardTokens list of reward tokens to distribute
     * @param _rewardTokenAmounts list of reward token amounts to distribute
     **/
    function _distributeRewards(
        uint64 _destinationChainSelector,
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
            rewardsExtraArgsByChain[_destinationChainSelector]
        );

        IRouterClient router = IRouterClient(this.getRouter());
        uint256 fees = router.getFee(_destinationChainSelector, evm2AnyMessage);

        if (fees > maxLINKFee) revert FeeExceedsLimit(fees);
        bytes32 messageId = router.ccipSend(_destinationChainSelector, evm2AnyMessage);

        emit DistributeRewards(messageId, _destinationChainSelector, fees);
    }

    /**
     * @notice Processes a received message
     * @dev handles incoming updates from a secondary chain and sends an update in response
     * @param _message CCIP message
     **/
    function _ccipReceive(Client.Any2EVMMessage memory _message) internal override {
        uint64 sourceChainSelector = _message.sourceChainSelector;

        (uint256 numNewRESDLTokens, int256 totalRESDLSupplyChange) = abi.decode(_message.data, (uint256, int256));

        if (totalRESDLSupplyChange > 0) {
            reSDLSupplyByChain[sourceChainSelector] += uint256(totalRESDLSupplyChange);
        } else if (totalRESDLSupplyChange < 0) {
            reSDLSupplyByChain[sourceChainSelector] -= uint256(-1 * totalRESDLSupplyChange);
        }

        uint256 mintStartIndex = ISDLPoolPrimary(sdlPool).handleIncomingUpdate(numNewRESDLTokens, totalRESDLSupplyChange);

        _ccipSendUpdate(sourceChainSelector, mintStartIndex);

        emit MessageReceived(_message.messageId, sourceChainSelector);
    }

    /**
     * @notice Sends an update to a secondary chain
     * @param _destinationChainSelector id of destination chain
     * @param _mintStartIndex first index to be used for minting new reSDL tokens
     **/
    function _ccipSendUpdate(uint64 _destinationChainSelector, uint256 _mintStartIndex) internal {
        Client.EVM2AnyMessage memory evm2AnyMessage = _buildCCIPMessage(
            whitelistedDestinations[_destinationChainSelector],
            _mintStartIndex,
            new address[](0),
            new uint256[](0),
            updateExtraArgsByChain[_destinationChainSelector]
        );

        IRouterClient router = IRouterClient(this.getRouter());
        uint256 fees = router.getFee(_destinationChainSelector, evm2AnyMessage);

        if (fees > maxLINKFee) revert FeeExceedsLimit(fees);
        bytes32 messageId = router.ccipSend(_destinationChainSelector, evm2AnyMessage);

        emit MessageSent(messageId, _destinationChainSelector, fees);
    }

    /**
     * @notice Builds a CCIP message
     * @dev builds the message for reward distribution or outgoing updates to a secondary chain
     * @param _destination address of destination contract
     * @param _mintStartIndex first index to be used for minting new reSDL tokens
     * @param _tokens list of tokens to transfer
     * @param _tokenAmounts list of token amounts to transfer
     * @param _extraArgs encoded args as defined in CCIP API
     **/
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

    /**
     * @notice Verifies the sender of a CCIP message is whitelisted
     * @param _message CCIP message
     **/
    function _verifyCCIPSender(Client.Any2EVMMessage memory _message) internal view override {
        address sender = abi.decode(_message.sender, (address));
        uint64 sourceChainSelector = _message.sourceChainSelector;
        if (sender != whitelistedDestinations[sourceChainSelector]) revert SenderNotAuthorized();
    }
}
