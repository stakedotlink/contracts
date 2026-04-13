// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "./interfaces/IStakingVault.sol";
import "./interfaces/IStakingVaultFactory.sol";
import "../core/interfaces/IStakingPool.sol";
import "../core/interfaces/IERC677.sol";

/**
 * @title StakingVaultHub
 * @notice Policy and registry layer for staking vaults
 * @dev Enforces risk rules, manages LST minting/burning, computes fees from value growth,
 * and handles bad debt. Does not hold or route staked funds.
 */
contract StakingVaultHub is OwnableUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    uint256 public constant MAX_FEES_PER_VAULT = 5;
    uint16 public constant MAX_TOTAL_FEE_RATE = 4000; // 40% max total fees

    /// @notice Staking asset token
    IERC20Upgradeable public immutable token;
    /// @notice StakingPool (LST token) — for share price lookups and mint/burn
    IStakingPool public immutable stakingPool;
    /// @notice Factory for provenance checks
    IStakingVaultFactory public immutable factory;

    struct Fee {
        address receiver; // address that receives settled fee LST
        uint16 basisPoints; // fee in basis points
    }

    struct VaultConnection {
        uint16 reserveRatio; // min collateral buffer above liability (basis points)
        uint16 forceRebalanceThreshold; // min vault value as % of liability — below this, anyone can force rebalance (basis points)
        uint16 minIdleRatio; // min idle balance as % of total value (basis points)
        uint16 liquidityFeeBP; // fee on rebase benefit received by vault-minted LST (basis points)
        bool requireStakedCollateral; // if true, only staked value counts as collateral for minting
        uint96 shareLimit; // max LST shares this vault can mint
    }

    struct VaultRecord {
        bool isConnected; // whether the vault is registered with the hub
        bool isQuarantined; // true if last value update was suspiciously large
        uint16 totalFeeRate; // cached sum of all fee basis points for this vault
        uint256 liabilityShares; // current LST shares minted against this vault
        uint256 maxLiabilityShares; // peak liability shares in current reporting period (anti-gaming)
        uint256 totalValue; // last reported total value (idle + staked + rewards)
        int256 inOutDelta; // net fund flows (deposits - withdrawals), used to isolate yield from deposits
        int256 lastReportInOutDelta; // inOutDelta snapshot at last report — used to adjust quarantine for fund flows
        uint256 lastUpdateTimestamp; // when totalValue was last updated
        uint256 cumulativeFees; // total fees accrued over lifetime (in token terms)
        uint256 settledFees; // total fees settled over lifetime (in token terms)
        uint256 lastFeeableYield; // cumulative yield already fee'd — prevents double-charging
        uint256 lastFeeSettledTimestamp; // when fees were last settled — used for overdue check
        uint256 lastLiabilityInTokens; // liability in token terms at last report — used to compute rebase benefit
    }

    /// @notice Max allowed % change per value update (basis points) — exceeding quarantines the vault
    uint256 public maxValueChangePercent;
    /// @notice Max seconds before a vault is considered stale
    uint256 public maxStalenessSeconds;
    /// @notice Max seconds fees can remain unsettled before vault operations are blocked
    uint256 public maxFeeOverduePeriod;

    /// @notice Vault policy parameters
    mapping(address => VaultConnection) public connections;
    /// @notice Vault accounting state
    mapping(address => VaultRecord) public vaults;
    /// @notice Per-vault fee configurations
    mapping(address => Fee[]) public vaultFees;
    /// @notice Enumerable list of connected vaults
    address[] public connectedVaults;

    /// @notice Sum of liability shares across all vaults
    uint256 public totalLiabilityShares;
    /// @notice Max total liability shares across all vaults (protects LST yield)
    uint256 public globalShareLimit;
    /// @notice Bad debt internalized as protocol loss
    uint256 public totalBadDebt;

    // --- Events ---

    event VaultConnected(
        address indexed vault,
        uint16 reserveRatio,
        uint16 forceRebalanceThreshold,
        uint16 minIdleRatio,
        uint16 liquidityFeeBP,
        bool requireStakedCollateral,
        uint96 shareLimit
    );
    event VaultDisconnected(address indexed vault);
    event VaultConnectionUpdated(
        address indexed vault,
        uint16 reserveRatio,
        uint16 forceRebalanceThreshold,
        uint16 minIdleRatio,
        uint16 liquidityFeeBP,
        bool requireStakedCollateral,
        uint96 shareLimit
    );
    event VaultFeesUpdated(address indexed vault);
    event VaultValueUpdated(address indexed vault, uint256 oldValue, uint256 newValue);
    event VaultQuarantined(address indexed vault, uint256 reportedValue, uint256 previousValue);
    event VaultUnquarantined(address indexed vault);
    event LSTMinted(
        address indexed vault,
        address indexed recipient,
        uint256 amount,
        uint256 shares
    );
    event LSTBurned(address indexed vault, uint256 amount, uint256 shares);
    event ForceRebalanced(address indexed vault, uint256 amount, uint256 sharesBurned);
    event YieldFeeAccrued(address indexed vault, uint256 amount);
    event LiquidityFeeAccrued(address indexed vault, uint256 amount);
    event FeeSettled(address indexed vault, uint256 amount);
    event BadDebtInternalized(address indexed vault, uint256 amount);
    event InOutDeltaUpdated(address indexed vault, int256 delta);

    // --- Errors ---

    error VaultNotConnected();
    error VaultAlreadyConnected();
    error VaultNotFromFactory();
    error VaultHasLiability();
    error VaultIsQuarantined();
    error VaultNotQuarantined();
    error VaultStale();
    error VaultHealthy();
    error InsufficientCollateral();
    error ShareLimitExceeded();
    error GlobalShareLimitExceeded();
    error OnlyVaultOwner();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidParameter();
    error NoFeesSettled();
    error VaultNotInsolvent();
    error UnsettledFeesRemaining();
    error FeesOverdue();
    error TooManyFees();
    error FeeRateTooHigh();

    /**
     * @notice Sets immutable references shared across all proxy instances
     * @param _token Staking asset token address
     * @param _stakingPool LST token / staking pool address
     * @param _factory Vault factory address
     */
    constructor(address _token, address _stakingPool, address _factory) {
        if (_token == address(0) || _stakingPool == address(0) || _factory == address(0)) {
            revert ZeroAddress();
        }
        token = IERC20Upgradeable(_token);
        stakingPool = IStakingPool(_stakingPool);
        factory = IStakingVaultFactory(_factory);
        _disableInitializers();
    }

    /**
     * @notice Initializes the hub
     * @param _maxValueChangePercent Quarantine threshold in basis points
     * @param _maxStalenessSeconds Max seconds before vault is stale
     * @param _maxFeeOverduePeriod Max seconds before fees are considered overdue
     * @param _globalShareLimit Max total LST shares across all vaults
     */
    function initialize(
        uint256 _maxValueChangePercent,
        uint256 _maxStalenessSeconds,
        uint256 _maxFeeOverduePeriod,
        uint256 _globalShareLimit
    ) external initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();

        maxValueChangePercent = _maxValueChangePercent;
        maxStalenessSeconds = _maxStalenessSeconds;
        maxFeeOverduePeriod = _maxFeeOverduePeriod;
        globalShareLimit = _globalShareLimit;

        token.safeApprove(address(stakingPool), type(uint256).max);
    }

    // ═══════════════════════════════════════════════════════
    //  Vault Lifecycle
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Register a vault with the hub
     * @param _vault Vault address (must be factory-deployed and initialized)
     * @param _reserveRatio Reserve ratio in basis points
     * @param _forceRebalanceThreshold Health floor in basis points
     * @param _minIdleRatio Min idle balance as % of total value in basis points
     * @param _liquidityFeeBP Liquidity fee on rebase benefit in basis points
     * @param _requireStakedCollateral If true, only staked value counts as collateral for minting
     * @param _shareLimit Max LST shares this vault can mint
     * @param _fees Array of fee configurations (receiver + basis points)
     */
    function connectVault(
        address _vault,
        uint16 _reserveRatio,
        uint16 _forceRebalanceThreshold,
        uint16 _minIdleRatio,
        uint16 _liquidityFeeBP,
        bool _requireStakedCollateral,
        uint96 _shareLimit,
        Fee[] calldata _fees
    ) external onlyOwner {
        if (vaults[_vault].isConnected) revert VaultAlreadyConnected();
        if (!factory.deployedVaults(_vault)) revert VaultNotFromFactory();
        if (_forceRebalanceThreshold == 0) revert InvalidParameter();

        connections[_vault] = VaultConnection({
            reserveRatio: _reserveRatio,
            forceRebalanceThreshold: _forceRebalanceThreshold,
            minIdleRatio: _minIdleRatio,
            liquidityFeeBP: _liquidityFeeBP,
            requireStakedCollateral: _requireStakedCollateral,
            shareLimit: _shareLimit
        });

        vaults[_vault].isConnected = true;
        vaults[_vault].lastFeeSettledTimestamp = block.timestamp;

        _setVaultFees(_vault, _fees);
        connectedVaults.push(_vault);

        emit VaultConnected(
            _vault,
            _reserveRatio,
            _forceRebalanceThreshold,
            _minIdleRatio,
            _liquidityFeeBP,
            _requireStakedCollateral,
            _shareLimit
        );
    }

    /**
     * @notice Update a vault's connection parameters
     * @dev Requires a fresh report. Cannot reduce share limit below current liability.
     * @param _vault Vault to update
     * @param _reserveRatio New reserve ratio in basis points
     * @param _forceRebalanceThreshold New health floor in basis points
     * @param _minIdleRatio New min idle ratio in basis points
     * @param _liquidityFeeBP New liquidity fee on rebase benefit in basis points
     * @param _requireStakedCollateral If true, only staked value counts as collateral
     * @param _shareLimit New share limit
     */
    function updateConnection(
        address _vault,
        uint16 _reserveRatio,
        uint16 _forceRebalanceThreshold,
        uint16 _minIdleRatio,
        uint16 _liquidityFeeBP,
        bool _requireStakedCollateral,
        uint96 _shareLimit
    ) external onlyOwner {
        VaultRecord storage record = _getRecord(_vault);
        _requireFresh(record);

        if (_forceRebalanceThreshold == 0) revert InvalidParameter();
        if (_shareLimit < record.liabilityShares) revert ShareLimitExceeded();

        connections[_vault] = VaultConnection({
            reserveRatio: _reserveRatio,
            forceRebalanceThreshold: _forceRebalanceThreshold,
            minIdleRatio: _minIdleRatio,
            liquidityFeeBP: _liquidityFeeBP,
            requireStakedCollateral: _requireStakedCollateral,
            shareLimit: _shareLimit
        });

        emit VaultConnectionUpdated(
            _vault,
            _reserveRatio,
            _forceRebalanceThreshold,
            _minIdleRatio,
            _liquidityFeeBP,
            _requireStakedCollateral,
            _shareLimit
        );
    }

    /**
     * @notice Update a vault's fee configurations
     * @param _vault Vault to update fees for
     * @param _fees New fee configurations
     */
    function updateVaultFees(address _vault, Fee[] calldata _fees) external onlyOwner {
        if (!vaults[_vault].isConnected) revert VaultNotConnected();
        _setVaultFees(_vault, _fees);
    }

    /**
     * @notice Disconnect a vault from the hub
     * @dev Requires zero liability. Can optionally waive unsettled fees.
     *      Use after internalizeBadDebt if vault is insolvent.
     * @param _vault Vault to disconnect
     * @param _waiveUnsettledFees If true, write off any unsettled fees
     */
    function disconnectVault(address _vault, bool _waiveUnsettledFees) external onlyOwner {
        VaultRecord storage record = _getRecord(_vault);

        if (record.liabilityShares != 0) revert VaultHasLiability();
        if (!_waiveUnsettledFees && record.cumulativeFees > record.settledFees) {
            revert UnsettledFeesRemaining();
        }

        delete vaults[_vault];
        delete connections[_vault];
        delete vaultFees[_vault];

        uint256 len = connectedVaults.length;
        for (uint256 i = 0; i < len; i++) {
            if (connectedVaults[i] == _vault) {
                connectedVaults[i] = connectedVaults[len - 1];
                connectedVaults.pop();
                break;
            }
        }

        emit VaultDisconnected(_vault);
    }

    /**
     * @notice Check if a vault is connected to the hub
     * @param _vault Vault address
     * @return True if connected
     */
    function isConnected(address _vault) external view returns (bool) {
        return vaults[_vault].isConnected;
    }

    /**
     * @notice Get the number of connected vaults
     * @return Count of connected vaults
     */
    function connectedVaultCount() external view returns (uint256) {
        return connectedVaults.length;
    }

    /**
     * @notice Get the fee configurations for a vault
     * @param _vault Vault address
     * @return Array of fee configurations
     */
    function feesFor(address _vault) external view returns (Fee[] memory) {
        return vaultFees[_vault];
    }

    // ═══════════════════════════════════════════════════════
    //  LST Operations
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Mint LST against vault collateral
     * @dev Called by vault owner directly. Collateral check uses staked value or total value
     *      depending on the vault's requireStakedCollateral setting.
     * @param _vault Vault to mint against
     * @param _recipient Address to receive the minted LST
     * @param _amount Amount of LST to mint (in token terms)
     */
    function mintLST(address _vault, address _recipient, uint256 _amount) external {
        if (_amount == 0) revert ZeroAmount();
        if (_recipient == address(0)) revert ZeroAddress();

        VaultRecord storage record = _getRecord(_vault);
        VaultConnection storage conn = connections[_vault];

        if (msg.sender != IStakingVault(_vault).owner()) revert OnlyVaultOwner();

        _requireNotQuarantined(record);
        _requireFresh(record);
        _requireFeesNotOverdue(record);

        uint256 shares = stakingPool.getSharesByStake(_amount);
        uint256 newLiabilityShares = record.liabilityShares + shares;

        // Check per-vault and global share limits
        if (newLiabilityShares > conn.shareLimit) revert ShareLimitExceeded();
        if (totalLiabilityShares + shares > globalShareLimit) revert GlobalShareLimitExceeded();

        // Check collateral
        uint256 collateral = conn.requireStakedCollateral
            ? IStakingVault(_vault).stakedBalance()
            : record.totalValue;
        uint256 newLiability = stakingPool.getStakeByShares(newLiabilityShares);
        uint256 requiredCollateral = (newLiability * (10000 + conn.reserveRatio)) / 10000;
        if (collateral < requiredCollateral) revert InsufficientCollateral();

        record.liabilityShares = newLiabilityShares;
        totalLiabilityShares += shares;

        if (newLiabilityShares > record.maxLiabilityShares) {
            record.maxLiabilityShares = newLiabilityShares;
        }

        record.lastLiabilityInTokens = newLiability;

        stakingPool.mintForVault(_recipient, _amount);

        emit LSTMinted(_vault, _recipient, _amount, shares);
    }

    /**
     * @notice Burn LST to reduce vault liability
     * @dev Called by vault owner directly. Pass type(uint256).max to burn all
     *      liability and avoid rounding dust.
     * @param _vault Vault to burn against
     * @param _amount Amount of LST to burn (in token terms), or type(uint256).max to burn all
     */
    function burnLST(address _vault, uint256 _amount) external {
        if (_amount == 0) revert ZeroAmount();
        VaultRecord storage record = _getRecord(_vault);
        if (msg.sender != IStakingVault(_vault).owner()) revert OnlyVaultOwner();

        uint256 shares;
        if (_amount == type(uint256).max) {
            // Burn all liability — avoids rounding dust
            shares = record.liabilityShares;
            _amount = stakingPool.getStakeByShares(shares);
        } else {
            shares = stakingPool.getSharesByStake(_amount);
        }

        record.liabilityShares -= shares;
        totalLiabilityShares -= shares;

        // Update liability snapshot for liquidity fee tracking
        record.lastLiabilityInTokens = _getLiability(record);

        stakingPool.burnForVault(msg.sender, _amount);

        emit LSTBurned(_vault, _amount, shares);
    }

    /**
     * @notice Get the remaining minting capacity for a vault in token terms
     * @param _vault Vault address
     * @return Remaining tokens the vault can mint (0 if blocked)
     */
    function mintingCapacity(address _vault) external view returns (uint256) {
        VaultRecord storage record = vaults[_vault];
        if (!record.isConnected) return 0;

        uint256 perVaultRemaining = connections[_vault].shareLimit > record.liabilityShares
            ? connections[_vault].shareLimit - record.liabilityShares
            : 0;
        uint256 globalRemaining = globalShareLimit > totalLiabilityShares
            ? globalShareLimit - totalLiabilityShares
            : 0;

        uint256 remainingShares = perVaultRemaining < globalRemaining
            ? perVaultRemaining
            : globalRemaining;

        return stakingPool.getStakeByShares(remainingShares);
    }

    /**
     * @notice Get a vault's liability in token terms
     * @param _vault Vault address
     * @return Liability amount in token terms
     */
    function liability(address _vault) external view returns (uint256) {
        VaultRecord storage record = vaults[_vault];
        return _getLiability(record);
    }

    /**
     * @notice Get the amount of tokens locked as collateral (includes unsettled fees)
     * @dev Uses maxLiabilityShares (high-water mark) for the locked calculation to prevent
     *      mint-burn-mint gaming within a single reporting period.
     * @param _vault Vault address
     * @return Locked amount in token terms
     */
    function lockedAmount(address _vault) public view returns (uint256) {
        VaultRecord storage record = vaults[_vault];
        if (!record.isConnected) return 0;

        uint256 locked = record.cumulativeFees - record.settledFees;

        if (record.maxLiabilityShares > 0) {
            uint256 maxLiabilityInTokens = stakingPool.getStakeByShares(record.maxLiabilityShares);
            locked += (maxLiabilityInTokens * (10000 + connections[_vault].reserveRatio)) / 10000;
        }

        return locked;
    }

    // ═══════════════════════════════════════════════════════
    //  Value Reporting & Fund Tracking
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Update a vault's reported total value
     * @dev Called by the vault itself. Applies quarantine check, fee-on-yield calculation
     *      using inOutDelta, and liquidity fee on rebase benefit. Resets maxLiabilityShares
     *      and lastReportInOutDelta on each fresh report.
     * @param _value New total value
     */
    function updateVaultValue(uint256 _value) external {
        address vault = msg.sender;
        VaultRecord storage record = _getRecord(vault);

        uint256 oldValue = record.totalValue;

        // Quarantine check — checks for suspiciously large yield
        if (oldValue > 0) {
            int256 fundFlows = record.inOutDelta - record.lastReportInOutDelta;
            uint256 expectedValue = fundFlows >= 0
                ? oldValue + uint256(fundFlows)
                : oldValue - uint256(-fundFlows);
            if (_value > expectedValue) {
                uint256 increase = _value - expectedValue;
                if ((increase * 10000) / oldValue > maxValueChangePercent) {
                    record.isQuarantined = true;
                    record.lastUpdateTimestamp = 0;
                    emit VaultQuarantined(vault, _value, oldValue);
                    return;
                }
            }
        }

        _accrueYieldFee(vault, record, _value);
        _accrueLiquidityFee(vault, record, connections[vault]);

        record.totalValue = _value;
        record.lastUpdateTimestamp = block.timestamp;
        record.maxLiabilityShares = record.liabilityShares;
        record.lastReportInOutDelta = record.inOutDelta;

        emit VaultValueUpdated(vault, oldValue, _value);
    }

    /// @dev Accrue fee on yield growth (value increase beyond net deposits).
    function _accrueYieldFee(address _vault, VaultRecord storage _record, uint256 _value) internal {
        if (_record.totalFeeRate == 0) return;

        int256 currentYield = int256(_value) - _record.inOutDelta;
        if (currentYield <= 0 || uint256(currentYield) <= _record.lastFeeableYield) return;

        uint256 newYield = uint256(currentYield) - _record.lastFeeableYield;
        uint256 fee = (newYield * _record.totalFeeRate) / 10000;
        if (fee > 0) {
            _record.cumulativeFees += fee;
            emit YieldFeeAccrued(_vault, fee);
        }
        _record.lastFeeableYield = uint256(currentYield);
    }

    /// @dev Accrue liquidity fee on rebase benefit received by vault-minted LST.
    function _accrueLiquidityFee(
        address _vault,
        VaultRecord storage _record,
        VaultConnection storage _conn
    ) internal {
        if (_conn.liquidityFeeBP == 0 || _record.liabilityShares == 0) return;

        uint256 currentLiability = _getLiability(_record);
        if (currentLiability > _record.lastLiabilityInTokens) {
            uint256 rebaseBenefit = currentLiability - _record.lastLiabilityInTokens;
            uint256 fee = (rebaseBenefit * _conn.liquidityFeeBP) / 10000;
            if (fee > 0) {
                _record.cumulativeFees += fee;
                emit LiquidityFeeAccrued(_vault, fee);
            }
        }
        _record.lastLiabilityInTokens = currentLiability;
    }

    /**
     * @notice Record a deposit into the vault
     * @dev Called by the vault when tokens are deposited. Increases inOutDelta.
     * @param _amount Amount deposited
     */
    function recordDeposit(uint256 _amount) external {
        address vault = msg.sender;
        VaultRecord storage record = vaults[vault];
        if (!record.isConnected) return;

        record.inOutDelta += int256(_amount);
        emit InOutDeltaUpdated(vault, record.inOutDelta);
    }

    /**
     * @notice Record a withdrawal from the vault
     * @dev Called by the vault when tokens are withdrawn. Decreases inOutDelta.
     * @param _amount Amount withdrawn
     */
    function recordWithdrawal(uint256 _amount) external {
        address vault = msg.sender;
        VaultRecord storage record = vaults[vault];
        if (!record.isConnected) return;

        record.inOutDelta -= int256(_amount);
        emit InOutDeltaUpdated(vault, record.inOutDelta);
    }

    /**
     * @notice Manually unquarantine a vault after investigation
     * @dev Sets totalValue as a quarantine baseline but does NOT update lastUpdateTimestamp.
     *      The vault remains stale (operations blocked) until the next updateTotalValue()
     *      passes the quarantine check against this baseline.
     * @param _vault Vault to unquarantine
     * @param _value Verified total value to use as quarantine baseline
     */
    function unquarantine(address _vault, uint256 _value) external onlyOwner {
        VaultRecord storage record = _getRecord(_vault);
        if (!record.isQuarantined) revert VaultNotQuarantined();

        record.isQuarantined = false;
        record.totalValue = _value;
        record.lastReportInOutDelta = record.inOutDelta;

        emit VaultUnquarantined(_vault);
    }

    /**
     * @notice Check if a vault's value report is fresh
     * @param _vault Vault address
     * @return True if fresh
     */
    function isFresh(address _vault) external view returns (bool) {
        VaultRecord storage record = vaults[_vault];
        if (!record.isConnected) return true;
        return _isFresh(record);
    }

    /**
     * @notice Check if a vault is healthy (above force rebalance threshold)
     * @param _vault Vault address
     * @return True if healthy
     */
    function isHealthy(address _vault) external view returns (bool) {
        VaultRecord storage record = vaults[_vault];
        if (!record.isConnected) return true;
        return _isHealthy(record, connections[_vault]);
    }

    /**
     * @notice Check if a vault is quarantined
     * @param _vault Vault address
     * @return True if quarantined
     */
    function isQuarantined(address _vault) external view returns (bool) {
        return vaults[_vault].isQuarantined;
    }

    /**
     * @notice Get the maximum amount the vault can stake (respects health, fees, and idle reserve)
     * @param _vault Vault address
     * @return Maximum stakeable amount (0 if staking is blocked)
     */
    function canStake(address _vault) external view returns (uint256) {
        VaultRecord storage record = vaults[_vault];
        VaultConnection storage conn = connections[_vault];
        if (!record.isConnected) return type(uint256).max;
        if (record.isQuarantined) return 0;
        if (!_isHealthy(record, conn)) return 0;
        if (_isFeesOverdue(record)) return 0;

        uint256 idle = IStakingVault(_vault).idleBalance();
        if (conn.minIdleRatio == 0) return idle;

        uint256 minIdle = (record.totalValue * conn.minIdleRatio) / 10000;
        return idle > minIdle ? idle - minIdle : 0;
    }

    /**
     * @notice Get the maximum amount the vault can withdraw (respects health, freshness, quarantine, fees, and locked amount)
     * @param _vault Vault address
     * @return Maximum withdrawable amount (0 if withdrawals are blocked)
     */
    function canWithdraw(address _vault) external view returns (uint256) {
        VaultRecord storage record = vaults[_vault];
        if (!record.isConnected) return type(uint256).max;
        if (record.isQuarantined) return 0;
        if (!_isHealthy(record, connections[_vault])) return 0;
        if (!_isFresh(record)) return 0;
        if (_isFeesOverdue(record)) return 0;

        uint256 locked = lockedAmount(_vault);
        uint256 unlocked = record.totalValue > locked ? record.totalValue - locked : 0;
        uint256 idle = IStakingVault(_vault).idleBalance();
        return idle < unlocked ? idle : unlocked;
    }

    // ═══════════════════════════════════════════════════════
    //  Fee Settlement
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Settle outstanding protocol fees for one or more vaults
     * @dev Permissionless. Pulls tokens from each vault's idle balance, mints LST once,
     *      then distributes to unique receivers aggregated across all vaults.
     * @param _vaults Array of vaults to settle fees for
     */
    function settleFees(address[] calldata _vaults) external {
        address[] memory receivers = new address[](_vaults.length * MAX_FEES_PER_VAULT);
        uint256[] memory amounts = new uint256[](receivers.length);
        uint256 receiverCount;
        uint256 totalSettled;

        for (uint256 v = 0; v < _vaults.length; v++) {
            VaultRecord storage record = _getRecord(_vaults[v]);

            uint256 unsettled = record.cumulativeFees - record.settledFees;
            if (unsettled == 0) continue;

            uint256 idle = IStakingVault(_vaults[v]).idleBalance();
            if (idle == 0) continue;
            uint256 toSettle = idle > unsettled ? unsettled : idle;

            record.settledFees += toSettle;
            // Only reset overdue timer on full settlement
            if (record.settledFees == record.cumulativeFees) {
                record.lastFeeSettledTimestamp = block.timestamp;
            }
            token.safeTransferFrom(_vaults[v], address(this), toSettle);
            totalSettled += toSettle;

            // Aggregate amounts per unique receiver
            Fee[] storage fees = vaultFees[_vaults[v]];
            for (uint256 f = 0; f < fees.length; f++) {
                uint256 share = (toSettle * fees[f].basisPoints) / record.totalFeeRate;
                if (share == 0) continue;

                bool found;
                for (uint256 r = 0; r < receiverCount; r++) {
                    if (receivers[r] == fees[f].receiver) {
                        amounts[r] += share;
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    receivers[receiverCount] = fees[f].receiver;
                    amounts[receiverCount] = share;
                    receiverCount++;
                }
            }

            emit FeeSettled(_vaults[v], toSettle);
        }

        if (totalSettled == 0) revert NoFeesSettled();

        // Mint LST once, distribute to each unique receiver
        stakingPool.mintWithDeposit(address(this), totalSettled);
        for (uint256 r = 0; r < receiverCount; r++) {
            // Last receiver gets remaining balance to absorb rounding dust
            uint256 share = r == receiverCount - 1
                ? IERC20Upgradeable(address(stakingPool)).balanceOf(address(this))
                : amounts[r];
            if (share > 0) {
                IERC677(address(stakingPool)).transferAndCall(receivers[r], share, "");
            }
        }
    }

    /**
     * @notice Get the unsettled fee amount for a vault
     * @param _vault Vault address
     * @return Unsettled fees in token terms
     */
    function unsettledFees(address _vault) external view returns (uint256) {
        VaultRecord storage record = vaults[_vault];
        return record.cumulativeFees - record.settledFees;
    }

    /**
     * @notice Get the amount of fees that can be settled right now for a vault
     * @param _vault Vault address
     * @return Settleable amount (min of unsettled fees and idle balance)
     */
    function settleableFees(address _vault) external view returns (uint256) {
        VaultRecord storage record = vaults[_vault];
        if (!record.isConnected) return 0;

        uint256 unsettled = record.cumulativeFees - record.settledFees;
        if (unsettled == 0) return 0;

        uint256 idle = IStakingVault(_vault).idleBalance();
        return idle < unsettled ? idle : unsettled;
    }

    /**
     * @notice Check if a vault's fees are overdue
     * @param _vault Vault address
     * @return True if fees are overdue
     */
    function isFeesOverdue(address _vault) external view returns (bool) {
        return _isFeesOverdue(vaults[_vault]);
    }

    /**
     * @notice Get the minimum idle balance required for a vault
     * @param _vault Vault address
     * @return Required idle balance in token terms
     */
    function minIdleBalance(address _vault) external view returns (uint256) {
        VaultRecord storage record = vaults[_vault];
        VaultConnection storage conn = connections[_vault];
        if (!record.isConnected || conn.minIdleRatio == 0) return 0;
        return (record.totalValue * conn.minIdleRatio) / 10000;
    }

    // ═══════════════════════════════════════════════════════
    //  Force Rebalance & Bad Debt
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Force rebalance an unhealthy vault
     * @dev Permissionless. Triggers vault.rebalance() to unstake tokens, then donates them
     *      to the staking pool while reducing the vault's LST liability. Adapters that
     *      can't unstake are automatically unbonded for the next attempt.
     * @param _vault Vault to rebalance
     */
    function forceRebalance(address _vault) external {
        VaultRecord storage record = _getRecord(_vault);
        VaultConnection storage conn = connections[_vault];

        _requireFresh(record);

        uint256 liabilityInTokens = _getLiability(record);
        uint256 requiredValue = (liabilityInTokens * (10000 + conn.reserveRatio)) / 10000;
        if (record.totalValue >= requiredValue) revert VaultHealthy();

        uint256 deficit = requiredValue - record.totalValue;

        // Vault unstakes and transfers recovered tokens to hub
        uint256 balBefore = token.balanceOf(address(this));
        IStakingVault(_vault).rebalance(deficit);
        uint256 received = token.balanceOf(address(this)) - balBefore;

        uint256 sharesBurned;
        if (received > 0) {
            sharesBurned = stakingPool.getSharesByStake(received);
            record.liabilityShares -= sharesBurned;
            totalLiabilityShares -= sharesBurned;

            // Donate tokens to pool — improves LST backing for all holders
            stakingPool.donateTokens(received);

            // Update liquidity fee snapshot
            record.lastLiabilityInTokens = _getLiability(record);
        }

        emit ForceRebalanced(_vault, received, sharesBurned);
    }

    /**
     * @notice Internalize bad debt from an insolvent vault as a protocol loss
     * @dev Called when a vault's total value is less than its liability and force rebalance
     *      cannot recover enough. The shortfall becomes protocol loss.
     * @param _vault Vault with bad debt
     * @param _maxAmount Max token amount to internalize (prevents accidentally writing off more than intended)
     */
    function internalizeBadDebt(address _vault, uint256 _maxAmount) external onlyOwner {
        VaultRecord storage record = _getRecord(_vault);
        _requireFresh(record);

        uint256 liabilityInTokens = _getLiability(record);
        if (record.totalValue >= liabilityInTokens) revert VaultNotInsolvent();

        uint256 shortfall = liabilityInTokens - record.totalValue;
        if (shortfall > _maxAmount) shortfall = _maxAmount;

        uint256 sharesToWriteOff = stakingPool.getSharesByStake(shortfall);
        record.liabilityShares -= sharesToWriteOff;
        totalLiabilityShares -= sharesToWriteOff;
        totalBadDebt += shortfall;

        // Reduce pool's totalStaked to reflect the loss (negative rebase for all LST holders)
        stakingPool.writeDown(shortfall);

        // Reset fee tracking — bad debt write-off changes the effective baseline
        record.inOutDelta = int256(record.totalValue);
        record.lastFeeableYield = 0;
        record.lastLiabilityInTokens = _getLiability(record);

        emit BadDebtInternalized(_vault, shortfall);
    }

    // ═══════════════════════════════════════════════════════
    //  Admin
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Update quarantine threshold
     * @param _maxValueChangePercent New threshold in basis points
     */
    function setMaxValueChangePercent(uint256 _maxValueChangePercent) external onlyOwner {
        maxValueChangePercent = _maxValueChangePercent;
    }

    /**
     * @notice Update staleness threshold
     * @param _maxStalenessSeconds New threshold in seconds
     */
    function setMaxStalenessSeconds(uint256 _maxStalenessSeconds) external onlyOwner {
        maxStalenessSeconds = _maxStalenessSeconds;
    }

    /**
     * @notice Update fee overdue threshold
     * @param _maxFeeOverduePeriod New threshold in seconds (0 to disable)
     */
    function setMaxFeeOverduePeriod(uint256 _maxFeeOverduePeriod) external onlyOwner {
        maxFeeOverduePeriod = _maxFeeOverduePeriod;
    }

    /**
     * @notice Update the global share limit across all vaults
     * @param _globalShareLimit New global share limit
     */
    function setGlobalShareLimit(uint256 _globalShareLimit) external onlyOwner {
        globalShareLimit = _globalShareLimit;
    }

    // ═══════════════════════════════════════════════════════
    //  Internal
    // ═══════════════════════════════════════════════════════

    /// @dev Returns the vault record, reverting if not connected.
    function _getRecord(address _vault) internal view returns (VaultRecord storage) {
        VaultRecord storage record = vaults[_vault];
        if (!record.isConnected) revert VaultNotConnected();
        return record;
    }

    /// @dev Converts a vault's liability shares to token terms via the staking pool share price.
    function _getLiability(VaultRecord storage _record) internal view returns (uint256) {
        if (_record.liabilityShares == 0) return 0;
        return stakingPool.getStakeByShares(_record.liabilityShares);
    }

    /// @dev Returns true if the vault's value report is within the staleness window.
    function _isFresh(VaultRecord storage _record) internal view returns (bool) {
        return block.timestamp - _record.lastUpdateTimestamp <= maxStalenessSeconds;
    }

    /// @dev Returns true if the vault's value is above the force rebalance threshold.
    function _isHealthy(
        VaultRecord storage _record,
        VaultConnection storage _conn
    ) internal view returns (bool) {
        if (_record.liabilityShares == 0) return true;

        uint256 liabilityInTokens = stakingPool.getStakeByShares(_record.liabilityShares);
        if (liabilityInTokens == 0) return true;

        uint256 health = (_record.totalValue * 10000) / liabilityInTokens;
        return health >= _conn.forceRebalanceThreshold;
    }

    /// @dev Reverts if the vault's value report is stale.
    function _requireFresh(VaultRecord storage _record) internal view {
        if (!_isFresh(_record)) revert VaultStale();
    }

    /// @dev Reverts if the vault is quarantined.
    function _requireNotQuarantined(VaultRecord storage _record) internal view {
        if (_record.isQuarantined) revert VaultIsQuarantined();
    }

    /// @dev Returns true if the vault has unsettled fees past the overdue threshold.
    function _isFeesOverdue(VaultRecord storage _record) internal view returns (bool) {
        if (_record.cumulativeFees <= _record.settledFees) return false;
        if (maxFeeOverduePeriod == 0) return false;
        return block.timestamp - _record.lastFeeSettledTimestamp > maxFeeOverduePeriod;
    }

    /// @dev Reverts if the vault's fees are overdue.
    function _requireFeesNotOverdue(VaultRecord storage _record) internal view {
        if (_isFeesOverdue(_record)) revert FeesOverdue();
    }

    /// @dev Validates and stores fee configurations for a vault.
    function _setVaultFees(address _vault, Fee[] calldata _fees) internal {
        if (_fees.length > MAX_FEES_PER_VAULT) revert TooManyFees();
        delete vaultFees[_vault];
        uint16 total;
        for (uint256 i = 0; i < _fees.length; i++) {
            if (_fees[i].receiver == address(0)) revert ZeroAddress();
            if (_fees[i].basisPoints == 0) revert InvalidParameter();
            total += _fees[i].basisPoints;
            vaultFees[_vault].push(_fees[i]);
        }
        if (total > MAX_TOTAL_FEE_RATE) revert FeeRateTooHigh();
        vaults[_vault].totalFeeRate = total;
        emit VaultFeesUpdated(_vault);
    }

    /// @dev UUPS upgrade authorization.
    function _authorizeUpgrade(address) internal override onlyOwner {}
}
