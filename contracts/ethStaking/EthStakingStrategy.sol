// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";

import "../core/base/Strategy.sol";
import "./interfaces/IWrappedETH.sol";
import "./interfaces/IOperatorController.sol";
import "./interfaces/IDepositContract.sol";
import "./interfaces/IRewardsReceiver.sol";

/**
 * @title ETH Staking Strategy
 * @notice Handles Ethereum staking deposits/withdrawals
 */
contract EthStakingStrategy is Strategy {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    uint256 public constant PUBKEY_LENGTH = 48;
    uint256 public constant SIGNATURE_LENGTH = 96;

    uint256 public constant DEPOSIT_AMOUNT = 32 ether;
    uint256 internal constant DEPOSIT_AMOUNT_UNIT = 1 gwei;

    uint256 internal constant BASIS_POINTS = 10000;

    IDepositContract public depositContract;
    IRewardsReceiver public rewardsReceiver;
    address public beaconOracle;
    address public depositController;

    bytes32 public withdrawalCredentials;

    address[] private operatorControllers;
    uint256 public operatorFeeBasisPoints;

    uint256 public depositedValidators;
    uint256 public beaconValidators;
    uint256 public beaconBalance;
    uint256 public lostOperatorStakes;

    int public depositChange;
    uint256 public totalDeposits;
    uint256 public bufferedETH;

    uint256 private maxDeposits;
    uint256 private minDeposits;

    event DepositEther(uint256 nwlValidatorCount, uint256 wlValidatorCount);
    event ReportBeaconState(uint256 beaconValidators, uint256 beaconBalance, uint256 lostOperatorStakes);
    event SetMaxDeposits(uint256 max);
    event SetMinDeposits(uint256 min);
    event SetDepositController(address controller);
    event SetRewardsReceiver(address rewardsReceiver);
    event SetBeaconOracle(address oracle);
    event AddOperatorController(address controller);
    event RemoveOperatorController(address controler);

    error CannotSetZeroAddress();
    error InvalidQueueOrder();
    error ControllerAlreadyAdded();
    error ControllerNotFound();
    error OnlyOperatorController();
    error OnlyBeaconOracle();
    error MoreValidatorsThanDeposited();
    error LessValidatorsThanTracked();
    error OnlyDepositController();
    error InconsistentLengths();
    error InvalidTotalDepositAmount();
    error InvalidPubkeys();
    error InvalidSignatures();
    error InsufficientDepositRoom();
    error EmptyWithdrawalCredentials();
    error DepositFailed();

    modifier onlyOperatorController() {
        for (uint256 i = 0; i < operatorControllers.length; ++i) {
            if (msg.sender == operatorControllers[i]) _;
        }
        revert OnlyOperatorController();
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _wETH,
        address _stakingPool,
        uint256 _maxDeposits,
        uint256 _minDeposits,
        address _depositContract,
        bytes32 _withdrawalCredentials,
        uint256 _operatorFeeBasisPoints
    ) public initializer {
        __Strategy_init(_wETH, _stakingPool);
        depositContract = IDepositContract(_depositContract);
        withdrawalCredentials = _withdrawalCredentials;
        operatorFeeBasisPoints = _operatorFeeBasisPoints;
        maxDeposits = _maxDeposits;
        minDeposits = _minDeposits;
    }

    receive() external payable {}

    /**
     * @notice Updates the number of validators in the beacon validator set and their total balance
     * @dev periodically called by the Oracle contract
     * @param _beaconValidators number of validators in the beacon state
     * @param _beaconBalance summed balance of all validators
     * @param _lostOperatorStakes sum of all lost operator stakes (max of OperatorController.depositAmount
     * for each validator - only tracks lost ETH that operators staked themselves)
     */
    function reportBeaconState(
        uint256 _beaconValidators,
        uint256 _beaconBalance,
        uint256 _lostOperatorStakes
    ) external {
        if (msg.sender != beaconOracle) revert OnlyBeaconOracle();
        if (_beaconValidators > depositedValidators) revert MoreValidatorsThanDeposited();
        if (_beaconValidators < beaconValidators) revert LessValidatorsThanTracked();

        uint256 newValidators = _beaconValidators - beaconValidators;
        int rewardBase = int(newValidators * DEPOSIT_AMOUNT + beaconBalance + lostOperatorStakes);

        beaconBalance = _beaconBalance;
        beaconValidators = _beaconValidators;
        lostOperatorStakes = _lostOperatorStakes;

        int change = int(_beaconBalance) - rewardBase + int(_lostOperatorStakes);
        if (change > 0) {
            uint256 rewards = rewardsReceiver.withdraw();
            if (rewards > 0) {
                IWrappedETH(address(token)).wrap{value: rewards}();
                bufferedETH += rewards;
                change += int(rewards);
            }
        }

        depositChange += change;
        emit ReportBeaconState(_beaconValidators, _beaconBalance, _lostOperatorStakes);
    }

    /**
     * @notice unwraps wETH and deposits ETH into the DepositContract
     * @param _depositAmounts list of deposit amounts for each operator controller
     * @param _totalValidatorCounts list of validator counts to assign for each operator controller
     * @param _operatorIds list of operator ids that should be assigned validators for each operator controller
     * @param _validatorCounts list of the number of validators to assign each operator for each operator controller
     */
    function depositEther(
        uint256[] calldata _depositAmounts,
        uint256[] calldata _totalValidatorCounts,
        uint256[][] calldata _operatorIds,
        uint256[][] calldata _validatorCounts
    ) external {
        if (msg.sender != depositController) revert OnlyDepositController();
        uint256 operatorControllerCount = _totalValidatorCounts.length;
        if (
            operatorControllerCount != operatorControllers.length ||
            operatorControllerCount != _depositAmounts.length ||
            operatorControllerCount != _totalValidatorCounts.length ||
            operatorControllerCount != _operatorIds.length ||
            operatorControllerCount != _validatorCounts.length
        ) revert InconsistentLengths();

        uint256 totalDepositAmount;
        for (uint256 i = 0; i < operatorControllerCount; ++i) {
            totalDepositAmount += _totalValidatorCounts[i] * (DEPOSIT_AMOUNT - _depositAmounts[i]);
        }

        if (totalDepositAmount == 0 || totalDepositAmount > bufferedETH) revert InvalidTotalDepositAmount();

        IWrappedETH(address(token)).unwrap(totalDepositAmount);

        uint256 totalValidatorCount;
        for (uint256 i = 0; i < operatorControllerCount; ++i) {
            uint256 validatorCount = _totalValidatorCounts[i];
            if (validatorCount == 0) continue;
            if (i != 0 && IOperatorController(operatorControllers[i - 1]).queueLength() != 0) revert InvalidQueueOrder();

            (bytes memory pubkeys, bytes memory signatures) = IOperatorController(operatorControllers[i])
                .assignNextValidators(validatorCount, _operatorIds[i], _validatorCounts[i]);

            if (pubkeys.length / PUBKEY_LENGTH != validatorCount || pubkeys.length % PUBKEY_LENGTH != 0)
                revert InvalidPubkeys();
            if (signatures.length / SIGNATURE_LENGTH != validatorCount || signatures.length % SIGNATURE_LENGTH != 0)
                revert InvalidSignatures();

            for (uint256 j = 0; j < validatorCount; ++j) {
                bytes memory pubkey = BytesLib.slice(pubkeys, j * PUBKEY_LENGTH, PUBKEY_LENGTH);
                bytes memory signature = BytesLib.slice(signatures, j * SIGNATURE_LENGTH, SIGNATURE_LENGTH);
                _deposit(pubkey, signature);
            }

            totalValidatorCount += validatorCount;
        }

        bufferedETH -= totalDepositAmount;
        depositedValidators += totalValidatorCount;
        emit DepositEther(totalValidatorCount, totalDepositAmount);
    }

    /**
     * @notice deposits wETH from StakingPool into this strategy
     * @param _amount amount of wETH to deposit
     */
    function deposit(uint256 _amount) external onlyStakingPool {
        if (_amount > canDeposit()) revert InsufficientDepositRoom();
        token.transferFrom(address(stakingPool), address(this), _amount);
        totalDeposits += _amount;
        bufferedETH += _amount;
    }

    /**
     * @notice withdraws ETH
     * @dev not implemented yet
     * @param _amount amount of ETH to withdraw
     */
    function withdraw(uint256 _amount) external onlyStakingPool {
        revert("Not implemented yet");
    }

    /**
     * @notice withdraws ETH to operator
     * @dev not implemented yet
     * @param _receiver receiver of ETH
     * @param _amount amount of ETH to withdraw
     */
    function operatorControllerWithdraw(address _receiver, uint256 _amount) external onlyOperatorController {
        revert("Not implemented yet");
    }

    /**
     * @notice updates deposit accounting and calculates reward distribution
     */
    function updateDeposits() external onlyStakingPool returns (address[] memory receivers, uint256[] memory amounts) {
        if (depositChange > 0) {
            uint256 rewards = uint256(depositChange);
            uint256 operatorFee = (rewards * operatorFeeBasisPoints) / BASIS_POINTS;
            uint256 operatorControllerCount = operatorControllers.length;

            uint256 totalActiveValidators;
            uint256 totalActiveStake;
            uint256 totalActiveOperatorControllers;
            uint256[] memory activeValidators = new uint256[](operatorControllerCount);
            uint256[] memory activeStake = new uint256[](operatorControllerCount);

            for (uint256 i = 0; i < operatorControllerCount; ++i) {
                IOperatorController operatorController = IOperatorController(operatorControllers[i]);
                activeValidators[i] = operatorController.totalActiveValidators();

                if (activeValidators[i] != 0) {
                    activeStake[i] = operatorController.totalActiveStake();
                    totalActiveValidators += activeValidators[i];
                    totalActiveStake += activeStake[i];
                    totalActiveOperatorControllers++;
                }
            }

            uint256 addedFees;
            receivers = new address[](totalActiveOperatorControllers);
            amounts = new uint256[](totalActiveOperatorControllers);

            for (uint i = 0; i < operatorControllerCount; ++i) {
                uint256 fee = (operatorFee * activeValidators[i]) / totalActiveValidators;

                if (activeStake[i] != 0) {
                    fee += (rewards * 1e18 * activeStake[i]) / (totalDeposits + totalActiveStake) / 1e18;
                }

                if (fee != 0) {
                    receivers[addedFees] = operatorControllers[i];
                    amounts[addedFees] = fee;
                    addedFees++;
                }
            }
        }

        totalDeposits = uint256(int256(totalDeposits) + depositChange);
        depositChange = 0;
    }

    /**
     * @notice returns a list of all operator controllers
     */
    function getOperatorControllers() external view returns (address[] memory) {
        return operatorControllers;
    }

    /**
     * @notice adds a new operator controller
     * @param _operatorController controller address
     */
    function addOperatorController(address _operatorController) external onlyOwner {
        if (_operatorController == address(0)) revert CannotSetZeroAddress();
        for (uint256 i = 0; i < operatorControllers.length; ++i) {
            if (operatorControllers[i] == _operatorController) revert ControllerAlreadyAdded();
        }
        operatorControllers.push(_operatorController);
        emit AddOperatorController(_operatorController);
    }

    /**
     * @notice removes an operator controller
     * @param _operatorController controller address
     */
    function removeOperatorController(address _operatorController) external onlyOwner {
        for (uint256 i = 0; i < operatorControllers.length; ++i) {
            if (operatorControllers[i] == _operatorController) {
                for (uint256 j = i; j < operatorControllers.length - 1; ++j) {
                    operatorControllers[j] = operatorControllers[j + 1];
                }
                operatorControllers.pop();
                emit RemoveOperatorController(_operatorController);
                return;
            }
        }
        revert ControllerNotFound();
    }

    /**
     * @notice sets the beacon oracle
     * @param _beaconOracle oracle address
     */
    function setBeaconOracle(address _beaconOracle) external onlyOwner {
        if (_beaconOracle == address(0)) revert CannotSetZeroAddress();
        beaconOracle = _beaconOracle;
        emit SetBeaconOracle(_beaconOracle);
    }

    /**
     * @notice returns the total amount of deposits in this strategy
     * @return total deposits
     */
    function getTotalDeposits() public view override returns (uint256) {
        return totalDeposits;
    }

    /**
     * @notice returns the maximum that can be deposited into the strategy
     * @return max deposit
     */
    function getMaxDeposits() public view override returns (uint256) {
        return maxDeposits;
    }

    /**
     * @notice returns the minimum that must remain the strategy
     * @return min deposit
     */
    function getMinDeposits() public view override returns (uint256) {
        return minDeposits;
    }

    /**
     * @notice sets the maximum that can be deposited into the strategy
     * @param _maxDeposits maximum deposits
     */
    function setMaxDeposits(uint256 _maxDeposits) external onlyOwner {
        maxDeposits = _maxDeposits;
        emit SetMaxDeposits(_maxDeposits);
    }

    /**
     * @notice sets the minimum that can be deposited into the strategy
     * @param _minDeposits minimum deposits
     */
    function setMinDeposits(uint256 _minDeposits) external onlyOwner {
        minDeposits = _minDeposits;
        emit SetMinDeposits(_minDeposits);
    }

    /**
     * @notice sets the deposit controller
     * @param _depositController deposit controller address
     */
    function setDepositController(address _depositController) external onlyOwner {
        if (_depositController == address(0)) revert CannotSetZeroAddress();
        depositController = _depositController;
        emit SetDepositController(_depositController);
    }

    /**
     * @notice sets the rewards receiver
     * @param _rewardsReceiver rewards receiver address
     */
    function setRewardsReceiver(address _rewardsReceiver) external onlyOwner {
        if (_rewardsReceiver == address(0)) revert CannotSetZeroAddress();
        rewardsReceiver = IRewardsReceiver(_rewardsReceiver);
        emit SetRewardsReceiver(_rewardsReceiver);
    }

    /**
     * @dev invokes a single deposit call to the DepositContract
     * @param _pubkey validator to deposit for
     * @param _signature signature of the deposit call
     */
    function _deposit(bytes memory _pubkey, bytes memory _signature) internal {
        if (withdrawalCredentials == 0) revert EmptyWithdrawalCredentials();

        uint256 depositValue = DEPOSIT_AMOUNT;
        uint256 depositAmount = depositValue / DEPOSIT_AMOUNT_UNIT;

        bytes32 pubkeyRoot = sha256(abi.encodePacked(_pubkey, bytes16(0)));
        bytes32 signatureRoot = sha256(
            abi.encodePacked(
                sha256(BytesLib.slice(_signature, 0, 64)),
                sha256(abi.encodePacked(BytesLib.slice(_signature, 64, SIGNATURE_LENGTH - 64), bytes32(0)))
            )
        );
        bytes32 depositDataRoot = sha256(
            abi.encodePacked(
                sha256(abi.encodePacked(pubkeyRoot, withdrawalCredentials)),
                sha256(abi.encodePacked(_toLittleEndian64(uint64(depositAmount)), bytes24(0), signatureRoot))
            )
        );

        uint256 targetBalance = address(this).balance - depositValue;

        depositContract.deposit{value: depositValue}(
            _pubkey,
            abi.encodePacked(withdrawalCredentials),
            _signature,
            depositDataRoot
        );

        if (address(this).balance != targetBalance) revert DepositFailed();
    }

    /**
     * @dev converts value to little endian bytes
     * @param _value number to convert
     */
    function _toLittleEndian64(uint64 _value) internal pure returns (bytes memory ret) {
        ret = new bytes(8);
        bytes8 bytesValue = bytes8(_value);
        ret[0] = bytesValue[7];
        ret[1] = bytesValue[6];
        ret[2] = bytesValue[5];
        ret[3] = bytesValue[4];
        ret[4] = bytesValue[3];
        ret[5] = bytesValue[2];
        ret[6] = bytesValue[1];
        ret[7] = bytesValue[0];
    }
}
