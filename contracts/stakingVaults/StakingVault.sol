// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../core/interfaces/IERC677.sol";
import "./interfaces/IStakingAdapter.sol";
import "./interfaces/IStakingVaultHub.sol";
import "./interfaces/IStakingVaultFactory.sol";

/**
 * @title StakingVault
 * @notice Isolated staking vault for a single staker
 * @dev Supports multiple adapters for protocol-agnostic staking and coordinated capacity
 * allocation via StakingAllocator. LST minting is handled by VaultHub directly — the
 * vault has no awareness of LST.
 */
contract StakingVault is UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    uint64 private constant VERSION = 1;

    /// @notice Staking asset token
    IERC677 public immutable token;
    /// @notice VaultHub policy registry
    IStakingVaultHub public immutable hub;
    /// @notice Factory that deployed this vault
    IStakingVaultFactory public immutable factory;

    /// @notice Vault owner — full custody and admin control
    address public owner;
    /// @notice Pending owner for two-step transfer
    address public pendingOwner;
    /// @notice Operator — can stake/unbond/claim but cannot withdraw funds
    address public operator;
    /// @notice StakingAllocator contract — can trigger staking during capacity races
    address public allocator;

    /// @notice If true, implementation is permanently frozen
    bool public ossified;

    /// @notice Active adapters
    address[] internal adapters;
    /// @notice Quick lookup for registered adapters
    mapping(address => bool) public isAdapter;

    // --- Events ---

    event Deposited(address indexed sender, uint256 amount);
    event Staked(address indexed adapter, uint256 amount, bool viaAllocator);
    event Unstaked(address indexed adapter, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event RewardsClaimed(address indexed adapter, uint256 rewards);
    event Unbonded(address indexed adapter);
    event AdapterAdded(address indexed adapter);
    event AdapterRemoved(address indexed adapter);
    event AdapterExitInitiated(address indexed adapter);
    event AdapterExitFinalized(address indexed adapter, uint256 recovered);
    event Ossified();
    event TotalValueUpdated(uint256 newValue);
    event Rebalanced(uint256 amount);
    event OperatorUpdated(address indexed operator);
    event AllocatorUpdated(address indexed allocator);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ERC20Recovered(address indexed token, address indexed recipient, uint256 amount);

    // --- Errors ---

    error VaultOssified();
    error AdapterNotRegistered();
    error AdapterAlreadyRegistered();
    error AdapterHasDeposits();
    error AdapterNotFromFactory();
    error AdapterVaultMismatch();
    error WithdrawBlockedByHub();
    error ZeroAmount();
    error ZeroAddress();
    error OnlyOwner();
    error OnlyPendingOwner();
    error OnlyOperator();
    error OnlyAllocator();
    error OnlyHub();
    error CannotRecoverStakingToken();
    error StakeBlockedByHub();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert OnlyOperator();
        _;
    }

    modifier onlyAllocator() {
        if (msg.sender != allocator) revert OnlyAllocator();
        _;
    }

    modifier onlyHub() {
        if (msg.sender != address(hub)) revert OnlyHub();
        _;
    }

    modifier validAdapter(address _adapter) {
        if (!isAdapter[_adapter]) revert AdapterNotRegistered();
        _;
    }

    /**
     * @notice Sets immutable references shared across all proxy instances
     * @param _token Staking asset token address
     * @param _hub VaultHub address
     * @param _factory Factory that deployed this vault
     */
    constructor(address _token, address _hub, address _factory) {
        if (_token == address(0) || _hub == address(0) || _factory == address(0)) {
            revert ZeroAddress();
        }
        token = IERC677(_token);
        hub = IStakingVaultHub(_hub);
        factory = IStakingVaultFactory(_factory);
        _disableInitializers();
    }

    /**
     * @notice Initializes the vault
     * @param _owner Vault owner
     * @param _operator Operator address
     * @param _allocator StakingAllocator address (address(0) to disable)
     */
    function initialize(
        address _owner,
        address _operator,
        address _allocator
    ) external initializer {
        if (_owner == address(0) || _operator == address(0)) revert ZeroAddress();

        __UUPSUpgradeable_init();

        owner = _owner;
        operator = _operator;
        allocator = _allocator;

        // Approve hub to pull tokens for fee settlement
        IERC20Upgradeable(address(token)).safeApprove(address(hub), type(uint256).max);

        emit OwnershipTransferred(address(0), _owner);
        emit OperatorUpdated(_operator);
        if (_allocator != address(0)) emit AllocatorUpdated(_allocator);
    }

    // ═══════════════════════════════════════════════════════
    //  View Functions
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Returns the version of the contract implementation
     */
    function version() external pure returns (uint64) {
        return VERSION;
    }

    /**
     * @notice Get all active adapters
     * @return List of adapter addresses
     */
    function getAdapters() external view returns (address[] memory) {
        return adapters;
    }

    /**
     * @notice Get the idle token balance in the vault (not staked in any adapter)
     * @return Idle token balance
     */
    function idleBalance() external view returns (uint256) {
        return IERC20Upgradeable(address(token)).balanceOf(address(this));
    }

    /**
     * @notice Get the total value held across all adapters (principal + accrued rewards, excludes idle balance)
     * @return Total value in adapters
     */
    function stakedBalance() external view returns (uint256) {
        uint256 staked;
        uint256 len = adapters.length;
        for (uint256 i = 0; i < len; i++) {
            staked += IStakingAdapter(adapters[i]).getTotalDeposits();
        }
        return staked;
    }

    // ═══════════════════════════════════════════════════════
    //  Deposits & Staking
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Deposit tokens into the vault — tokens sit idle until staked
     * @param _amount Amount to deposit
     */
    function deposit(uint256 _amount) external onlyOwner {
        if (_amount == 0) revert ZeroAmount();

        IERC20Upgradeable(address(token)).safeTransferFrom(msg.sender, address(this), _amount);
        hub.recordDeposit(_amount);
        emit Deposited(msg.sender, _amount);
    }

    /**
     * @notice Stake idle tokens from vault into a specific adapter
     * @param _adapter Adapter to stake into
     * @param _amount Amount to stake
     */
    function stake(address _adapter, uint256 _amount) external onlyOperator {
        _stake(_adapter, _amount, false);
    }

    /**
     * @notice Stake via the StakingAllocator during capacity races
     * @param _adapter Adapter to stake into
     * @param _amount Amount to stake
     */
    function stakeViaAllocator(address _adapter, uint256 _amount) external onlyAllocator {
        _stake(_adapter, _amount, true);
    }

    // ═══════════════════════════════════════════════════════
    //  Withdrawals & Rewards
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Withdraw idle tokens from the vault to a recipient
     * @dev Checks that withdrawal does not breach the locked collateral amount.
     * @param _amount Amount to withdraw
     * @param _to Recipient address
     */
    function withdraw(uint256 _amount, address _to) external onlyOwner {
        if (_amount == 0) revert ZeroAmount();
        if (_to == address(0)) revert ZeroAddress();
        if (_amount > hub.canWithdraw(address(this))) revert WithdrawBlockedByHub();

        IERC20Upgradeable(address(token)).safeTransfer(_to, _amount);
        hub.recordWithdrawal(_amount);
        emit Withdrawn(_to, _amount);
    }

    /**
     * @notice Unstake tokens from an adapter back to the vault as idle balance
     * @param _adapter Adapter to unstake from
     * @param _amount Amount to unstake
     */
    function unstake(
        address _adapter,
        uint256 _amount
    ) external onlyOperator validAdapter(_adapter) {
        if (_amount == 0) revert ZeroAmount();

        IStakingAdapter(_adapter).unstake(_amount);
        emit Unstaked(_adapter, _amount);
    }

    /**
     * @notice Begin unbonding on a specific adapter
     * @param _adapter Adapter to unbond
     */
    function unbond(address _adapter) external onlyOperator validAdapter(_adapter) {
        IStakingAdapter(_adapter).unbond();
        emit Unbonded(_adapter);
    }

    /**
     * @notice Claim rewards from one or more adapters — rewards stay in the vault
     * @param _adapters Adapters to claim from
     */
    function claimRewards(address[] calldata _adapters) external onlyOperator {
        for (uint256 i = 0; i < _adapters.length; i++) {
            if (!isAdapter[_adapters[i]]) revert AdapterNotRegistered();
            uint256 rewards = IStakingAdapter(_adapters[i]).claimRewards();
            if (rewards > 0) emit RewardsClaimed(_adapters[i], rewards);
        }
    }

    // ═══════════════════════════════════════════════════════
    //  Adapter Management
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Add a new adapter to the vault
     * @param _adapter Adapter address (must be factory-deployed and assigned to this vault)
     */
    function addAdapter(address _adapter) external onlyOwner {
        if (isAdapter[_adapter]) revert AdapterAlreadyRegistered();
        if (!factory.deployedAdapters(_adapter)) revert AdapterNotFromFactory();
        if (IStakingAdapter(_adapter).vault() != address(this)) revert AdapterVaultMismatch();

        adapters.push(_adapter);
        isAdapter[_adapter] = true;

        IERC20Upgradeable(address(token)).safeApprove(_adapter, type(uint256).max);

        emit AdapterAdded(_adapter);
    }

    /**
     * @notice Remove an adapter that has zero deposits
     * @param _adapter Adapter to remove
     */
    function removeAdapter(address _adapter) external onlyOwner validAdapter(_adapter) {
        if (IStakingAdapter(_adapter).getTotalDeposits() != 0) revert AdapterHasDeposits();

        isAdapter[_adapter] = false;
        IERC20Upgradeable(address(token)).safeApprove(_adapter, 0);

        uint256 len = adapters.length;
        for (uint256 i = 0; i < len; i++) {
            if (adapters[i] == _adapter) {
                adapters[i] = adapters[len - 1];
                adapters.pop();
                break;
            }
        }

        emit AdapterRemoved(_adapter);
    }

    /**
     * @notice Initiate multi-step exit on an adapter
     * @param _adapter Adapter to begin exiting
     */
    function initiateAdapterExit(address _adapter) external onlyOwner validAdapter(_adapter) {
        IStakingAdapter(_adapter).initiateExit();
        emit AdapterExitInitiated(_adapter);
    }

    /**
     * @notice Finalize multi-step exit on an adapter — tokens return to vault
     * @param _adapter Adapter to finalize exit on
     */
    function finalizeAdapterExit(address _adapter) external onlyOwner validAdapter(_adapter) {
        uint256 recovered = IStakingAdapter(_adapter).finalizeExit();
        emit AdapterExitFinalized(_adapter, recovered);
    }

    // ═══════════════════════════════════════════════════════
    //  VaultHub Interactions
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Update totalValue by summing all adapter deposits + idle token balance
     * @dev Permissionless — the hub applies quarantine/freshness checks.
     */
    function updateTotalValue() external {
        uint256 value = IERC20Upgradeable(address(token)).balanceOf(address(this));

        uint256 len = adapters.length;
        for (uint256 i = 0; i < len; i++) {
            value += IStakingAdapter(adapters[i]).getTotalDeposits();
        }

        hub.updateVaultValue(value);

        emit TotalValueUpdated(value);
    }

    /**
     * @notice Force unstake to restore vault health
     * @dev Called by VaultHub during force rebalance. Uses idle tokens first, then
     *      unstakes from adapters that can be unstaked. Initiates unbonding on adapters
     *      that can't unstake yet so they're available on the next rebalance attempt.
     * @param _amount Amount needed for rebalance
     */
    function rebalance(uint256 _amount) external onlyHub {
        if (_amount == 0) revert ZeroAmount();

        uint256 idle = IERC20Upgradeable(address(token)).balanceOf(address(this));
        uint256 remaining = _amount > idle ? _amount - idle : 0;

        if (remaining > 0) {
            // Unstake from adapters, unbond those that can't unstake yet
            uint256 len = adapters.length;
            for (uint256 i = 0; i < len && remaining > 0; i++) {
                IStakingAdapter adapter = IStakingAdapter(adapters[i]);

                uint256 available = adapter.canUnstake();
                if (available == 0) {
                    adapter.unbond();
                    continue;
                }

                uint256 toUnstake = available >= remaining ? remaining : available;
                adapter.unstake(toUnstake);
                remaining -= toUnstake;
            }
        }

        // Transfer recovered tokens to hub
        uint256 recovered = _amount - remaining;
        if (recovered > 0) {
            IERC20Upgradeable(address(token)).safeTransfer(address(hub), recovered);
        }

        emit Rebalanced(recovered);
    }

    // ═══════════════════════════════════════════════════════
    //  Admin
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Start ownership transfer — the new owner must call acceptOwnership()
     * @param _newOwner Address of the proposed new owner
     */
    function transferOwnership(address _newOwner) external onlyOwner {
        if (_newOwner == address(0)) revert ZeroAddress();
        pendingOwner = _newOwner;
        emit OwnershipTransferStarted(owner, _newOwner);
    }

    /**
     * @notice Complete ownership transfer — must be called by the pending owner
     */
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert OnlyPendingOwner();
        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, msg.sender);
    }

    /**
     * @notice Set the operator address
     * @param _operator New operator address
     */
    function setOperator(address _operator) external onlyOwner {
        if (_operator == address(0)) revert ZeroAddress();
        operator = _operator;
        emit OperatorUpdated(_operator);
    }

    /**
     * @notice Set the allocator address
     * @dev Pass address(0) to disable allocator.
     * @param _allocator New allocator address
     */
    function setAllocator(address _allocator) external onlyOwner {
        allocator = _allocator;
        emit AllocatorUpdated(_allocator);
    }

    /**
     * @notice Permanently freeze the vault implementation — cannot be undone
     */
    function ossify() external onlyOwner {
        ossified = true;
        emit Ossified();
    }

    /**
     * @notice Recover ERC20 tokens accidentally sent to the vault
     * @dev Cannot recover the staking token — use withdraw() for that.
     * @param _token Address of the token to recover
     * @param _recipient Address to receive the tokens
     * @param _amount Amount to recover
     */
    function recoverERC20(address _token, address _recipient, uint256 _amount) external onlyOwner {
        if (_token == address(0) || _recipient == address(0)) revert ZeroAddress();
        if (_token == address(token)) revert CannotRecoverStakingToken();
        if (_amount == 0) revert ZeroAmount();

        IERC20Upgradeable(_token).safeTransfer(_recipient, _amount);
        emit ERC20Recovered(_token, _recipient, _amount);
    }

    // ═══════════════════════════════════════════════════════
    //  Internal
    // ═══════════════════════════════════════════════════════

    /// @dev Shared staking logic for operator and allocator paths.
    function _stake(
        address _adapter,
        uint256 _amount,
        bool _viaAllocator
    ) internal validAdapter(_adapter) {
        if (_amount == 0) revert ZeroAmount();
        if (_amount > hub.canStake(address(this))) revert StakeBlockedByHub();

        IStakingAdapter(_adapter).stake(_amount);

        emit Staked(_adapter, _amount, _viaAllocator);
    }

    /// @dev UUPS upgrade authorization — reverts if vault is ossified.
    function _authorizeUpgrade(address) internal override onlyOwner {
        if (ossified) revert VaultOssified();
    }
}
