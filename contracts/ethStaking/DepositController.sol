// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts/access/Ownable.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";

import "./interfaces/IDepositContract.sol";
import "./interfaces/IEthStakingStrategy.sol";
import "./interfaces/IOperatorController.sol";

/**
 * @title Deposit Controller
 * @notice Initiates ETH deposits and handles pre-deposit security checks
 */
contract DepositController is Ownable {
    uint256 public constant PUBKEY_LENGTH = 48;

    IDepositContract public depositContract;
    IEthStakingStrategy public ethStakingStrategy;

    constructor(address _depositContract, address _ethStakingStrategy) {
        depositContract = IDepositContract(_depositContract);
        ethStakingStrategy = IEthStakingStrategy(_ethStakingStrategy);
    }

    /**
     * @notice initiates ether deposit
     * @dev params should be passed along from getNextValidators
     * @param _depositRoot deposit contract deposit root at time of key verification
     * @param _operatorStateHash current state hash of operator controllers
     * @param _depositAmounts list of deposit amounts for each operator controller
     * @param _validatorsAssigned list of total number of validators to assign for each operator controller
     * @param _operatorIds list of operator ids that should be assigned validators for each operator controller
     * @param _validatorCounts list of validator counts to assign operators for each operator controller
     */
    function depositEther(
        bytes32 _depositRoot,
        bytes32 _operatorStateHash,
        uint256[] calldata _depositAmounts,
        uint256[] calldata _validatorsAssigned,
        uint256[][] calldata _operatorIds,
        uint256[][] calldata _validatorCounts
    ) external onlyOwner {
        bytes32 depositRoot = depositContract.get_deposit_root();
        bytes32 operatorStateHash = _getOperatorStateHash();

        require(_depositRoot == depositRoot, "depositRoot has changed");
        require(_operatorStateHash == operatorStateHash, "operatorStateHash has changed");

        ethStakingStrategy.depositEther(_depositAmounts, _validatorsAssigned, _operatorIds, _validatorCounts);
    }

    /**
     * @notice returns next set of validators and current state of contracts
     * @dev returned keys should be verified off-chain, then depositEther should be called
     * @param _validatorCount total number of validators to assign
     * @return depositRoot deposit contract deposit root
     * @return operatorStateHash current state hash of operator controllers
     * @return depositAmounts list of deposit amounts for each operator controller
     * @return validatorsAssigned list of total number of validators to assign for each operator controller
     * @return operatorIds list of operator ids that should be assigned validators for each operator controller
     * @return validatorCounts list of validator counts to assign operators for each operator controller
     * @return keys keys to be assigned
     */
    function getNextValidators(uint256 _validatorCount)
        external
        view
        returns (
            bytes32 depositRoot,
            bytes32 operatorStateHash,
            uint256[] memory depositAmounts,
            uint256[] memory validatorsAssigned,
            uint256[][] memory operatorIds,
            uint256[][] memory validatorCounts,
            bytes memory keys
        )
    {
        require(_validatorCount <= _getTotalQueueLength(), "not enough validators in queue");

        address[] memory operatorControllers = ethStakingStrategy.getOperatorControllers();

        depositRoot = depositContract.get_deposit_root();
        operatorStateHash = _getOperatorStateHash();
        depositAmounts = new uint256[](operatorControllers.length);
        validatorsAssigned = new uint256[](operatorControllers.length);
        operatorIds = new uint256[][](operatorControllers.length);
        validatorCounts = new uint256[][](operatorControllers.length);

        uint256 toAssign = _validatorCount;
        bytes memory currentKeys;
        uint256 currentValidatorsAssigned;
        uint256[] memory currentOperatorIds;
        uint256[] memory currentValidatorCounts;

        for (uint256 i = 0; i < operatorControllers.length; ++i) {
            IOperatorController operatorController = IOperatorController(operatorControllers[i]);
            uint256 queueLength = operatorController.queueLength();

            (currentKeys, currentValidatorsAssigned, currentOperatorIds, currentValidatorCounts) = operatorController
                .getNextValidators(queueLength <= toAssign ? queueLength : toAssign);

            for (uint256 j = 0; j < currentValidatorsAssigned; ++j) {
                bytes memory key = BytesLib.slice(currentKeys, j * PUBKEY_LENGTH, PUBKEY_LENGTH);
                keys = bytes.concat(keys, key);
            }

            depositAmounts[i] = operatorController.depositAmount();
            validatorsAssigned[i] = currentValidatorsAssigned;
            operatorIds[i] = currentOperatorIds;
            validatorCounts[i] = currentValidatorCounts;

            toAssign -= currentValidatorsAssigned;
            if (toAssign == 0) break;
        }
    }

    function _getTotalQueueLength() internal view returns (uint256) {
        address[] memory operatorControllers = ethStakingStrategy.getOperatorControllers();
        uint256 queueLength;
        for (uint256 i = 0; i < operatorControllers.length; ++i) {
            queueLength += IOperatorController(operatorControllers[i]).queueLength();
        }
        return queueLength;
    }

    function _getOperatorStateHash() internal view returns (bytes32) {
        address[] memory operatorControllers = ethStakingStrategy.getOperatorControllers();
        bytes32 operatorStateHash = keccak256("initialState");
        for (uint256 i = 0; i < operatorControllers.length; ++i) {
            operatorStateHash = keccak256(
                abi.encodePacked(operatorStateHash, IOperatorController(operatorControllers[i]).currentStateHash())
            );
        }
        return operatorStateHash;
    }
}
