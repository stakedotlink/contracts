// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "./IOperatorController.sol";

interface INWLOperatorController is IOperatorController {
    function totalActiveStake() external view returns (uint);
}
