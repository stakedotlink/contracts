// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

interface IOperatorController {
    function initiateKeyPairValidation(address _sender, uint256 _operatorId) external;

    function reportKeyPairValidation(uint256 _operatorId, bool _success) external;

    function queueLength() external view returns (uint256);

    function totalActiveValidators() external view returns (uint256);

    function totalActiveStake() external view returns (uint256);

    function currentStateHash() external view returns (bytes32);

    function assignNextValidators(
        uint256 _validatorCount,
        uint256[] calldata _operatorIds,
        uint256[] calldata _validatorCounts
    ) external returns (bytes memory keys, bytes memory signatures);

    function getNextValidators(uint256 _validatorCount)
        external
        view
        returns (
            bytes memory keys,
            uint256 validatorsAssigned,
            uint256[] memory operatorIds,
            uint256[] memory validatorCounts
        );

    function depositAmount() external view returns (uint256);
}
