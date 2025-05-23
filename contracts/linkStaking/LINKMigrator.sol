// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IStaking.sol";
import "../core/interfaces/IPriorityPool.sol";

/**
 * @title LINK Migrator
 * @notice Enables stakers to migrate staked LINK from the Chainlink community pool
 * directly to stLINK bypassing the priority pool queue
 * @dev Migration must be perfomed using atomic tx batching consisting of a call to initiateMigration,
 * a call to withdraw tokens from the Chainlink community pool, and a transferAndCall of LINK tokens
 * to this contract which will execute onTokenTransfer to finalize the migration. If atomic batching is
 * not used, there is no guarantee that that withdrawn LINK will be able to be swapped for stLINK.
 */
contract LINKMigrator is Ownable {
    using SafeERC20 for IERC20;

    // address of LINK token
    address public linkToken;
    // address of Chainlink community staking pool
    IStaking public communityPool;

    // address of priority pool
    IPriorityPool public priorityPool;
    // min amount of tokens the priority will deposit in a single tx
    uint256 public queueDepositMin;

    struct Migration {
        // amount of principal staked in Chainlink community pool
        uint128 principalAmount;
        // amount to migrate
        uint128 amount;
        // timestamp when migration was initiated
        uint64 timestamp;
    }

    // maps address to migration
    mapping(address => Migration) public migrations;

    event Migrate(address indexed account, uint256 amount);

    error InsufficientAmountStaked();
    error TokensNotUnbonded();
    error InvalidPPState();
    error InvalidToken();
    error InvalidAmount();
    error InvalidValue();
    error InvalidTimestamp();
    error InsufficientTokensWithdrawn();

    /**
     * @notice Initializes contract
     * @param _linkToken address of LINK token
     * @param _communityPool address of Chainlink community staking pool
     * @param _priorityPool address of priorityPool
     * @param _queueDepositMin min amount of tokens the priority will deposit in a single tx
     **/
    constructor(
        address _linkToken,
        address _communityPool,
        address _priorityPool,
        uint256 _queueDepositMin
    ) {
        linkToken = _linkToken;
        communityPool = IStaking(_communityPool);
        priorityPool = IPriorityPool(_priorityPool);
        queueDepositMin = _queueDepositMin;

        IERC20(linkToken).safeApprove(_priorityPool, type(uint256).max);
    }

    /**
     * @notice Initiates a migration for the sender
     * @param _amount amount of tokens to migrate
     **/
    function initiateMigration(uint256 _amount) external {
        if (_amount == 0) revert InvalidAmount();

        uint256 principal = communityPool.getStakerPrincipal(msg.sender);

        if (principal < _amount) revert InsufficientAmountStaked();
        if (!_isUnbonded(msg.sender)) revert TokensNotUnbonded();

        migrations[msg.sender] = Migration(
            uint128(principal),
            uint128(_amount),
            uint64(block.timestamp)
        );
    }

    /**
     * @notice ERC677 implementation that executes a migration for the sender
     * @param _sender sender of transfer
     * @param _value value of transfer
     * @param _calldata encoded deposit data
     **/
    function onTokenTransfer(address _sender, uint256 _value, bytes calldata _calldata) external {
        Migration memory migration = migrations[_sender];

        if (msg.sender != linkToken) revert InvalidToken();
        if (_value != migration.amount) revert InvalidValue();
        if (uint64(block.timestamp) != migration.timestamp) revert InvalidTimestamp();

        uint256 amountWithdrawn = migration.principalAmount -
            communityPool.getStakerPrincipal(_sender);
        if (amountWithdrawn < _value) revert InsufficientTokensWithdrawn();

        bytes[] memory depositData = abi.decode(_calldata, (bytes[]));
        priorityPool.bypassQueue(_sender, _value, depositData);

        delete migrations[_sender];

        emit Migrate(_sender, _value);
    }

    /**
     * @notice Sets the min amount of tokens the priority will deposit in a single tx
     * @param _queueDepositMin queue deposit min
     **/
    function setQueueDepositMin(uint256 _queueDepositMin) external onlyOwner {
        queueDepositMin = _queueDepositMin;
    }

    /**
     * @notice Returns whether an account is unbonded in the Chainlink community pool
     * @param _account address of account
     * @return true if account is unbonded, false otherwise
     **/
    function _isUnbonded(address _account) private view returns (bool) {
        uint256 unbondingPeriodEndsAt = communityPool.getUnbondingEndsAt(_account);
        if (unbondingPeriodEndsAt == 0 || block.timestamp < unbondingPeriodEndsAt) return false;

        return block.timestamp <= communityPool.getClaimPeriodEndsAt(_account);
    }
}
