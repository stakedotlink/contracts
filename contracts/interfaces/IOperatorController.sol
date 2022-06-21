// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;

interface IOperatorController {
    function assignNextValidators(uint256 _numValidators) external returns (bytes memory pubkeys, bytes memory signatures);
}
