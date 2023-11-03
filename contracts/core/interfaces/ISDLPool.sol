// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "./IRewardsPoolController.sol";

interface ISDLPool is IRewardsPoolController {
    function effectiveBalanceOf(address _account) external view returns (uint256);

    function ownerOf(uint256 _lockId) external view returns (address);

    function supportedTokens() external view returns (address[] memory);

    function handleOutgoingRESDL(
        address _sender,
        uint256 _lockId,
        address _sdlReceiver
    )
        external
        returns (
            uint256 _amount,
            uint256 _boostAmount,
            uint64 _startTime,
            uint64 _duration,
            uint64 _expiry
        );

    function handleIncomingRESDL(
        address _receiver,
        uint256 _lockId,
        uint256 _amount,
        uint256 _boostAmount,
        uint64 _startTime,
        uint64 _duration,
        uint64 _expiry
    ) external;
}
