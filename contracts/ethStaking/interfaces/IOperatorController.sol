// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

interface IOperatorController {
    function initiateKeyPairValidation(address _sender, uint _operatorId) external;

    function reportKeyPairValidation(uint _operatorId, bool _success) external;

    function queueLength() external view returns (uint);

    function totalActiveValidators() external view returns (uint);

    function currentStateHash() external view returns (bytes32);
}
