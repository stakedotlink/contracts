// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";

import "../base/Strategy.sol";
import "../interfaces/IWrappedETH.sol";
import "../interfaces/IOperatorController.sol";
import "../interfaces/IDepositContract.sol";

/**
 * @title ETH Staking Strategy
 * @notice Handles Ethereum staking deposits/withdrawals
 */
contract EthStakingStrategy is Strategy {
    using SafeERC20 for IERC20;

    uint public constant PUBKEY_LENGTH = 48;
    uint public constant SIGNATURE_LENGTH = 96;

    uint public constant DEPOSIT_AMOUNT = 32 ether;
    uint internal constant DEPOSIT_AMOUNT_UNIT = 1 gwei;

    IWrappedETH public wETH;
    IDepositContract public depositContract;
    IOperatorController public operatorController;
    address public oracle;

    bytes32 public withdrawalCredentials;

    uint public operatorFeeBasisPoints;

    uint public depositedValidators;
    uint public beaconValidators;
    uint public beaconBalance;

    int public depositChange;

    constructor(
        address _token,
        address _stakingPool,
        address _governance,
        uint _depositsMax,
        uint _depositsMin
    ) Strategy(_token, _stakingPool, _governance, _depositsMax, _depositsMin) {}

    /**
     * @notice Updates the number of our validators in the beacon validator set and their total balance
     * @dev periodically called by the Oracle contract
     * @param _beaconValidators number of our in the beacon state
     * @param _beaconBalance summed balance of all our validators
     */
    function reportBeaconState(uint _beaconValidators, uint _beaconBalance) external {
        require(msg.sender == oracle, "Sender is not oracle");
        require(_beaconValidators <= depositedValidators, "Reported more beacon validators than deposited");
        require(_beaconValidators >= beaconValidators, "Reported less beacon validators than currently tracked");

        uint appearedValidators = _beaconValidators - beaconValidators;
        int rewardBase = int(appearedValidators * DEPOSIT_AMOUNT + beaconBalance);

        beaconBalance = _beaconBalance;
        beaconValidators = _beaconValidators;
        depositChange += int(_beaconBalance) - rewardBase;
    }

    /**
     * @notice unwraps buffered wETH and deposits ETH into the DepositContract
     * @param _maxDeposits maximum number of separate deposits to execute
     */
    function depositBufferedEther(uint _maxDeposits) external {
        uint balance = wETH.balanceOf(address(this));
        require(balance >= DEPOSIT_AMOUNT, "Insufficient ETH for deposit");

        uint numDeposits = balance / DEPOSIT_AMOUNT;
        if (numDeposits > _maxDeposits) {
            numDeposits = _maxDeposits;
        }

        wETH.unwrap(numDeposits * DEPOSIT_AMOUNT);
        _executeDeposits(numDeposits);
    }

    /**
     * @notice deposits wETH from StakingPool into this strategy
     * @param _amount amount of wETH to deposit
     */
    function deposit(uint _amount) external onlyStakingPool {
        require(_amount <= canDeposit(), "Insufficient deposit room");
        wETH.transferFrom(address(stakingPool), address(this), _amount);
    }

    /**
     * @notice withdraws ETH
     * @dev not implemented yet
     * @param _amount Amount of ETH to withdraw
     */
    function withdraw(uint _amount) external onlyStakingPool {
        revert("NOT_IMPLEMENTED_YET");
    }

    /**
     * @notice updates deposit accounting and distributes any accumulated operator rewards
     */
    function updateDeposits() external onlyStakingPool {
        if (depositChange > 0) {
            uint rewards = uint(depositChange);
            uint sharesToMint = (uint(rewards) * operatorFeeBasisPoints * stakingPool.totalShares()) /
                ((stakingPool.totalSupply() + rewards) * 10000 - operatorFeeBasisPoints * rewards);
            stakingPool.mintShares(sharesToMint);
            stakingPool.transferAndCall(address(operatorController), stakingPool.balanceOf(address(this)), "0x00");
        }
        depositChange = 0;
    }

    /**
     * @notice returns the available deposit room for this strategy
     * @return available deposit room
     */
    function canDeposit() public view returns (uint) {
        uint deposits = totalDeposits();
        if (deposits >= depositsMax) {
            return 0;
        } else {
            return depositsMax - deposits;
        }
    }

    /**
     * @notice returns the available withdrawal room for this strategy
     * @return available withdrawal room
     */
    function canWithdraw() public view returns (uint) {
        uint deposits = totalDeposits();
        if (deposits <= depositsMin) {
            return 0;
        } else {
            return deposits - depositsMin;
        }
    }

    /**
     * @notice returns the total amount of deposits in this strategy
     * @return total deposits
     */
    function totalDeposits() public view returns (uint) {
        return beaconBalance + wETH.balanceOf(address(this));
    }

    /**
     * @notice executes deposits into the DepositContract
     * @param _numDeposits Number of deposits to execute
     */
    function _executeDeposits(uint _numDeposits) internal {
        (bytes memory pubkeys, bytes memory signatures) = operatorController.assignNextValidators(_numDeposits);

        if (pubkeys.length == 0) {
            return;
        }

        require(pubkeys.length % PUBKEY_LENGTH == 0, "REGISTRY_INCONSISTENT_PUBKEYS_LEN");
        require(signatures.length % SIGNATURE_LENGTH == 0, "REGISTRY_INCONSISTENT_SIG_LEN");

        uint numKeys = pubkeys.length / PUBKEY_LENGTH;
        require(numKeys == signatures.length / SIGNATURE_LENGTH, "REGISTRY_INCONSISTENT_SIG_COUNT");

        for (uint i = 0; i < numKeys; i++) {
            bytes memory pubkey = BytesLib.slice(pubkeys, i * PUBKEY_LENGTH, PUBKEY_LENGTH);
            bytes memory signature = BytesLib.slice(signatures, i * SIGNATURE_LENGTH, SIGNATURE_LENGTH);
            _deposit(pubkey, signature);
        }

        depositedValidators += numKeys;
    }

    /**
     * @dev invokes a single deposit call to the DepositContract
     * @param _pubkey validator to deposit for
     * @param _signature signature of the deposit call
     */
    function _deposit(bytes memory _pubkey, bytes memory _signature) internal {
        require(withdrawalCredentials != 0, "EMPTY_WITHDRAWAL_CREDENTIALS");

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
                sha256(abi.encodePacked(_toLittleEndian64(uint64(depositAmount)), signatureRoot))
            )
        );

        uint targetBalance = address(this).balance - depositValue;

        depositContract.deposit{value: depositValue}(
            _pubkey,
            abi.encodePacked(withdrawalCredentials),
            _signature,
            depositDataRoot
        );
        require(address(this).balance == targetBalance, "EXPECTING_DEPOSIT_TO_HAPPEN");
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
