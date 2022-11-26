// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

interface IStaking {
    function getCommunityStakerLimits() external view returns (uint256, uint256);

    function getOperatorLimits() external view returns (uint256, uint256);

    function getMaxPoolSize() external view returns (uint256);

    function getTotalStakedAmount() external view returns (uint256);

    function isActive() external view returns (bool);

    function isOperator(address staker) external view returns (bool);

    function getStake(address staker) external view returns (uint256);

    function migrate(bytes calldata data) external;

    function getBaseReward(address staker) external view returns (uint256);

    function getDelegationReward(address staker) external view returns (uint256);

    function getMigrationTarget() external view returns (address);

    function isPaused() external view returns (bool);

    function raiseAlert() external;
}
