// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "./IVault.sol";

interface IOperatorVault is IVault {
    function getRewards() external view returns (uint256);

    function updateRewards() external;

    function setOperator(address _operator) external;

    function setRewardsReceiver(address _rewardsReceiver) external;
}
