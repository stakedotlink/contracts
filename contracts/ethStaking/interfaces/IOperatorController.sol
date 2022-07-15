// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

interface IOperatorController {
    function addOperator(string calldata _name) external;

    function addKeyPairs(
        uint _operatorId,
        uint _quantity,
        bytes calldata _pubkeys,
        bytes calldata _signatures
    ) external;

    function assignNextValidators(
        uint[] calldata _operatorIds,
        uint[] calldata _numValidators,
        uint _totalValidatorCount
    ) external returns (bytes memory keys, bytes memory signatures);

    function totalActiveValidators() external view returns (uint);
}
