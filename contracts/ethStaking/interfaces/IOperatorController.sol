// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

interface IOperatorController {
    function queueLength() external view returns (uint);

    function totalActiveValidators() external view returns (uint);
}
