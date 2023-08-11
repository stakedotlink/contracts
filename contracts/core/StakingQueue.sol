// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/MerkleProofUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

import "./interfaces/IStakingPool.sol";
import "./interfaces/ISDLPool.sol";

/**
 * @title Staking Queue
 * @notice Allows users to queue asset tokens which are eventually deposited into a staking pool when space becomes available -
 * liquid staking derivative tokens minted by the staking pool are then distributed using a merkle tree
 */
contract StakingQueue is UUPSUpgradeable, OwnableUpgradeable, PausableUpgradeable {
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

    uint256 public queueDepositThreshold;
    PoolStatus public poolStatus;

    bytes32 public merkleRoot;
    bytes32 public ipfsHash;
    uint256 public totalDistributed;
    uint256 public totalSharesDistributed;

    uint256 public totalQueued;
    uint256 public depositsSinceLastUpdate;

    address[] private accounts;
    mapping(address => uint256) private accountIndexes;
    mapping(address => uint256) private accountQueuedTokens;
    mapping(address => uint256) private accountClaimed;
    mapping(address => uint256) private accountSharesClaimed;

    event UnqueueTokens(address indexed account, uint256 amount);
    event ClaimLSDTokens(address indexed account, uint256 amount, uint256 amountWithYield);
    event Deposit(address indexed account, uint256 poolAmount, uint256 queueAmount);
    event Withdraw(address indexed account, uint256 poolAmount, uint256 queueAmount);
    event UpdateDistribution(
        bytes32 merkleRoot,
        bytes32 ipfsHash,
        uint256 incrementalAmount,
        uint256 incrementalSharesAmount
    );
    event SetPoolStatus(PoolStatus status);
    event SetQueueDepositThreshold(uint256 threshold);
    event DepositQueuedTokens(uint256 amount);

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

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice initializes contract
     * @param _token address of asset token
     * @param _stakingPool address of staking pool
     * @param _sdlPool address of SDL pool
     * @param _queueDepositThreshold min amount of tokens needed to execute deposit
     **/
    function initialize(
        address _token,
        address _stakingPool,
        address _sdlPool,
        uint256 _queueDepositThreshold
    ) public initializer {
        __UUPSUpgradeable_init();
        __Ownable_init();
        __Pausable_init();
        token = IERC20Upgradeable(_token);
        stakingPool = IStakingPool(_stakingPool);
        sdlPool = ISDLPool(_sdlPool);
        queueDepositThreshold = _queueDepositThreshold;
        accounts.push(address(0));
        token.safeApprove(_stakingPool, type(uint256).max);
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
    function getQueuedTokens(address _account, uint256 _distributionAmount) external view returns (uint256) {
        return accountQueuedTokens[_account] - _distributionAmount;
    }

    /**
     * @notice returns an account's current amount of withdrawable LSD tokens
     * @dev _distributionShareAmount is stored on IPFS
     * @param _account account address
     * @param _distributionShareAmount account's distribution share amounts from the latest distribution
     * @return withdrawable LSD tokens for account
     */
    function getLSDTokens(address _account, uint256 _distributionShareAmount) external view returns (uint256) {
        uint256 sharesToClaim = _distributionShareAmount - accountSharesClaimed[_account];
        return stakingPool.getStakeByShares(sharesToClaim);
    }

    /**
     * @notice returns the total amount of asset tokens that can be withdrawn
     * @dev tokens are withdrawn from the queue first (if it's not paused) followed by
     * the staking pool
     * @return amount of withrawable tokens
     */
    function canWithdraw() external view returns (uint256) {
        uint256 withdrawable = stakingPool.canWithdraw();
        if (!paused()) {
            withdrawable += totalQueued;
        }
        return withdrawable;
    }

    /**
     * @notice ERC677 implementation to receive a token deposit or withdrawal
     * @dev can receive both asset tokens (deposit) and LSD tokens (withdrawal)
     * @param _sender of the token transfer
     * @param _value of the token transfer
     * @param _calldata encoded shouldQueue (bool)
     **/
    function onTokenTransfer(
        address _sender,
        uint256 _value,
        bytes calldata _calldata
    ) external {
        if (_value == 0) revert InvalidValue();

        if (msg.sender == address(token)) {
            bool shouldQueue = abi.decode(_calldata, (bool));
            _deposit(_sender, _value, shouldQueue);
        } else if (msg.sender == address(stakingPool)) {
            _withdraw(_sender, _value);
        } else {
            revert UnauthorizedToken();
        }
    }

    /**
     * @notice deposits asset tokens into the staking pool and/or queue
     * @param _amount amount to deposit
     * @param _shouldQueue whether tokens should be queued if there's no room in the staking pool
     */
    function deposit(uint256 _amount, bool _shouldQueue) external {
        if (_amount == 0) revert InvalidAmount();
        token.safeTransferFrom(msg.sender, address(this), _amount);
        _deposit(msg.sender, _amount, _shouldQueue);
    }

    /**
     * @notice withdraws asset tokens
     * @param _amount amount to withdraw
     */
    function withdraw(uint256 _amount) external {
        if (_amount == 0) revert InvalidAmount();
        IERC20Upgradeable(address(stakingPool)).safeTransferFrom(msg.sender, address(this), _amount);
        _withdraw(msg.sender, _amount);
    }

    /**
     * @notice Unqueues queued tokens
     * @param _amount amount as recorded in sender's merkle tree entry
     * @param _sharesAmount shares amount as recorded in sender's merkle tree entry
     * @param _merkleProof merkle proof for sender's merkle tree entry
     * @param _amountToUnqueue amount of tokens to unqueue
     */
    function unqueueTokens(
        uint256 _amount,
        uint256 _sharesAmount,
        bytes32[] calldata _merkleProof,
        uint256 _amountToUnqueue
    ) external whenNotPaused {
        if (_amountToUnqueue == 0) revert InvalidAmount();
        if (_amountToUnqueue > totalQueued) revert InsufficientQueuedTokens();

        address account = msg.sender;
        if (merkleRoot != bytes32(0)) {
            bytes32 node = keccak256(bytes.concat(keccak256(abi.encode(account, _amount, _sharesAmount))));
            if (!MerkleProofUpgradeable.verify(_merkleProof, merkleRoot, node)) revert InvalidProof();
        }

        if (_amountToUnqueue > accountQueuedTokens[account] - _amount) revert InsufficientBalance();

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

        bytes32 node = keccak256(bytes.concat(keccak256(abi.encode(account, _amount, _sharesAmount))));
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
     * @notice deposits queued tokens into the staking pool
     * @dev bypasses queueDepositThreshold
     */
    function depositQueuedTokens() public {
        _depositQueuedTokens(0);
    }

    /**
     * @notice returns whether a call should be made to performUpkeep to deposit queued tokens
     * into the staking pool
     * @dev used by chainlink keepers
     */
    function checkUpkeep(bytes calldata) external view returns (bool, bytes memory) {
        uint256 canDeposit = stakingPool.canDeposit();
        return (
            poolStatus == PoolStatus.OPEN && totalQueued >= queueDepositThreshold && canDeposit >= queueDepositThreshold,
            bytes("")
        );
    }

    /**
     * @notice deposits queued tokens into the staking pool
     * @dev will revert if less than queueDepositThreshold tokens can be deposited
     * @dev used by chainlink keepers
     */
    function performUpkeep(bytes calldata) external {
        _depositQueuedTokens(queueDepositThreshold);
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
        returns (
            address[] memory,
            uint256[] memory,
            uint256[] memory
        )
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
     * @param _totalAmount lifetime amount of LSD tokens distributed
     * @param _totalSharesAmount lifetime amount of LSD shares distributed
     */
    function updateDistribution(
        bytes32 _merkleRoot,
        bytes32 _ipfsHash,
        uint256 _totalAmount,
        uint256 _totalSharesAmount
    ) external onlyDistributionOracle {
        _unpause();

        uint256 incrementalAmount = _totalAmount - totalDistributed;
        uint256 incrementalSharesAmount = _totalSharesAmount - totalSharesDistributed;

        depositsSinceLastUpdate -= incrementalAmount;
        merkleRoot = _merkleRoot;
        ipfsHash = _ipfsHash;
        totalDistributed = _totalAmount;
        totalSharesDistributed = _totalSharesAmount;

        emit UpdateDistribution(_merkleRoot, _ipfsHash, incrementalAmount, incrementalSharesAmount);
    }

    /**
     * @notice pauses queue deposits/withdrawals so a new merkle tree can be generated
     */
    function pauseForUpdate() external onlyDistributionOracle {
        _pause();
    }

    /**
     * @notice sets the pool's status
     * @param _status pool status
     */
    function setPoolStatus(PoolStatus _status) external onlyOwner {
        if (_status == PoolStatus.CLOSED) revert CannotSetClosedStatus();
        poolStatus = _status;
        emit SetPoolStatus(_status);
    }

    /**
     * @notice sets the pool's status to CLOSED
     */
    function setPoolStatusClosed() external onlyOwner {
        poolStatus = PoolStatus.CLOSED;
        emit SetPoolStatus(PoolStatus.CLOSED);
    }

    /**
     * @notice sets the minimum amount of tokens needed to execute a deposit
     * @param _queueDepositThreshold min amount of tokens
     */
    function setQueueDepositThreshold(uint256 _queueDepositThreshold) external onlyOwner {
        queueDepositThreshold = _queueDepositThreshold;
        emit SetQueueDepositThreshold(_queueDepositThreshold);
    }

    /**
     * @notice sets the distribution oracle
     * @param _distributionOracle address of oracle
     */
    function setDistributionOracle(address _distributionOracle) external onlyOwner {
        distributionOracle = _distributionOracle;
    }

    /**
     * @notice deposits asset tokens into the staking pool and/or queue
     * @dev tokens will be deposited into staking pool if there is room and the queue is empty, otherwise
     * they will be queued if `_shouldQueue` is true; remaining tokens will be returned to sender
     * @param _account account to deposit for
     * @param _amount amount to deposit
     * @param _shouldQueue whether tokens should be queued
     **/
    function _deposit(
        address _account,
        uint256 _amount,
        bool _shouldQueue
    ) internal {
        if (poolStatus != PoolStatus.OPEN) revert DepositsDisabled();

        uint256 toDeposit = _amount;

        if (totalQueued == 0) {
            uint256 canDeposit = stakingPool.canDeposit();
            if (canDeposit != 0) {
                uint256 toDepositIntoPool = toDeposit <= canDeposit ? toDeposit : canDeposit;
                stakingPool.deposit(_account, toDepositIntoPool);
                toDeposit -= toDepositIntoPool;
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
     * from the staking pool if necessary (assumes staking pool will revert if there is insufficient withdrawal room)
     * @param _account account to withdraw for
     * @param _amount amount to withdraw
     **/
    function _withdraw(address _account, uint256 _amount) internal {
        if (poolStatus == PoolStatus.CLOSED) revert WithdrawalsDisabled();

        uint256 toWithdrawFromQueue = _amount <= totalQueued ? _amount : totalQueued;
        uint256 toWithdrawFromPool = _amount - toWithdrawFromQueue;

        if (toWithdrawFromQueue != 0) {
            totalQueued -= toWithdrawFromQueue;
            depositsSinceLastUpdate += toWithdrawFromQueue;
        }

        if (toWithdrawFromPool != 0) {
            stakingPool.withdraw(address(this), address(this), toWithdrawFromPool);
        }

        token.safeTransfer(_account, _amount);
        emit Withdraw(_account, toWithdrawFromPool, toWithdrawFromQueue);
    }

    /**
     * @notice deposits queued tokens
     * @param _depositThreshold min amount of tokens required for successful deposit
     **/
    function _depositQueuedTokens(uint256 _depositThreshold) internal {
        if (poolStatus != PoolStatus.OPEN) revert DepositsDisabled();

        uint256 canDeposit = stakingPool.canDeposit();
        if (canDeposit == 0 || canDeposit < _depositThreshold) revert InsufficientDepositRoom();

        uint256 _totalQueued = totalQueued;
        if (_totalQueued == 0 || _totalQueued < _depositThreshold) revert InsufficientQueuedTokens();

        uint256 toDeposit = _totalQueued <= canDeposit ? _totalQueued : canDeposit;

        totalQueued = _totalQueued - toDeposit;
        depositsSinceLastUpdate += toDeposit;
        stakingPool.deposit(address(this), toDeposit);

        emit DepositQueuedTokens(toDeposit);
    }

    /**
     * @dev Checks authorization for contract upgrades
     */
    function _authorizeUpgrade(address) internal override onlyOwner {}
}