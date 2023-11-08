// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import "./base/SDLPoolCCIPController.sol";
import "../interfaces/ISDLPool.sol";

interface ISDLPoolSecondary is ISDLPool {
    function handleOutgoingUpdate() external returns (uint256, int256);

    function handleIncomingUpdate(uint256 _mintStartIndex) external;

    function shouldUpdate() external view returns (bool);
}

contract SDLPoolCCIPControllerPrimary is SDLPoolCCIPController {
    using SafeERC20 for IERC20;

    uint64 internal timeOfLastUpdate;
    uint64 internal timeBetweenUpdates;

    uint64 internal primaryChainSelector;
    address internal primaryChainDestination;
    bytes internal extraArgs;

    event SetPrimaryChain(uint64 primaryChainSelector, address primaryChainDestination);

    error UpdateConditionsNotMet();

    constructor(
        address _router,
        address _linkToken,
        address _sdlToken,
        address _sdlPool,
        uint64 _primaryChainSelector,
        address _primaryChainDestination,
        bytes memory _extraArgs
    ) SDLPoolCCIPController(_router, _linkToken, _sdlToken, _sdlPool) {
        primaryChainSelector = _primaryChainSelector;
        primaryChainDestination = _primaryChainDestination;
        extraArgs = _extraArgs;
    }

    function checkUpkeep(bytes calldata) external view returns (bool, bytes memory) {
        if (ISDLPoolSecondary(sdlPool).shouldUpdate() && block.timestamp > timeOfLastUpdate + timeBetweenUpdates) {
            return (true, "0x");
        }

        return (false, "0x");
    }

    function performUpkeep(bytes calldata) external {
        if (!ISDLPoolSecondary(sdlPool).shouldUpdate() || block.timestamp <= timeOfLastUpdate + timeBetweenUpdates)
            revert UpdateConditionsNotMet();

        timeOfLastUpdate = uint64(block.timestamp);
        _initiateUpdate(primaryChainSelector, primaryChainDestination, extraArgs);
    }

    function handleOutgoingRESDL(
        address _sender,
        uint256 _tokenId
    ) external onlyBridge returns (uint256, uint256, uint64, uint64, uint64) {
        return ISDLPoolSecondary(sdlPool).handleOutgoingRESDL(_sender, _tokenId, reSDLTokenBridge);
    }

    function handleIncomingRESDL(
        address _receiver,
        uint256 _tokenId,
        uint256 _amount,
        uint256 _boostAmount,
        uint64 _startTime,
        uint64 _duration,
        uint64 _expiry
    ) external onlyBridge {
        sdlToken.safeTransferFrom(reSDLTokenBridge, sdlPool, _amount);
        ISDLPoolSecondary(sdlPool).handleIncomingRESDL(
            _receiver,
            _tokenId,
            _amount,
            _boostAmount,
            _startTime,
            _duration,
            _expiry
        );
    }

    function setPrimaryChain(uint64 _primaryChainSelector, address _primaryChainDestination) external onlyOwner {
        primaryChainSelector = _primaryChainSelector;
        primaryChainDestination = _primaryChainDestination;
        emit SetPrimaryChain(_primaryChainSelector, _primaryChainDestination);
    }

    function _initiateUpdate(uint64 _destinationChainSelector, address _destination, bytes memory _extraArgs) internal {
        (uint256 numNewRESDLTokens, int256 totalRESDLSupplyChange) = ISDLPoolSecondary(sdlPool).handleOutgoingUpdate();

        Client.EVM2AnyMessage memory evm2AnyMessage = _buildCCIPMessage(
            _destination,
            numNewRESDLTokens,
            totalRESDLSupplyChange,
            _extraArgs
        );

        IRouterClient router = IRouterClient(getRouter());
        uint256 fees = router.getFee(_destinationChainSelector, evm2AnyMessage);

        if (fees > maxLINKFee) revert FeeExceedsLimit(fees);
        bytes32 messageId = router.ccipSend(_destinationChainSelector, evm2AnyMessage);

        emit MessageSent(messageId, _destinationChainSelector, fees);
    }

    function _ccipReceive(Client.Any2EVMMessage memory _any2EvmMessage) internal override {
        address sender = abi.decode(_any2EvmMessage.sender, (address));
        uint64 sourceChainSelector = _any2EvmMessage.sourceChainSelector;
        if (sourceChainSelector != primaryChainSelector || sender != primaryChainDestination) revert SenderNotAuthorized();

        if (_any2EvmMessage.data.length == 0) {
            uint256 numRewardTokens = _any2EvmMessage.destTokenAmounts.length;
            address[] memory rewardTokens = new address[](numRewardTokens);
            if (numRewardTokens != 0) {
                for (uint256 i = 0; i < numRewardTokens; ++i) {
                    rewardTokens[i] = _any2EvmMessage.destTokenAmounts[i].token;
                    IERC20(rewardTokens[i]).safeTransfer(sdlPool, _any2EvmMessage.destTokenAmounts[i].amount);
                }
                ISDLPoolSecondary(sdlPool).distributeTokens(rewardTokens);
            }
        } else {
            uint256 mintStartIndex = abi.decode(_any2EvmMessage.data, (uint256));
            ISDLPoolSecondary(sdlPool).handleIncomingUpdate(mintStartIndex);
        }

        emit MessageReceived(_any2EvmMessage.messageId, sourceChainSelector);
    }

    function _buildCCIPMessage(
        address _destination,
        uint256 _numNewRESDLTokens,
        int256 _totalRESDLSupplyChange,
        bytes memory _extraArgs
    ) internal view returns (Client.EVM2AnyMessage memory) {
        Client.EVM2AnyMessage memory evm2AnyMessage = Client.EVM2AnyMessage({
            receiver: abi.encode(_destination),
            data: abi.encode(_numNewRESDLTokens, _totalRESDLSupplyChange),
            tokenAmounts: new Client.EVMTokenAmount[](0),
            extraArgs: _extraArgs,
            feeToken: address(linkToken)
        });

        return evm2AnyMessage;
    }
}
