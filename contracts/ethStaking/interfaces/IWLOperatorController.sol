// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "./IOperatorController.sol";

interface IWLOperatorController is IOperatorController {
    function assignNextValidators(
        uint[] calldata _operatorIds,
        uint[] calldata _validatorCounts,
        uint _totalValidatorCount
    ) external returns (bytes memory keys, bytes memory signatures);
}
