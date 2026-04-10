// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

interface IStakingAdapter {
    /// @notice Stake tokens into the underlying staking protocol
    function stake(uint256 amount) external;

    /// @notice Unstake tokens and send them back to the vault
    function unstake(uint256 amount) external;

    /// @notice Begin unbonding period (if protocol requires it)
    function unbond() external;

    /// @notice Claim accumulated rewards, send to vault
    function claimRewards() external returns (uint256);

    /// @notice Begin multi-step exit (if required by underlying protocol)
    function initiateExit() external;

    /// @notice Complete multi-step exit, return all tokens to vault
    function finalizeExit() external returns (uint256);

    /// @notice Total value held by this adapter (principal + rewards)
    function getTotalDeposits() external view returns (uint256);

    /// @notice Amount the adapter can currently accept for staking
    function canStake() external view returns (uint256);

    /// @notice Amount the adapter can currently return via unstaking
    function canUnstake() external view returns (uint256);

    /// @notice The vault this adapter belongs to
    function vault() external view returns (address);
}
