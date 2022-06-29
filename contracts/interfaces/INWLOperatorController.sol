// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;

import "./IOperatorController.sol";

interface INWLOperatorController is IOperatorController {
    function activeStake() external view returns (uint);
}
