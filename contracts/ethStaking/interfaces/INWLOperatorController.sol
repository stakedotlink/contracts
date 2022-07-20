// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "./IOperatorController.sol";

interface INWLOperatorController is IOperatorController {
    function assignNextValidators(uint _totalValidatorCount) external returns (bytes memory keys, bytes memory signatures);

    function totalActiveStake() external view returns (uint);
}
