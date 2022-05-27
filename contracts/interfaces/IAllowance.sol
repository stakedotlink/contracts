// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;

import "./IERC677.sol";

interface IAllowance is IERC677 {
    function mint(address _account, uint256 _amount) external;

    function burn(address _account, uint256 _amount) external;
}
