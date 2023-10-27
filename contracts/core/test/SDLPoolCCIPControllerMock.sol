// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/ISDLPool.sol";

contract SDLPoolCCIPControllerMock {
    using SafeERC20 for IERC20;

    IERC20 public sdlToken;
    ISDLPool public sdlPool;
    address public reSDLTokenBridge;

    error OnlySelf();
    error OnlyRESDLTokenBridge();

    modifier onlyBridge() {
        if (msg.sender != reSDLTokenBridge) revert OnlyRESDLTokenBridge();
        _;
    }

    constructor(address _sdlToken, address _sdlPool) {
        sdlToken = IERC20(_sdlToken);
        sdlPool = ISDLPool(_sdlPool);
    }

    function handleOutgoingRESDL(address _sender, uint256 _tokenId)
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
        return sdlPool.burn(_sender, _tokenId, reSDLTokenBridge);
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
        sdlToken.safeTransferFrom(reSDLTokenBridge, address(sdlPool), _amount);
        sdlPool.mint(_receiver, _tokenId, _amount, _boostAmount, _startTime, _duration, _expiry);
    }

    function setRESDLTokenBridge(address _reSDLTokenBridge) external {
        reSDLTokenBridge = _reSDLTokenBridge;
    }
}
