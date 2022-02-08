// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.11;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IRewardsPool is IERC20 {
    function updateReward(address _account) external;

    function withdraw() external;

    function depositReward(uint256 _reward) external;
}
