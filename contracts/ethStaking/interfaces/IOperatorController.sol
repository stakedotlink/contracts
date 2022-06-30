// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

interface IOperatorController {
    function assignNextValidators(uint _numValidators) external returns (bytes memory pubkeys, bytes memory signatures);

    function activeValidators() external view returns (uint);
}
