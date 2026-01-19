// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

interface IEspressoRewards {
    function claimRewards(uint256 _lifetimeRewards, bytes calldata _authData) external;

    function claimedRewards(address _claimer) external view returns (uint256);
}
