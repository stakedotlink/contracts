// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

interface ISDLDependent {
    function updateSDLBalance(address _account, uint256 _balance) external;
}
