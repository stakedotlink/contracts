// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;

import "./IERC677.sol";

interface IRewardsPoolController {
    function rpcStaked(address _account) external view returns (uint);

    function rpcTotalStaked() external view returns (uint);
}
