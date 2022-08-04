// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";

import "./base/OperatorController.sol";
import "./interfaces/IOperatorWhitelist.sol";

/**
 * @title Non-Whitelist Operator Controller
 * @notice Handles non-whitelisted validator keys, operator stakes, and operator rewards distribution
 */
contract NWLOperatorController is OperatorController {
    uint public constant DEPOSIT_AMOUNT = 16 ether;

    struct QueueEntry {
        uint operatorId;
        uint numKeyPairs;
    }

    QueueEntry[] private queue;
    uint public queueIndex;
    uint public queueLength;

    uint public totalStake;
    mapping(uint => uint) public ethLost;

    constructor(address _ethStakingStrategy)
        OperatorController(_ethStakingStrategy, "Non-whitelisted Validator Token", "nwlVT")
    {}

    /**
     * @notice Returns a list of queue entries
     * @param _startIndex start index of entries to return
     * @param _numEntries number of entries to return
     * @return entries list of queue entries
     */
    function getQueueEntries(uint _startIndex, uint _numEntries) external view returns (QueueEntry[] memory entries) {
        uint endIndex = _startIndex + _numEntries;
        if (endIndex > queue.length) {
            endIndex = queue.length;
        }

        entries = new QueueEntry[](endIndex - _startIndex);
        for (uint i = _startIndex; i < endIndex; i++) {
            entries[i] = queue[i];
        }
    }

    /**
     * @notice Returns the total active stake across all validators
     * @return totalActiveStake total active stake
     */
    function totalActiveStake() external view returns (uint) {
        return totalSupply() * DEPOSIT_AMOUNT;
    }

    /**
     * @notice Adds a new operator
     * @param _name name of operator
     */
    function addOperator(string calldata _name) external {
        _addOperator(_name);
    }

    /**
     * @notice Adds a set of new validator pubkey/signature pairs for an operator
     * @param _operatorId id of operator
     * @param _quantity number of new pairs to add
     * @param _pubkeys concatenated set of pubkeys to add
     * @param _signatures concatenated set of signatures to add
     */
    function addKeyPairs(
        uint _operatorId,
        uint _quantity,
        bytes calldata _pubkeys,
        bytes calldata _signatures
    ) external payable operatorExists(_operatorId) {
        require(msg.sender == operators[_operatorId].owner, "Sender is not operator owner");
        require(msg.value == _quantity * DEPOSIT_AMOUNT, "Incorrect stake amount");
        _addKeyPairs(_operatorId, _quantity, _pubkeys, _signatures);
    }

    /**
     * @notice Removes added pubkey/signature pairs from an operator in LIFO order
     * @param _operatorId id of operator
     * @param _quantity number of pairs to remove
     * @param _queueEntryIndexes indexes of this operator's queue entries to remove
     */
    function removeKeyPairs(
        uint _operatorId,
        uint _quantity,
        uint[] calldata _queueEntryIndexes
    ) external operatorExists(_operatorId) {
        require(msg.sender == operators[_operatorId].owner, "Sender is not operator owner");
        require(_quantity > 0, "Quantity must be greater than 0");
        require(_quantity <= operators[_operatorId].totalKeyPairs, "Cannot remove more keys than are added");
        require(
            _quantity <= operators[_operatorId].totalKeyPairs - operators[_operatorId].usedKeyPairs,
            "Cannot remove used key pairs"
        );

        uint toRemove = _quantity;
        uint unverifiedKeys = operators[_operatorId].totalKeyPairs - operators[_operatorId].validatorLimit;

        if (unverifiedKeys < toRemove) {
            toRemove -= unverifiedKeys;
            queueLength -= toRemove;
            for (uint i = 0; i < _queueEntryIndexes.length; i++) {
                require(_queueEntryIndexes[i] >= queueIndex, "Cannot remove from queue entry that is already passed by");
                require(_queueEntryIndexes[i] < queue.length, "Cannot remove from queue entry that does not exist");

                QueueEntry memory entry = queue[_queueEntryIndexes[i]];
                require(entry.operatorId == _operatorId, "Sender is not operator owner of queue entry");

                if (entry.numKeyPairs < toRemove) {
                    queue[_queueEntryIndexes[i]].numKeyPairs = 0;
                    toRemove -= entry.numKeyPairs;
                } else {
                    queue[_queueEntryIndexes[i]].numKeyPairs -= toRemove;
                    break;
                }
            }
        }

        operators[_operatorId].totalKeyPairs -= uint64(_quantity);
        if (operators[_operatorId].validatorLimit > operators[_operatorId].totalKeyPairs) {
            operators[_operatorId].validatorLimit = operators[_operatorId].totalKeyPairs;
        }

        (bool success, ) = payable(msg.sender).call{value: _quantity * DEPOSIT_AMOUNT}("");
        require(success, "ETH transfer failed");
    }

    /**
     * @notice Reports the results of key pair validation for an operator
     * @param _operatorId id of operator
     * @param _success whether the pairs are valid
     */
    function reportKeyPairValidation(uint _operatorId, bool _success)
        external
        onlyKeyValidationOracle
        operatorExists(_operatorId)
    {
        require(operators[_operatorId].keyValidationInProgress, "No key validation in progress");

        if (_success) {
            uint newKeyPairs = operators[_operatorId].totalKeyPairs - operators[_operatorId].validatorLimit;
            queue.push(QueueEntry(_operatorId, newKeyPairs));
            queueLength += newKeyPairs;
            operators[_operatorId].validatorLimit = operators[_operatorId].totalKeyPairs;
        }
        operators[_operatorId].keyValidationInProgress = false;
    }

    /**
     * @notice Assigns the next set of validators in the queue
     * @param _totalValidatorCount total number of validators to assign
     * @return keys concatenated list of pubkeys
     * @return signatures concatenated list of signatures
     */
    function assignNextValidators(uint _totalValidatorCount)
        external
        onlyEthStakingStrategy
        returns (bytes memory keys, bytes memory signatures)
    {
        require(_totalValidatorCount > 0, "Validator count must be greater than 0");
        require(_totalValidatorCount <= queueLength, "Cannot assign more than queue length");
        uint toAssign = _totalValidatorCount;
        uint totalValidatorCount;
        uint index = queueIndex;

        keys = BytesUtils.unsafeAllocateBytes(toAssign * PUBKEY_LENGTH);
        signatures = BytesUtils.unsafeAllocateBytes(toAssign * SIGNATURE_LENGTH);

        while (index < queue.length) {
            uint numKeyPairs = queue[index].numKeyPairs;

            if (numKeyPairs > 0) {
                uint operatorId = queue[index].operatorId;
                uint assignToOperator;

                if (numKeyPairs < toAssign) {
                    assignToOperator = numKeyPairs;
                    toAssign -= numKeyPairs;
                } else {
                    assignToOperator = toAssign;
                    if (numKeyPairs == toAssign) {
                        index++;
                    } else {
                        queue[index].numKeyPairs -= toAssign;
                    }
                    toAssign = 0;
                }

                _updateRewards(operators[operatorId].owner);

                operators[operatorId].usedKeyPairs += uint64(assignToOperator);
                _mint(operators[operatorId].owner, assignToOperator);

                uint usedKeyPairs = operators[operatorId].usedKeyPairs;

                for (uint j = usedKeyPairs - assignToOperator; j < usedKeyPairs; j++) {
                    (bytes memory key, bytes memory signature) = _loadKeyPair(operatorId, j);
                    BytesUtils.copyBytes(key, keys, totalValidatorCount * PUBKEY_LENGTH);
                    BytesUtils.copyBytes(signature, signatures, totalValidatorCount * SIGNATURE_LENGTH);
                    totalValidatorCount++;
                }

                if (toAssign == 0) {
                    break;
                }
            }
            index++;
        }

        (bool success, ) = payable(ethStakingStrategy).call{value: totalValidatorCount * DEPOSIT_AMOUNT}("");
        require(success, "ETH transfer failed");

        totalStake += totalValidatorCount * DEPOSIT_AMOUNT;
        queueLength -= totalValidatorCount;
        queueIndex = index;
    }

    /**
     * @notice Reports lifetime stopped validators and ETH lost for a list of operators
     * @param _operatorIds list of operator ids to report for
     * @param _stoppedValidators list of lifetime stopped validators for each operator
     * @param _ethLost list of lifetime lost ETH sum for each operator
     */
    function reportStoppedValidators(
        uint[] calldata _operatorIds,
        uint[] calldata _stoppedValidators,
        uint[] calldata _ethLost
    ) external onlyBeaconOracle {
        require(
            _operatorIds.length == _stoppedValidators.length && _operatorIds.length == _ethLost.length,
            "Inconsistent list lengths"
        );

        uint totalNewlyStoppedValidators;
        uint totalNewlyLostETH;

        for (uint i = 0; i < _operatorIds.length; i++) {
            uint operatorId = _operatorIds[i];
            require(operatorId < operators.length, "Operator does not exist");
            require(
                _stoppedValidators[i] > operators[operatorId].stoppedValidators,
                "Reported negative or zero stopped validators"
            );
            require(_ethLost[i] >= ethLost[operatorId], "Reported negative lost ETH");
            require(
                (_stoppedValidators[i]) <= operators[operatorId].usedKeyPairs,
                "Reported more stopped validators than active"
            );

            _updateRewards(operators[operatorId].owner);

            uint newlyStoppedValidators = _stoppedValidators[i] - operators[operatorId].stoppedValidators;
            uint newlyLostETH = _ethLost[i] - ethLost[operatorId];

            operators[operatorId].stoppedValidators += uint64(newlyStoppedValidators);
            _burn(operators[operatorId].owner, newlyStoppedValidators);
            ethLost[operatorId] += newlyLostETH;

            totalNewlyStoppedValidators += newlyStoppedValidators;
            totalNewlyLostETH += newlyLostETH;
        }

        totalStake -= totalNewlyLostETH;
    }
}
