// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

interface IEspressoVault {
    function deposit(uint256 _amount) external;

    function unbond(uint256 _amount) external;

    function withdraw() external;

    function restakeRewards(uint256 _lifetimeRewards, bytes calldata _authData) external;

    function withdrawRewards(uint256 _lifetimeRewards, bytes calldata _authData) external;

    function updateLifetimeRewards(uint256 _lifetimeRewards) external;

    function claimValidatorExit() external;

    function getPrincipalDeposits() external view returns (uint256);

    function getQueuedWithdrawals() external view returns (uint256);

    function getRewards() external view returns (uint256);

    function getTotalDeposits() external view returns (uint256);

    function isUnbonding() external view returns (bool);

    function isWithdrawable() external view returns (bool);

    function isActive() external view returns (bool);

    function exitIsWithdrawable() external view returns (bool);

    function upgradeTo(address newImplementation) external;

    function upgradeToAndCall(address newImplementation, bytes memory data) external;
}
