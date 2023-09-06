// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

interface IStaking {
    function getStakerPrincipal(address _staker) external view returns (uint256);

    function getMaxPoolSize() external view returns (uint256);

    function getTotalPrincipal() external view returns (uint256);

    function getStakerLimits() external view returns (uint256, uint256);

    function migrate(bytes calldata data) external;
}
