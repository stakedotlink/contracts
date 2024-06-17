// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../interfaces/IStakingPool.sol";
import "../interfaces/IPriorityPool.sol";

/**
 * @title Withdrawal Pool
 * @notice Allows users to queue LST withdrawals if there is insufficient liquidity to satisfy the withdrawal amount
 */
contract WithdrawalPool is UUPSUpgradeable, OwnableUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct Withdrawal {
        uint128 sharesRemaining;
        uint128 partiallyWithdrawableAmount;
    }

    struct WithdrawalBatch {
        uint128 indexOfLastWithdrawal;
        uint128 stakePerShares;
    }

    IERC20Upgradeable public token;
    IERC20Upgradeable public lst;
    IPriorityPool public priorityPool;

    Withdrawal[] internal queuedWithdrawals;
    mapping(address => uint256[]) internal queuedWithdrawalsByAccount;
    mapping(uint256 => address) internal withdrawalOwners;

    uint256 internal totalQueuedShareWithdrawals;
    uint256 public indexOfNextWithdrawal;

    WithdrawalBatch[] internal withdrawalBatches;

    uint256 public minWithdrawalAmount;

    event QueueWithdrawal(address indexed account, uint256 amount);
    event Withdraw(address indexed account, uint256 amount);
    event WithdrawalsFinalized(uint256 amount);
    event SetMinWithdrawalAmount(uint256 minWithdrawalAmount);

    error SenderNotAuthorized();
    error InvalidWithdrawalId();
    error AmountTooSmall();
    error NoUpkeepNeeded();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes contract
     * @param _token address of asset token
     * @param _lst address of liquid staking token
     * @param _priorityPool address of priority pool
     * @param _minWithdrawalAmount minimum amount that can be queued for withdrawal
     */
    function initialize(
        address _token,
        address _lst,
        address _priorityPool,
        uint256 _minWithdrawalAmount
    ) public initializer {
        __UUPSUpgradeable_init();
        __Ownable_init();
        token = IERC20Upgradeable(_token);
        lst = IERC20Upgradeable(_lst);
        lst.safeApprove(_priorityPool, type(uint256).max);
        priorityPool = IPriorityPool(_priorityPool);
        minWithdrawalAmount = _minWithdrawalAmount;
        withdrawalBatches.push(WithdrawalBatch(0, 0));
        queuedWithdrawals.push(Withdrawal(0, 0));
    }

    /**
     * @notice Reverts if sender is not priority pool
     */
    modifier onlyPriorityPool() {
        if (msg.sender != address(priorityPool)) revert SenderNotAuthorized();
        _;
    }

    /**
     * @notice Returns the total amount of liquid staking tokens queued for withdrawal
     * @return total amount queued for withdrawal
     */
    function getTotalQueuedWithdrawals() external view returns (uint256) {
        return _getStakeByShares(totalQueuedShareWithdrawals);
    }

    /**
     * @notice Returns a list of withdrawals
     * @param _withdrawalIds list of withdrawal ids
     * @return list of withdrawals corresponding to withdrawal ids
     */
    function getWithdrawals(uint256[] calldata _withdrawalIds) external view returns (Withdrawal[] memory) {
        Withdrawal[] memory withdrawals = new Withdrawal[](_withdrawalIds.length);

        for (uint256 i = 0; i < _withdrawalIds.length; ++i) {
            withdrawals[i] = queuedWithdrawals[_withdrawalIds[i]];
        }

        return withdrawals;
    }

    /**
     * @notice Returns batch ids for a list of withdrawals
     * @param _withdrawalIds list of withrawal ids
     * @return list of batch ids corresponding to withdrawal ids
     */
    function getBatchIds(uint256[] memory _withdrawalIds) public view returns (uint256[] memory) {
        uint256[] memory batchIds = new uint256[](_withdrawalIds.length);

        for (uint256 i = 0; i < _withdrawalIds.length; ++i) {
            uint256 batchId;
            uint256 withdrawalId = _withdrawalIds[i];

            for (uint256 j = 0; j < withdrawalBatches.length; ++j) {
                uint256 indexOfLastWithdrawal = withdrawalBatches[j].indexOfLastWithdrawal;

                if (withdrawalId <= indexOfLastWithdrawal) {
                    batchId = j;
                    break;
                }
            }

            batchIds[i] = batchId;
        }

        return batchIds;
    }

    /**
     * @notice Returns a list of withdrawal ids owned by an account
     * @param _account address of account
     * @return list of withdrawal ids
     */
    function getWithdrawalIdsByOwner(address _account) public view returns (uint256[] memory) {
        uint256[] memory activeWithdrawals = new uint256[](queuedWithdrawalsByAccount[_account].length);
        uint256 totalActiveWithdrawals;

        for (uint256 i = 0; i < activeWithdrawals.length; ++i) {
            uint256 withdrawalId = queuedWithdrawalsByAccount[_account][i];
            Withdrawal memory withdrawal = queuedWithdrawals[withdrawalId];
            if (withdrawal.sharesRemaining != 0 || withdrawal.partiallyWithdrawableAmount != 0) {
                activeWithdrawals[i] = withdrawalId;
                totalActiveWithdrawals++;
            }
        }

        uint256[] memory withdrawalIds = new uint256[](totalActiveWithdrawals);
        uint256 withdrawalIdsAdded;
        for (uint256 i = 0; i < activeWithdrawals.length; ++i) {
            if (activeWithdrawals[i] != 0) {
                withdrawalIds[withdrawalIdsAdded] = activeWithdrawals[i];
                withdrawalIdsAdded++;
            }
        }

        return withdrawalIds;
    }

    /**
     * @notice Returns a list of finalized and partially finalized withdrawal ids owned by an account
     * @param _account address of account
     * @return list of withdrawal ids
     * @return total withdrawable across all account's withdrawals
     */
    function getFinalizedWithdrawalIdsByOwner(address _account) external view returns (uint256[] memory, uint256) {
        uint256[] memory withdrawalIds = getWithdrawalIdsByOwner(_account);
        uint256[] memory batchIds = getBatchIds(withdrawalIds);

        uint256[] memory finalizedWithdrawals = new uint256[](withdrawalIds.length);
        uint256 totalFinalizedWithdrawals;
        uint256 totalWithdrawable;
        for (uint256 i = 0; i < batchIds.length; ++i) {
            Withdrawal memory withdrawal = queuedWithdrawals[withdrawalIds[i]];

            if (batchIds[i] != 0 || withdrawal.partiallyWithdrawableAmount != 0) {
                finalizedWithdrawals[i] = withdrawalIds[i];
                totalFinalizedWithdrawals++;
                totalWithdrawable += withdrawal.partiallyWithdrawableAmount;

                if (batchIds[i] != 0) {
                    totalWithdrawable +=
                        (uint256(withdrawalBatches[batchIds[i]].stakePerShares) * uint256(withdrawal.sharesRemaining)) /
                        1e18;
                }
            } else {
                break;
            }
        }

        uint256[] memory retFinalizedWithdrawals = new uint256[](totalFinalizedWithdrawals);
        uint256 withdrawalsAdded;
        for (uint256 i = 0; i < totalFinalizedWithdrawals; ++i) {
            uint256 withdrawalId = finalizedWithdrawals[i];

            if (withdrawalId != 0) {
                retFinalizedWithdrawals[withdrawalsAdded] = withdrawalId;
                withdrawalsAdded++;
            }
        }

        return (retFinalizedWithdrawals, totalWithdrawable);
    }

    /**
     * @notice Executes a group of fully and/or partially finalized withdrawals owned by the sender
     * @param _withdrawalIds list of withdrawal ids to execute
     * @param _batchIds list of batch ids corresponding to withdrawal ids
     */
    function withdraw(uint256[] calldata _withdrawalIds, uint256[] calldata _batchIds) external {
        address owner = msg.sender;
        uint256 amountToWithdraw;

        for (uint256 i = 0; i < _withdrawalIds.length; ++i) {
            uint256 withdrawalId = _withdrawalIds[i];
            Withdrawal memory withdrawal = queuedWithdrawals[_withdrawalIds[i]];
            uint256 batchId = _batchIds[i];
            WithdrawalBatch memory batch = withdrawalBatches[batchId];

            if (withdrawalOwners[withdrawalId] != owner) revert SenderNotAuthorized();
            if (batchId != 0 && withdrawalId <= withdrawalBatches[batchId - 1].indexOfLastWithdrawal)
                revert InvalidWithdrawalId();
            if (batchId != 0 && withdrawalId > batch.indexOfLastWithdrawal && withdrawal.partiallyWithdrawableAmount == 0)
                revert InvalidWithdrawalId();

            if (withdrawalId <= batch.indexOfLastWithdrawal) {
                amountToWithdraw +=
                    withdrawal.partiallyWithdrawableAmount +
                    (uint256(batch.stakePerShares) * uint256(withdrawal.sharesRemaining)) /
                    1e18;
                delete queuedWithdrawals[withdrawalId];
                delete withdrawalOwners[withdrawalId];
            } else {
                amountToWithdraw += withdrawal.partiallyWithdrawableAmount;
                queuedWithdrawals[withdrawalId].partiallyWithdrawableAmount = 0;
            }
        }

        token.safeTransfer(owner, amountToWithdraw);
        emit Withdraw(owner, amountToWithdraw);
    }

    /**
     * @notice Queues a withdrawal of liquid staking tokens for an account
     * @param _account address of account
     * @param _amount amount of LST
     */
    function queueWithdrawal(address _account, uint256 _amount) external onlyPriorityPool {
        if (_amount < minWithdrawalAmount) revert AmountTooSmall();

        lst.safeTransferFrom(msg.sender, address(this), _amount);

        uint256 sharesAmount = _getSharesByStake(_amount);
        queuedWithdrawals.push(Withdrawal(uint128(sharesAmount), 0));
        totalQueuedShareWithdrawals += sharesAmount;

        uint256 withdrawalId = queuedWithdrawals.length - 1;
        queuedWithdrawalsByAccount[_account].push(withdrawalId);
        withdrawalOwners[withdrawalId] = _account;

        emit QueueWithdrawal(_account, _amount);
    }

    /**
     * @notice Deposits asset tokens in exchange for liquid staking tokens, finalizing withdrawals
     * at the front of the queue
     * @param _amount amount of tokens to deposit
     */
    function deposit(uint256 _amount) external onlyPriorityPool {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        lst.safeTransfer(msg.sender, _amount);
        _finalizeWithdrawals(_amount);
    }

    /**
     * @notice Returns whether withdrawals should be executed based on available withdrawal space
     * @return true if withdrawal should be executed, false otherwise
     */
    function checkUpkeep(bytes calldata) external view returns (bool, bytes memory) {
        if (_getStakeByShares(totalQueuedShareWithdrawals) != 0 && priorityPool.canWithdraw(address(this), 0) != 0) {
            return (true, "");
        }
        return (false, "");
    }

    /**
     * @notice Executes withdrawals if there is sufficient available withdrawal space
     * @param _performData encoded list of withdrawal data passed to staking pool strategies
     */
    function performUpkeep(bytes calldata _performData) external {
        uint256 canWithdraw = priorityPool.canWithdraw(address(this), 0);
        uint256 totalQueued = _getStakeByShares(totalQueuedShareWithdrawals);
        if (totalQueued == 0 || canWithdraw == 0) revert NoUpkeepNeeded();

        uint256 toWithdraw = totalQueued > canWithdraw ? canWithdraw : totalQueued;
        bytes[] memory data = abi.decode(_performData, (bytes[]));

        priorityPool.executeQueuedWithdrawals(toWithdraw, data);
        _finalizeWithdrawals(toWithdraw);
    }

    /**
     * @notice Sets the minimum amount of liquid staking tokens that can be queued for withdrawal
     * @param _minWithdrawalAmount minimum token amount
     */
    function setMinWithdrawalAmount(uint256 _minWithdrawalAmount) external onlyOwner {
        minWithdrawalAmount = _minWithdrawalAmount;
        emit SetMinWithdrawalAmount(_minWithdrawalAmount);
    }

    /**
     * @notice Finalizes withdrawal accounting after withdrawals have been executed
     * @param _amount amount to finalize
     */
    function _finalizeWithdrawals(uint256 _amount) internal {
        uint256 sharesToWithdraw = _getSharesByStake(_amount);
        uint256 numWithdrawals = queuedWithdrawals.length;

        totalQueuedShareWithdrawals -= sharesToWithdraw;

        for (uint256 i = indexOfNextWithdrawal; i < numWithdrawals; ++i) {
            uint256 sharesRemaining = queuedWithdrawals[i].sharesRemaining;

            if (sharesRemaining < sharesToWithdraw) {
                sharesToWithdraw -= sharesRemaining;
                continue;
            }

            if (sharesRemaining > sharesToWithdraw) {
                queuedWithdrawals[i] = Withdrawal(
                    uint128(sharesRemaining - sharesToWithdraw),
                    uint128(queuedWithdrawals[i].partiallyWithdrawableAmount + _getStakeByShares(sharesToWithdraw))
                );
                indexOfNextWithdrawal = i;
                withdrawalBatches.push(WithdrawalBatch(uint128(i - 1), uint128(_getStakeByShares(1 ether))));
            } else {
                indexOfNextWithdrawal = i + 1;
                withdrawalBatches.push(WithdrawalBatch(uint128(i), uint128(_getStakeByShares(1 ether))));
            }

            sharesToWithdraw = 0;
            break;
        }

        assert(sharesToWithdraw == 0);

        emit WithdrawalsFinalized(_amount);
    }

    /**
     * @notice Returns the amount of LST that corresponds to an amount of shares
     * @param _sharesAmount amount of shares
     * @return amount of stake
     */
    function _getStakeByShares(uint256 _sharesAmount) internal view virtual returns (uint256) {
        return IStakingPool(address(lst)).getStakeByShares(_sharesAmount);
    }

    /**
     * @notice Returns the amount of shares that corresponds to an amount of LST
     * @param _amount amount of stake
     * @return amount of shares
     */
    function _getSharesByStake(uint256 _amount) internal view virtual returns (uint256) {
        return IStakingPool(address(lst)).getSharesByStake(_amount);
    }

    /**
     * @dev Checks authorization for contract upgrades
     */
    function _authorizeUpgrade(address) internal override onlyOwner {}
}
