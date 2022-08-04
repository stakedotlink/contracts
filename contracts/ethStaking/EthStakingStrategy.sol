// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";

import "../core/base/Strategy.sol";
import "./interfaces/IWrappedETH.sol";
import "./interfaces/IWLOperatorController.sol";
import "./interfaces/INWLOperatorController.sol";
import "./interfaces/IDepositContract.sol";

/**
 * @title ETH Staking Strategy
 * @notice Handles Ethereum staking deposits/withdrawals
 */
contract EthStakingStrategy is Strategy {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    uint public constant PUBKEY_LENGTH = 48;
    uint public constant SIGNATURE_LENGTH = 96;

    uint public constant DEPOSIT_AMOUNT = 32 ether;
    uint internal constant DEPOSIT_AMOUNT_UNIT = 1 gwei;

    IDepositContract public depositContract;
    IWLOperatorController public wlOperatorController;
    INWLOperatorController public nwlOperatorController;
    address public beaconOracle;

    bytes32 public withdrawalCredentials;

    uint public operatorFeeBasisPoints;

    uint public depositedValidators;
    uint public beaconValidators;
    uint public beaconBalance;

    int public depositChange;

    uint private depositMax;
    uint private depositMin;

    event DepositEther(uint nwlValidatorCount, uint wlValidatorCount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _wETH,
        address _stakingPool,
        uint _depositMax,
        uint _depositMin,
        address _depositContract,
        bytes32 _withdrawalCredentials,
        uint _operatorFeeBasisPoints
    ) public initializer {
        __Strategy_init(_wETH, _stakingPool);
        depositContract = IDepositContract(_depositContract);
        withdrawalCredentials = _withdrawalCredentials;
        operatorFeeBasisPoints = _operatorFeeBasisPoints;
        depositMax = _depositMax;
        depositMin = _depositMin;
    }

    receive() external payable {}

    /**
     * @notice Updates the number of validators in the beacon validator set and their total balance
     * @dev periodically called by the Oracle contract
     * @param _beaconValidators number of validators in the beacon state
     * @param _beaconBalance summed balance of all validators
     */
    function reportBeaconState(uint _beaconValidators, uint _beaconBalance) external {
        require(msg.sender == beaconOracle, "Sender is not beacon oracle");
        require(_beaconValidators <= depositedValidators, "Reported more validators than deposited");
        require(_beaconValidators >= beaconValidators, "Reported less validators than tracked");

        uint newValidators = _beaconValidators - beaconValidators;
        int rewardBase = int(newValidators * DEPOSIT_AMOUNT + beaconBalance);

        beaconBalance = _beaconBalance;
        beaconValidators = _beaconValidators;

        depositChange += int(_beaconBalance) - rewardBase;
    }

    /**
     * @notice unwraps wETH and deposits ETH into the DepositContract
     * @dev always deposits for non-whitelisted validators first, followed by whitelisted only if there
     * are no non-whitelisted remaining in the queue
     * @param _nwlTotalValidatorCount sum of all validators to assign non-whitelisted operators
     * @param _wlTotalValidatorCount sum of all validators to assign whitelisted operators
     * @param _wlOperatorIds ids of whitelisted operators that should be assigned validators
     * @param _wlValidatorCounts number of validators to assign each whitelisted operator
     */
    function depositEther(
        uint _nwlTotalValidatorCount,
        uint _wlTotalValidatorCount,
        uint[] calldata _wlOperatorIds,
        uint[] calldata _wlValidatorCounts
    ) external {
        uint totalDepositAmount = (DEPOSIT_AMOUNT * _wlTotalValidatorCount + (DEPOSIT_AMOUNT / 2) * _nwlTotalValidatorCount);
        require(totalDepositAmount > 0, "Cannot deposit 0");
        require(token.balanceOf(address(this)) >= totalDepositAmount, "Insufficient balance for deposit");

        bytes memory nwlPubkeys;
        bytes memory nwlSignatures;

        if (_nwlTotalValidatorCount > 0) {
            (nwlPubkeys, nwlSignatures) = nwlOperatorController.assignNextValidators(_nwlTotalValidatorCount);

            require(nwlPubkeys.length / PUBKEY_LENGTH == _nwlTotalValidatorCount, "Incorrect pubkeys length");
            require(nwlSignatures.length / SIGNATURE_LENGTH == _nwlTotalValidatorCount, "Incorrect signatures length");
            require(nwlPubkeys.length % PUBKEY_LENGTH == 0, "Invalid pubkeys");
            require(nwlSignatures.length % SIGNATURE_LENGTH == 0, "Invalid signatures");
        }

        bytes memory wlPubkeys;
        bytes memory wlSignatures;

        if (_wlTotalValidatorCount > 0) {
            require(nwlOperatorController.queueLength() == 0, "Non-whitelisted queue must be empty to assign whitlisted");

            (wlPubkeys, wlSignatures) = wlOperatorController.assignNextValidators(
                _wlOperatorIds,
                _wlValidatorCounts,
                _wlTotalValidatorCount
            );

            require(wlPubkeys.length / PUBKEY_LENGTH == _wlTotalValidatorCount, "Incorrect pubkeys length");
            require(wlSignatures.length / SIGNATURE_LENGTH == _wlTotalValidatorCount, "Incorrect signatures length");
            require(wlPubkeys.length % PUBKEY_LENGTH == 0, "Invalid pubkeys");
            require(wlSignatures.length % SIGNATURE_LENGTH == 0, "Invalid signatures");
        }

        IWrappedETH(address(token)).unwrap(totalDepositAmount);

        for (uint i = 0; i < _nwlTotalValidatorCount; i++) {
            bytes memory pubkey = BytesLib.slice(nwlPubkeys, i * PUBKEY_LENGTH, PUBKEY_LENGTH);
            bytes memory signature = BytesLib.slice(nwlSignatures, i * SIGNATURE_LENGTH, SIGNATURE_LENGTH);
            _deposit(pubkey, signature);
        }

        for (uint i = 0; i < _wlTotalValidatorCount; i++) {
            bytes memory pubkey = BytesLib.slice(wlPubkeys, i * PUBKEY_LENGTH, PUBKEY_LENGTH);
            bytes memory signature = BytesLib.slice(wlSignatures, i * SIGNATURE_LENGTH, SIGNATURE_LENGTH);
            _deposit(pubkey, signature);
        }

        depositedValidators += _nwlTotalValidatorCount + _wlTotalValidatorCount;
        emit DepositEther(_nwlTotalValidatorCount, _wlTotalValidatorCount);
    }

    /**
     * @notice deposits wETH from StakingPool into this strategy
     * @param _amount amount of wETH to deposit
     */
    function deposit(uint _amount) external onlyStakingPool {
        require(_amount <= canDeposit(), "Insufficient deposit room");
        token.transferFrom(address(stakingPool), address(this), _amount);
    }

    /**
     * @notice withdraws ETH
     * @dev not implemented yet
     * @param _amount Amount of ETH to withdraw
     */
    function withdraw(uint _amount) external onlyStakingPool {
        revert("Not implemented yet");
    }

    /**
     * @notice updates deposit accounting and calculates reward distribution
     */
    function updateDeposits() external onlyStakingPool returns (address[] memory receivers, uint[] memory amounts) {
        if (depositChange > 0) {
            uint rewards = uint(depositChange);

            uint nwlOperatorDeposits = nwlOperatorController.totalActiveStake();
            uint nwlOperatorRewardsBasisPoints = (10000 * nwlOperatorDeposits) /
                (totalDeposits() + nwlOperatorDeposits - rewards);

            uint activeWLValidators = wlOperatorController.totalActiveValidators();
            uint activeNWLValidators = nwlOperatorController.totalActiveValidators();

            uint operatorFee = (rewards * operatorFeeBasisPoints) / 10000;
            uint wlOperatorFee = (operatorFee * activeWLValidators) / (activeNWLValidators + activeWLValidators);
            uint nwlOperatorFee = operatorFee - wlOperatorFee + (rewards * nwlOperatorRewardsBasisPoints) / 10000;

            receivers = new address[](2);
            amounts = new uint[](2);

            receivers[0] = address(wlOperatorController);
            receivers[1] = address(nwlOperatorController);
            amounts[0] = wlOperatorFee;
            amounts[1] = nwlOperatorFee;
        }
        depositChange = 0;
    }

    /**
     * @notice returns the total amount of deposits in this strategy
     * @return total deposits
     */
    function totalDeposits() public view override returns (uint) {
        uint depositsInProgress = (depositedValidators - beaconValidators) * DEPOSIT_AMOUNT;
        return beaconBalance + depositsInProgress + token.balanceOf(address(this)) - nwlOperatorController.totalStake();
    }

    /**
     * @notice sets the whitelisted operator controller
     * @param _wlOperatorController controller address
     */
    function setWLOperatorController(address _wlOperatorController) external onlyOwner {
        wlOperatorController = IWLOperatorController(_wlOperatorController);
    }

    /**
     * @notice sets the non-whitelisted operator controller
     * @param _nwlOperatorController controller address
     */
    function setNWLOperatorController(address _nwlOperatorController) external onlyOwner {
        nwlOperatorController = INWLOperatorController(_nwlOperatorController);
    }

    /**
     * @notice sets the beacon oracle
     * @param _beaconOracle oracle address
     */
    function setBeaconOracle(address _beaconOracle) external onlyOwner {
        beaconOracle = _beaconOracle;
    }

    /**
     * @notice returns the maximum that can be deposited into the strategy
     * @return max deposit
     */
    function maxDeposits() public view override returns (uint) {
        return depositMax;
    }

    /**
     * @notice returns the minimum that must remain the strategy
     * @return min deposit
     */
    function minDeposits() public view override returns (uint) {
        return depositMin;
    }

    /**
     * @notice sets the maximum that can be deposited into the strategy
     * @param _depositMax maximum deposits
     */
    function setDepositMax(uint256 _depositMax) external onlyOwner {
        depositMax = _depositMax;
    }

    /**
     * @notice sets the minimum that can be deposited into the strategy
     * @param _depositMin minimum deposits
     */
    function setDepositMin(uint256 _depositMin) external onlyOwner {
        depositMin = _depositMin;
    }

    /**
     * @dev invokes a single deposit call to the DepositContract
     * @param _pubkey validator to deposit for
     * @param _signature signature of the deposit call
     */
    function _deposit(bytes memory _pubkey, bytes memory _signature) internal {
        require(withdrawalCredentials != 0, "Empty withdrawal credentials");

        uint depositValue = DEPOSIT_AMOUNT;
        uint depositAmount = depositValue / DEPOSIT_AMOUNT_UNIT;

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

        uint targetBalance = address(this).balance - depositValue;

        depositContract.deposit{value: depositValue}(
            _pubkey,
            abi.encodePacked(withdrawalCredentials),
            _signature,
            depositDataRoot
        );

        require(address(this).balance == targetBalance, "Deposit failed");
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
