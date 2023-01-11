// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "./IERC677.sol";

interface IDelegatorPool is IERC677 {
    function stakeAllowance(address _account, uint256 _amount) external;

    function totalBalanceOf(address _account) external view returns (uint256);
}
