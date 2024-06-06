// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/MerkleProofUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";

import "../interfaces/IStakingPool.sol";
import "../interfaces/ISDLPool.sol";
import "../interfaces/IWithdrawalPool.sol";

/**
 * @title Priority Pool
 * @notice Allows users to queue asset tokens which are eventually deposited into a staking pool when space becomes available -
 * liquid staking derivative tokens minted by the staking pool are then distributed using a merkle tree
 */
contract PriorityPool is UUPSUpgradeable, OwnableUpgradeable, PausableUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    enum PoolStatus {
        OPEN,
        DRAINING,
        CLOSED
    }

    IERC20Upgradeable public token;
    IStakingPool public stakingPool;
    ISDLPool public sdlPool;
    address public distributionOracle;

    uint128 public queueDepositMin;
    uint128 public queueDepositMax;
    PoolStatus public poolStatus;

    bytes32 public merkleRoot;
    bytes32 public ipfsHash;
    uint256 public merkleTreeSize;

    uint256 public totalQueued;
    uint256 public depositsSinceLastUpdate;
    uint256 private sharesSinceLastUpdate;

    address[] private accounts;
    mapping(address => uint256) private accountIndexes;
    mapping(address => uint256) private accountQueuedTokens;
    mapping(address => uint256) private accountClaimed;
    mapping(address => uint256) private accountSharesClaimed;

    address public rebaseController;

    IWithdrawalPool public withdrawalPool;
    uint256 public withdrawalPoolDepositMin;

    event UnqueueTokens(address indexed account, uint256 amount);
    event ClaimLSDTokens(address indexed account, uint256 amount, uint256 amountWithYield);
    event Deposit(address indexed account, uint256 poolAmount, uint256 queueAmount);
    event Withdraw(address indexed account, uint256 amount);
    event UpdateDistribution(
        bytes32 merkleRoot,
        bytes32 ipfsHash,
        uint256 incrementalAmount,
        uint256 incrementalSharesAmount
    );
    event SetPoolStatus(PoolStatus status);
    event SetQueueDepositParams(uint128 queueDepositMin, uint128 queueDepositMax);
    event DepositTokens(
        uint256 withdrawalPoolAmount,
        uint256 unusedTokensAmount,
        uint256 queuedTokensAmount
    );
    event SetWithdrawalPoolDepositMin(uint256 withdrawalPoolDepositMin);

    error InvalidValue();
    error UnauthorizedToken();
    error InsufficientQueuedTokens();
    error InvalidProof();
    error InsufficientBalance();
    error NothingToClaim();
    error DepositsDisabled();
    error WithdrawalsDisabled();
    error InsufficientDepositRoom();
    error CannotSetClosedStatus();
    error SenderNotAuthorized();
    error InvalidAmount();
    error StatusAlreadySet();
    error InsufficientLiquidity();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice initializes contract
     * @param _token address of asset token
     * @param _stakingPool address of staking pool
     * @param _sdlPool address of SDL pool
     * @param _withdrawalPoolDepositMin min amount of tokens required for withdrawal pool deposit
     * @param _queueDepositMin min amount of tokens required for strategy deposit
     * @param _queueDepositMax max amount of tokens that can be deposited into strategies at once
     **/
    function initialize(
        address _token,
        address _stakingPool,
        address _sdlPool,
        uint256 _withdrawalPoolDepositMin,
        uint128 _queueDepositMin,
        uint128 _queueDepositMax
    ) public initializer {
        __UUPSUpgradeable_init();
        __Ownable_init();
        __Pausable_init();
        token = IERC20Upgradeable(_token);
        stakingPool = IStakingPool(_stakingPool);
        sdlPool = ISDLPool(_sdlPool);
        withdrawalPoolDepositMin = _withdrawalPoolDepositMin;
        queueDepositMin = _queueDepositMin;
        queueDepositMax = _queueDepositMax;
        accounts.push(address(0));
        token.safeIncreaseAllowance(_stakingPool, type(uint256).max);
    }

    /**
     * @notice reverts if sender is not distribution oracle
     **/
    modifier onlyDistributionOracle() {
        if (msg.sender != distributionOracle) revert SenderNotAuthorized();
        _;
    }

    /**
     * @notice returns a list of all accounts in the order that they appear in the merkle tree
     * @return list of accounts
     */
    function getAccounts() external view returns (address[] memory) {
        return accounts;
    }

    /**
     * @notice returns the index of an account
     * @dev this index represents an account's position in the merkle tree
     * @param _account account address
     * @return account index
     */
    function getAccountIndex(address _account) external view returns (uint256) {
        return accountIndexes[_account];
    }

    /**
     * @notice returns an account's current amount of queued tokens
     * @dev _distributionAmount is stored on IPFS
     * @param _account account address
     * @param _distributionAmount account's distribution amount from the latest distribution
     * @return amount of queued tokens for an account
     */
    function getQueuedTokens(
        address _account,
        uint256 _distributionAmount
    ) public view returns (uint256) {
        return accountQueuedTokens[_account] - _distributionAmount;
    }

    /**
     * @notice returns an account's current amount of withdrawable LSD tokens
     * @dev _distributionShareAmount is stored on IPFS
     * @param _account account address
     * @param _distributionShareAmount account's distribution share amounts from the latest distribution
     * @return withdrawable LSD tokens for account
     */
    function getLSDTokens(
        address _account,
        uint256 _distributionShareAmount
    ) external view returns (uint256) {
        uint256 sharesToClaim = _distributionShareAmount - accountSharesClaimed[_account];
        return stakingPool.getStakeByShares(sharesToClaim);
    }

    /**
     * @notice returns the total amount of asset tokens that an account can withdraw
     * @dev includes account's queued tokens and stLINK balance and checks both priority pool
     * and staking pool liquidity
     * @param _account account address
     * @param _distributionAmount account's distribution amount from the latest distribution
     * @return amount of withrawable tokens
     */
    function canWithdraw(
        address _account,
        uint256 _distributionAmount
    ) external view returns (uint256) {
        uint256 canUnqueue = paused()
            ? 0
            : MathUpgradeable.min(getQueuedTokens(_account, _distributionAmount), totalQueued);
        uint256 stLINKCanWithdraw = MathUpgradeable.min(
            stakingPool.balanceOf(_account),
            stakingPool.canWithdraw() + totalQueued - canUnqueue
        );
        return canUnqueue + stLINKCanWithdraw;
    }

    /**
     * @notice ERC677 implementation to receive a token deposit or withdrawal
     * @dev can receive both asset tokens (deposit) and LSD tokens (withdrawal)
     * @param _sender of the token transfer
     * @param _value of the token transfer
     * @param _calldata encoded shouldQueue (bool) and calldata to pass to staking pool (bytes[])
     **/
    function onTokenTransfer(address _sender, uint256 _value, bytes calldata _calldata) external {
        if (_value == 0) revert InvalidValue();

        (bool shouldQueue, bytes[] memory data) = abi.decode(_calldata, (bool, bytes[]));

        if (msg.sender == address(token)) {
            _deposit(_sender, _value, shouldQueue, data);
        } else if (msg.sender == address(stakingPool)) {
            uint256 amountQueued = _withdraw(_sender, _value, shouldQueue, data);
            token.safeTransfer(_sender, _value - amountQueued);
        } else {
            revert UnauthorizedToken();
        }
    }

    /**
     * @notice deposits asset tokens into the staking pool and/or queue
     * @param _amount amount to deposit
     * @param _shouldQueue whether tokens should be queued if there's no room in the staking pool
     * @param _data optional deposit data passed to staking pool
     */
    function deposit(uint256 _amount, bool _shouldQueue, bytes[] calldata _data) external {
        if (_amount == 0) revert InvalidAmount();
        token.safeTransferFrom(msg.sender, address(this), _amount);
        _deposit(msg.sender, _amount, _shouldQueue, _data);
    }

    /**
     * @notice withdraws asset tokens
     * @dev will unqueue sender's tokens before taking LSD tokens if possible and
     * if _shouldUnqueue is set to true
     * @param _amountToWithdraw amount of tokens to withdraw
     * @param _amount amount as recorded in sender's merkle tree entry
     * @param _sharesAmount shares amount as recorded in sender's merkle tree entry
     * @param _merkleProof merkle proof for sender's merkle tree entry
     * @param _shouldUnqueue whether tokens should be unqueued before taking LSD tokens
     * @param _shouldQueueWithdrawal whether a withdrawal should be queued if the full withdrawal amount cannot be satisfied
     * @param _data optional withdrawal data passed to staking pool
     */
    function withdraw(
        uint256 _amountToWithdraw,
        uint256 _amount,
        uint256 _sharesAmount,
        bytes32[] calldata _merkleProof,
        bool _shouldUnqueue,
        bool _shouldQueueWithdrawal,
        bytes[] calldata _data
    ) external {
        if (_amountToWithdraw == 0) revert InvalidAmount();

        uint256 toWithdraw = _amountToWithdraw;
        address account = msg.sender;

        if (_shouldUnqueue == true) {
            _requireNotPaused();

            if (_merkleProof.length != 0) {
                bytes32 node = keccak256(
                    bytes.concat(keccak256(abi.encode(account, _amount, _sharesAmount)))
                );
                if (!MerkleProofUpgradeable.verify(_merkleProof, merkleRoot, node))
                    revert InvalidProof();
            } else if (accountIndexes[account] < merkleTreeSize) {
                revert InvalidProof();
            }

            uint256 queuedTokens = getQueuedTokens(account, _amount);
            uint256 canUnqueue = queuedTokens <= totalQueued ? queuedTokens : totalQueued;
            uint256 amountToUnqueue = toWithdraw <= canUnqueue ? toWithdraw : canUnqueue;

            if (amountToUnqueue != 0) {
                accountQueuedTokens[account] -= amountToUnqueue;
                totalQueued -= amountToUnqueue;
                toWithdraw -= amountToUnqueue;
                emit UnqueueTokens(account, amountToUnqueue);
            }
        }

        if (toWithdraw != 0) {
            IERC20Upgradeable(address(stakingPool)).safeTransferFrom(
                account,
                address(this),
                toWithdraw
            );
            toWithdraw = _withdraw(account, toWithdraw, _shouldQueueWithdrawal, _data);
        }

        token.safeTransfer(account, _amountToWithdraw - toWithdraw);
    }

    /**
     * @notice Unqueues queued tokens
     * @param _amountToUnqueue amount of tokens to unqueue
     * @param _amount amount as recorded in sender's merkle tree entry
     * @param _sharesAmount shares amount as recorded in sender's merkle tree entry
     * @param _merkleProof merkle proof for sender's merkle tree entry
     */
    function unqueueTokens(
        uint256 _amountToUnqueue,
        uint256 _amount,
        uint256 _sharesAmount,
        bytes32[] calldata _merkleProof
    ) external whenNotPaused {
        if (_amountToUnqueue == 0) revert InvalidAmount();
        if (_amountToUnqueue > totalQueued) revert InsufficientQueuedTokens();

        address account = msg.sender;
        if (accountIndexes[account] < merkleTreeSize) {
            bytes32 node = keccak256(
                bytes.concat(keccak256(abi.encode(account, _amount, _sharesAmount)))
            );
            if (!MerkleProofUpgradeable.verify(_merkleProof, merkleRoot, node))
                revert InvalidProof();
        }

        if (_amountToUnqueue > getQueuedTokens(account, _amount)) revert InsufficientBalance();

        accountQueuedTokens[account] -= _amountToUnqueue;
        totalQueued -= _amountToUnqueue;
        token.safeTransfer(account, _amountToUnqueue);

        emit UnqueueTokens(account, _amountToUnqueue);
    }

    /**
     * @notice claims withdrawable LSD tokens
     * @param _amount amount as recorded in sender's merkle tree entry
     * @param _sharesAmount shares amount as recorded in sender's merkle tree entry
     * @param _merkleProof merkle proof for sender's merkle tree entry
     */
    function claimLSDTokens(
        uint256 _amount,
        uint256 _sharesAmount,
        bytes32[] calldata _merkleProof
    ) external {
        address account = msg.sender;

        bytes32 node = keccak256(
            bytes.concat(keccak256(abi.encode(account, _amount, _sharesAmount)))
        );
        if (!MerkleProofUpgradeable.verify(_merkleProof, merkleRoot, node)) revert InvalidProof();

        uint256 amountToClaim = _amount - accountClaimed[account];
        uint256 sharesAmountToClaim = _sharesAmount - accountSharesClaimed[account];
        uint256 amountToClaimWithYield = stakingPool.getStakeByShares(sharesAmountToClaim);

        if (amountToClaimWithYield == 0) revert NothingToClaim();

        accountClaimed[account] = _amount;
        accountSharesClaimed[account] = _sharesAmount;
        IERC20Upgradeable(address(stakingPool)).safeTransfer(account, amountToClaimWithYield);

        emit ClaimLSDTokens(account, amountToClaim, amountToClaimWithYield);
    }

    /**
     * @notice deposits queued and/or unused tokens
     * @dev allows bypassing of the stored deposit limits
     * @param _withdrawalPoolDepositMin min amount of tokens required for withdrawal pool deposit
     * @param _queueDepositMin min amount of tokens required for strategy deposit
     * @param _queueDepositMax max amount of tokens that can be deposited into strategies at once
     * @param _data optional deposit data passed to staking pool
     */
    function depositQueuedTokens(
        uint256 _withdrawalPoolDepositMin,
        uint256 _queueDepositMin,
        uint256 _queueDepositMax,
        bytes[] calldata _data
    ) external {
        _depositQueuedTokens(_withdrawalPoolDepositMin, _queueDepositMin, _queueDepositMax, _data);
    }

    /**
     * @notice returns whether a call should be made to performUpkeep to deposit queued/unused tokens
     * into the staking pool and/or withdrawal pool
     * @dev used by chainlink keepers
     */
    function checkUpkeep(bytes calldata) external view returns (bool, bytes memory) {
        uint256 queuedWithdrawals = withdrawalPool.getTotalQueuedWithdrawals();
        uint256 strategyDepositRoom = stakingPool.getStrategyDepositRoom();
        uint256 unusedDeposits = stakingPool.getUnusedDeposits();

        if (poolStatus != PoolStatus.OPEN) return (false, bytes(""));

        return (
            (queuedWithdrawals >= withdrawalPoolDepositMin &&
                totalQueued >= withdrawalPoolDepositMin) ||
                (strategyDepositRoom >= queueDepositMin &&
                    (totalQueued + unusedDeposits) >= queueDepositMin),
            bytes("")
        );
    }

    /**
     * @notice deposits queued and/or unused tokens
     * @dev will revert if the amount of tokens that can be deposited is less than the queued and withdrawal
     * pool deposit minimums
     * @dev used by chainlink keepers
     */
    function performUpkeep(bytes calldata _performData) external {
        bytes[] memory depositData = abi.decode(_performData, (bytes[]));

        _depositQueuedTokens(
            withdrawalPoolDepositMin,
            queueDepositMin,
            queueDepositMax,
            depositData
        );
    }

    /**
     * @notice returns the amount of deposits since the last call to updateDistribution and the amount of shares
     * received for those deposits
     * @return amount of deposits
     * @return amount of shares
     */
    function getDepositsSinceLastUpdate() external view returns (uint256, uint256) {
        return (depositsSinceLastUpdate, sharesSinceLastUpdate);
    }

    /**
     * @notice returns account data used for calculating a new merkle tree
     * @dev merkle tree is calculated based on users' reSDL balance and the number of tokens they have queued,
     * the index of an account in this contract is equal to their index in the tree
     * @return accounts list of all accounts that have ever queued tokens
     * @return sdlBalances list of SDL balances for each account
     * @return queuedBalances list of queued token amounts for each account (ignores distributed LSD tokens)
     */
    function getAccountData()
        external
        view
        returns (address[] memory, uint256[] memory, uint256[] memory)
    {
        uint256[] memory reSDLBalances = new uint256[](accounts.length);
        uint256[] memory queuedBalances = new uint256[](accounts.length);

        for (uint256 i = 0; i < reSDLBalances.length; ++i) {
            address account = accounts[i];
            reSDLBalances[i] = sdlPool.effectiveBalanceOf(account);
            queuedBalances[i] = accountQueuedTokens[account];
        }

        return (accounts, reSDLBalances, queuedBalances);
    }

    /**
     * @notice distributes a new batch of LSD tokens to users that have queued tokens
     * @param _merkleRoot new merkle root for the distribution tree
     * @param _ipfsHash new ipfs hash for the distribution tree (CIDv0, no prefix - only hash)
     * @param _amountDistributed amount of LSD tokens distributed in this distribution
     * @param _sharesAmountDistributed amount of LSD shares distributed in this distribution
     */
    function updateDistribution(
        bytes32 _merkleRoot,
        bytes32 _ipfsHash,
        uint256 _amountDistributed,
        uint256 _sharesAmountDistributed
    ) external onlyDistributionOracle {
        _unpause();

        depositsSinceLastUpdate -= _amountDistributed;
        sharesSinceLastUpdate -= _sharesAmountDistributed;
        merkleRoot = _merkleRoot;
        ipfsHash = _ipfsHash;
        merkleTreeSize = accounts.length;

        emit UpdateDistribution(
            _merkleRoot,
            _ipfsHash,
            _amountDistributed,
            _sharesAmountDistributed
        );
    }

    /**
     * @notice pauses queueing and unqueueing so a new merkle tree can be generated
     */
    function pauseForUpdate() external onlyDistributionOracle {
        _pause();
    }

    /**
     * @notice sets the pool's status
     * @param _status pool status
     */
    function setPoolStatus(PoolStatus _status) external {
        if (msg.sender != owner() && msg.sender != rebaseController) revert SenderNotAuthorized();
        if (_status == poolStatus) revert StatusAlreadySet();
        poolStatus = _status;
        emit SetPoolStatus(_status);
    }

    /**
     * @notice sets the minimum and maximum amount that can be deposited into strategies at once
     * @param _queueDepositMin min amount of tokens required for strategy deposit
     * @param _queueDepositMax max amount of tokens that can be deposited into strategies at once
     */
    function setQueueDepositParams(
        uint128 _queueDepositMin,
        uint128 _queueDepositMax
    ) external onlyOwner {
        queueDepositMin = _queueDepositMin;
        queueDepositMax = _queueDepositMax;
        emit SetQueueDepositParams(_queueDepositMin, _queueDepositMax);
    }

    /**
     * @notice sets the minimum amount that can be deposited into the withdrawal pool
     * @param _withdrawalPoolDepositMin min amount of tokens required for deposit
     */
    function setWithdrawalPoolDepositMin(uint128 _withdrawalPoolDepositMin) external onlyOwner {
        withdrawalPoolDepositMin = _withdrawalPoolDepositMin;
        emit SetWithdrawalPoolDepositMin(_withdrawalPoolDepositMin);
    }

    /**
     * @notice sets the distribution oracle
     * @param _distributionOracle address of oracle
     */
    function setDistributionOracle(address _distributionOracle) external onlyOwner {
        distributionOracle = _distributionOracle;
    }

    /**
     * @notice sets the address of the rebase controller
     * @dev this address has authorization to close the pool
     * @param _rebaseController address of rebase controller
     */
    function setRebaseController(address _rebaseController) external onlyOwner {
        rebaseController = _rebaseController;
    }

    /**
     * @notice sets the withdrawal pool
     * @param _withdrawalPool address of withdrawal pool
     */
    function setWithdrawalPool(address _withdrawalPool) external onlyOwner {
        withdrawalPool = IWithdrawalPool(_withdrawalPool);
    }

    /**
     * @notice deposits asset tokens into the withdrawal pool, staking pool, and/or queue
     * @dev tokens will be deposited into the withdrawal pool and/or staking pool if there is room and the queue
     * is empty, otherwise they will be queued if `_shouldQueue` is true; remaining tokens will be returned to sender
     * @param _account account to deposit for
     * @param _amount amount to deposit
     * @param _shouldQueue whether tokens should be queued
     * @param _data optional deposit data passed to staking pool
     **/
    function _deposit(
        address _account,
        uint256 _amount,
        bool _shouldQueue,
        bytes[] memory _data
    ) internal {
        if (poolStatus != PoolStatus.OPEN) revert DepositsDisabled();

        uint256 toDeposit = _amount;

        if (totalQueued == 0) {
            uint256 queuedWithdrawals = withdrawalPool.getTotalQueuedWithdrawals();
            if (queuedWithdrawals != 0) {
                uint256 toDepositIntoQueue = toDeposit <= queuedWithdrawals
                    ? toDeposit
                    : queuedWithdrawals;
                withdrawalPool.deposit(toDepositIntoQueue);
                toDeposit -= toDepositIntoQueue;
            }

            if (toDeposit != 0) {
                uint256 canDeposit = stakingPool.canDeposit();
                if (canDeposit != 0) {
                    uint256 toDepositIntoPool = toDeposit <= canDeposit ? toDeposit : canDeposit;
                    stakingPool.deposit(_account, toDepositIntoPool, _data);
                    toDeposit -= toDepositIntoPool;
                }
            }
        }

        if (toDeposit != 0 && _shouldQueue) {
            _requireNotPaused();
            if (accountIndexes[_account] == 0) {
                accounts.push(_account);
                accountIndexes[_account] = accounts.length - 1;
            }
            accountQueuedTokens[_account] += toDeposit;
            totalQueued += toDeposit;
        } else if (toDeposit != 0) {
            token.safeTransfer(_account, toDeposit);
        }

        emit Deposit(_account, _amount - toDeposit, _shouldQueue ? toDeposit : 0);
    }

    /**
     * @notice withdraws asset tokens
     * @dev will swap LSD tokens for queued tokens if possible followed by withdrawing
     * from the staking pool, and then queuing any remaining tokens for withdrawal
     * @param _account account to withdraw for
     * @param _amount amount to withdraw
     * @param _shouldQueueWithdrawal whether a withdrawal should be queued if the the full amount cannot be satisfied
     * @param _data optional withdrawal data passed to staking pool
     * @return the amount of tokens that were queued for withdrawal
     **/
    function _withdraw(
        address _account,
        uint256 _amount,
        bool _shouldQueueWithdrawal,
        bytes[] memory _data
    ) internal returns (uint256) {
        if (poolStatus == PoolStatus.CLOSED) revert WithdrawalsDisabled();

        uint256 toWithdraw = _amount;

        if (withdrawalPool.getTotalQueuedWithdrawals() == 0) {
            uint256 toWithdrawFromQueue = toWithdraw <= totalQueued ? toWithdraw : totalQueued;

            if (toWithdrawFromQueue != 0) {
                totalQueued -= toWithdrawFromQueue;
                depositsSinceLastUpdate += toWithdrawFromQueue;
                sharesSinceLastUpdate += stakingPool.getSharesByStake(toWithdrawFromQueue);
                toWithdraw -= toWithdrawFromQueue;
            }

            if (toWithdraw != 0) {
                uint256 toWithdrawFromPool = MathUpgradeable.min(
                    stakingPool.canWithdraw(),
                    toWithdraw
                );
                if (toWithdrawFromPool != 0) {
                    stakingPool.withdraw(address(this), address(this), toWithdrawFromPool, _data);
                    toWithdraw -= toWithdrawFromPool;
                }
            }
        }

        if (toWithdraw != 0) {
            if (!_shouldQueueWithdrawal) revert InsufficientLiquidity();
            withdrawalPool.queueWithdrawal(_account, toWithdraw);
        }

        emit Withdraw(_account, _amount - toWithdraw);
        return toWithdraw;
    }

    /**
     * @notice deposits queued and/or unused tokens
     * @dev will prioritize withdrawal pool deposits, then unused staking pool deposits, then new staking pool deposits
     * @param _withdrawalPoolDepositMin min amount of tokens required for withdrawal pool deposit
     * @param _depositMin min amount of tokens required to deposit
     * @param _depositMax max amount of tokens that can be deposited into strategies at once
     * @param _data optional deposit data passed to staking pool
     **/
    function _depositQueuedTokens(
        uint256 _withdrawalPoolDepositMin,
        uint256 _depositMin,
        uint256 _depositMax,
        bytes[] memory _data
    ) internal {
        if (poolStatus != PoolStatus.OPEN) revert DepositsDisabled();

        uint256 _totalQueued = totalQueued;

        uint256 toDepositIntoWithdrawalPool;
        uint256 queuedWithdrawals = withdrawalPool.getTotalQueuedWithdrawals();
        if (
            queuedWithdrawals >= _withdrawalPoolDepositMin &&
            _totalQueued >= _withdrawalPoolDepositMin
        ) {
            toDepositIntoWithdrawalPool = MathUpgradeable.min(queuedWithdrawals, _totalQueued);
            withdrawalPool.deposit(toDepositIntoWithdrawalPool);
            _totalQueued -= toDepositIntoWithdrawalPool;
        }

        uint256 strategyDepositRoom = stakingPool.getStrategyDepositRoom();
        if (
            (strategyDepositRoom == 0 || strategyDepositRoom < _depositMin) &&
            toDepositIntoWithdrawalPool == 0
        ) {
            revert InsufficientDepositRoom();
        }

        uint256 unusedDeposits = stakingPool.getUnusedDeposits();
        uint256 canDeposit = _totalQueued + unusedDeposits;
        if ((canDeposit == 0 || canDeposit < _depositMin) && toDepositIntoWithdrawalPool == 0) {
            revert InsufficientQueuedTokens();
        }

        if (strategyDepositRoom >= _depositMin && canDeposit >= _depositMin) {
            uint256 toDepositFromStakingPool = MathUpgradeable.min(
                MathUpgradeable.min(unusedDeposits, strategyDepositRoom),
                _depositMax
            );
            uint256 toDepositFromQueue = MathUpgradeable.min(
                MathUpgradeable.min(_totalQueued, strategyDepositRoom - toDepositFromStakingPool),
                _depositMax - toDepositFromStakingPool
            );

            stakingPool.deposit(address(this), toDepositFromQueue, _data);
            _totalQueued -= toDepositFromQueue;

            emit DepositTokens(
                toDepositIntoWithdrawalPool,
                toDepositFromStakingPool,
                toDepositFromQueue
            );
        } else {
            emit DepositTokens(toDepositIntoWithdrawalPool, 0, 0);
        }

        if (_totalQueued != totalQueued) {
            uint256 diff = totalQueued - _totalQueued;
            depositsSinceLastUpdate += diff;
            sharesSinceLastUpdate += stakingPool.getSharesByStake(diff);
            totalQueued = _totalQueued;
        }
    }

    /**
     * @dev Checks authorization for contract upgrades
     */
    function _authorizeUpgrade(address) internal override onlyOwner {}
}
