// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";

import "../lib/BytesUtils.sol";
import "../../core/interfaces/IRewardsPool.sol";
import "../../core/interfaces/IERC677.sol";

/**
 * @title Operator Controller
 * @notice Base controller contract to be inherited from
 */
abstract contract OperatorController is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    uint public constant PUBKEY_LENGTH = 48;
    uint public constant SIGNATURE_LENGTH = 96;

    struct Operator {
        string name;
        address owner;
        bool active;
        bool keyValidationInProgress;
        uint64 validatorLimit;
        uint64 stoppedValidators;
        uint64 totalKeyPairs;
        uint64 usedKeyPairs;
    }

    address public ethStakingStrategy;
    address public keyValidationOracle;
    address public beaconOracle;

    IERC677 public wsdToken;
    IRewardsPool public rewardsPool;

    Operator[] internal operators;

    uint public totalActiveValidators;
    mapping(address => uint) internal activeValidators;

    event AddOperator(address indexed owner, string name);
    event OperatorOwnerChange(uint indexed operatorId, address indexed from, address indexed to);
    event AddKeyPairs(uint indexed operatorId, uint quantity);

    modifier operatorExists(uint _id) {
        require(_id < operators.length, "Operator does not exist");
        _;
    }

    modifier onlyKeyValidationOracle() {
        require(msg.sender == keyValidationOracle, "Sender is not key validation oracle");
        _;
    }

    modifier onlyBeaconOracle() {
        require(msg.sender == keyValidationOracle, "Sender is not beacon oracle");
        _;
    }

    modifier onlyEthStakingStrategy() {
        require(msg.sender == ethStakingStrategy, "Sender is not ETH staking strategy");
        _;
    }

    function __OperatorController_init(address _ethStakingStrategy, address _wsdToken) public onlyInitializing {
        __UUPSUpgradeable_init();
        __Ownable_init();
        ethStakingStrategy = _ethStakingStrategy;
        wsdToken = IERC677(_wsdToken);
    }

    /**
     * @notice returns an account's stake balance for use by reward pools
     * controlled by this contract
     * @return account's balance
     */
    function staked(address _account) public view returns (uint) {
        return activeValidators[_account];
    }

    /**
     * @notice returns the total staked amount for use by reward pools
     * controlled by this contract
     * @return total staked amount
     */
    function totalStaked() public view returns (uint) {
        return totalActiveValidators;
    }

    /**
     * @notice returns a list of operators
     * @param _operatorIds id list of operators to return
     * @return operators list of opertors
     */
    function getOperators(uint[] calldata _operatorIds) external view returns (Operator[] memory) {
        Operator[] memory ret = new Operator[](_operatorIds.length);
        for (uint i = 0; i < _operatorIds.length; i++) {
            require(_operatorIds[i] < operators.length, "Operator does not exist");
            ret[i] = operators[_operatorIds[i]];
        }
        return ret;
    }

    /**
     * @notice returns a list key/signature pairs for an operator
     * @param _operatorId id of operator to return pairs for
     * @param _startIndex index of first pair to return
     * @param _numPairs total number of pairs to return
     * @return keys concatenated list of pubkeys
     * @return signatures concatenated list of signatures
     */
    function getKeyPairs(
        uint _operatorId,
        uint _startIndex,
        uint _numPairs
    ) external view operatorExists(_operatorId) returns (bytes memory keys, bytes memory signatures) {
        uint endIndex = _startIndex + _numPairs;
        if (endIndex > operators[_operatorId].totalKeyPairs) {
            endIndex = operators[_operatorId].totalKeyPairs;
        }

        keys = BytesUtils.unsafeAllocateBytes((endIndex - _startIndex) * PUBKEY_LENGTH);
        signatures = BytesUtils.unsafeAllocateBytes((endIndex - _startIndex) * SIGNATURE_LENGTH);

        uint copiedPairs;

        for (uint i = _startIndex; i < endIndex; i++) {
            (bytes memory key, bytes memory signature) = _loadKeyPair(_operatorId, i);
            BytesUtils.copyBytes(key, keys, copiedPairs * PUBKEY_LENGTH);
            BytesUtils.copyBytes(signature, signatures, copiedPairs * SIGNATURE_LENGTH);
            copiedPairs++;
        }
    }

    function onTokenTransfer(
        address _sender,
        uint256 _value,
        bytes calldata _data
    ) external {
        require(msg.sender == address(wsdToken), "Sender is not wsdToken");
        wsdToken.transferAndCall(address(rewardsPool), _value, "0x00");
    }

    function withdrawRewards() public {
        rewardsPool.withdraw(msg.sender);
    }

    function withdrawableRewards(address _account) external view returns (uint) {
        return rewardsPool.balanceOf(_account);
    }

    function initiateKeyPairValidation(uint _operatorId) external onlyKeyValidationOracle operatorExists(_operatorId) {
        operators[_operatorId].keyValidationInProgress = true;
    }

    /**
     * @notice Sets the name of an existing operator
     * @param _name new name of operator
     */
    function setOperatorName(uint _operatorId, string calldata _name) external operatorExists(_operatorId) {
        require(msg.sender == operators[_operatorId].owner, "Sender is not operator owner");
        operators[_operatorId].name = _name;
    }

    /**
     * @notice Sets the owner of an existing operator
     * @dev this address will receive rewards and is authorized to modify all
     * attributes of the operator
     * @param _operatorId id of operator
     * @param _owner new owner of operator
     */
    function setOperatorOwner(uint _operatorId, address _owner) external operatorExists(_operatorId) {
        require(msg.sender == operators[_operatorId].owner, "Sender is not operator owner");
        require(_owner != address(0), "Owner address cannot be 0");

        uint operatorActiveValidators = operators[_operatorId].usedKeyPairs - operators[_operatorId].stoppedValidators;
        activeValidators[_owner] += operatorActiveValidators;
        activeValidators[msg.sender] -= operatorActiveValidators;
        operators[_operatorId].owner = _owner;

        emit OperatorOwnerChange(_operatorId, msg.sender, _owner);
    }

    /**
     * @notice Sets the active status of an operator
     * @param _operatorId id of operator
     * @param _active status of operator
     */
    function setOperatorActive(uint _operatorId, bool _active) external onlyOwner operatorExists(_operatorId) {
        operators[_operatorId].active = _active;
    }

    function setKeyValidationOracle(address _keyValidationOracle) external onlyOwner {
        keyValidationOracle = _keyValidationOracle;
    }

    function setBeaconOracle(address _beaconOracle) external onlyOwner {
        beaconOracle = _beaconOracle;
    }

    function setRewardsPool(address _rewardsPool) external onlyOwner {
        rewardsPool = IRewardsPool(_rewardsPool);
    }

    /**
     * @notice Adds a new operator
     * @param _name name of operator
     */
    function _addOperator(string calldata _name) internal {
        Operator memory operator = Operator(_name, msg.sender, true, false, 0, 0, 0, 0);
        operators.push(operator);

        emit AddOperator(msg.sender, _name);
    }

    /**
     * @notice Adds a set of new validator pubkey/signature pairs for an operator
     * @param _operatorId id of operator
     * @param _quantity number of new pairs to add
     * @param _pubkeys concatenated set of pubkeys to add
     * @param _signatures concatenated set of signatures to add
     */
    function _addKeyPairs(
        uint _operatorId,
        uint _quantity,
        bytes calldata _pubkeys,
        bytes calldata _signatures
    ) internal {
        require(!operators[_operatorId].keyValidationInProgress, "Key validation in progress");
        require(_pubkeys.length == _quantity * PUBKEY_LENGTH, "Invalid pubkeys length");
        require(_signatures.length == _quantity * SIGNATURE_LENGTH, "Invalid signatures length");

        for (uint256 i = 0; i < _quantity; ++i) {
            bytes memory key = BytesLib.slice(_pubkeys, i * PUBKEY_LENGTH, PUBKEY_LENGTH);
            require(!_isEmptyKey(key), "Empty key");
            bytes memory signature = BytesLib.slice(_signatures, i * SIGNATURE_LENGTH, SIGNATURE_LENGTH);

            _storeKeyPair(_operatorId, operators[_operatorId].totalKeyPairs + i, key, signature);
        }

        operators[_operatorId].totalKeyPairs += uint64(_quantity);

        emit AddKeyPairs(_operatorId, _quantity);
    }

    /**
     * @notice Stores a pubkey/signature pair
     * @param _operatorId id of operator that owns pair
     * @param _keyIndex index of pair
     * @param _key key to store
     * @param _signature signature to store
     */
    function _storeKeyPair(
        uint _operatorId,
        uint _keyIndex,
        bytes memory _key,
        bytes memory _signature
    ) internal {
        assert(_key.length == PUBKEY_LENGTH);
        assert(_signature.length == SIGNATURE_LENGTH);

        // key
        uint storageAddress = _keyPairStorageAddress(_operatorId, _keyIndex);
        uint keyExcessBits = (2 * 32 - PUBKEY_LENGTH) * 8;
        assembly {
            sstore(storageAddress, mload(add(_key, 0x20)))
            sstore(add(storageAddress, 1), shl(keyExcessBits, shr(keyExcessBits, mload(add(_key, 0x40)))))
        }
        storageAddress += 2;

        // signature
        for (uint i = 0; i < SIGNATURE_LENGTH; i += 32) {
            assembly {
                sstore(storageAddress, mload(add(_signature, add(0x20, i))))
            }
            storageAddress++;
        }
    }

    /**
     * @notice Loads a pubkey/signature pair from storage
     * @param _operatorId id of operator that owns pair
     * @param _keyIndex index of pair
     * @return key stored pubkey
     * @return signature stored signature
     */
    function _loadKeyPair(uint _operatorId, uint _keyIndex)
        internal
        view
        returns (bytes memory key, bytes memory signature)
    {
        uint256 storageAddress = _keyPairStorageAddress(_operatorId, _keyIndex);

        bytes memory tmpKey = new bytes(64);
        assembly {
            mstore(add(tmpKey, 0x20), sload(storageAddress))
            mstore(add(tmpKey, 0x40), sload(add(storageAddress, 1)))
        }
        storageAddress += 2;
        key = BytesLib.slice(tmpKey, 0, PUBKEY_LENGTH);

        signature = new bytes(SIGNATURE_LENGTH);
        for (uint256 i = 0; i < SIGNATURE_LENGTH; i += 32) {
            assembly {
                mstore(add(signature, add(0x20, i)), sload(storageAddress))
            }
            storageAddress++;
        }

        return (key, signature);
    }

    /**
     * @notice Returns the storage address for pubkey/signature pair
     * @param _operatorId id of operator that owns pair
     * @param _keyIndex index of pair
     * @return storageAddress storage address of pair
     */
    function _keyPairStorageAddress(uint _operatorId, uint _keyIndex) internal pure returns (uint) {
        return uint256(keccak256(abi.encodePacked("wl-operator-controller-keys", _operatorId, _keyIndex)));
    }

    /**
     * @notice Checks if a pubkey is empty
     * @param _key key to check
     * @return isEmpty whether key is empty
     */
    function _isEmptyKey(bytes memory _key) internal pure returns (bool) {
        assert(_key.length == PUBKEY_LENGTH);

        uint256 k1;
        uint256 k2;
        assembly {
            k1 := mload(add(_key, 0x20))
            k2 := mload(add(_key, 0x40))
        }

        return 0 == k1 && 0 == (k2 >> ((2 * 32 - PUBKEY_LENGTH) * 8));
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
