// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

interface ISDLPoolCCIPController {
    function handleOutgoingRESDL(address _sender, uint256 _lockId)
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
