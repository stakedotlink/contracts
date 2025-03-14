// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../core/base/Strategy.sol";
import "../core/interfaces/IRewardsPool.sol";
import "./interfaces/IPolygonVault.sol";
import "./interfaces/IPolygonStakeManager.sol";

/**
 * @title Polygon Strategy
 * @notice Strategy for managing multiple Polygon staking vaults
 */
contract PolygonStrategy is Strategy {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct Validator {
        // address of validator shares pool
        address pool;
        // address to receive validator share of MEV rewards
        address rewardsReceiver;
        // index of next empty vault
        uint256 depositIndex;
    }

    struct ValidatorRemoval {
        // whether a validator is queued for removal
        bool isActive;
        // id of validator
        uint64 validatorId;
        // total queued withdrawals for validator
        uint128 queuedWithdrawals;
    }

    struct Fee {
        // address to recieve fee
        address receiver;
        // value of fee in basis points
        uint256 basisPoints;
    }

    // list of fees that are paid on rewards
    Fee[] private fees;

    // address of polygon stake manager
    address public stakeManager;
    // address of fund flow controller
    address public fundFlowController;

    // address of MEV rewards pool
    IRewardsPool public validatorMEVRewardsPool;
    // percentage of MEV rewards validators will receive
    uint256 public validatorMEVRewardsPercentage;

    // list of validators
    Validator[] private validators;
    // list of vaults grouped by validator
    IPolygonVault[][] private vaults;
    // address of vault implementation contract to be used when deploying new vaults
    address public vaultImplementation;
    // number of vaults to deploy per validator
    uint256 public vaultsPerValidator;

    // queued validator removal state
    ValidatorRemoval public validatorRemoval;

    // total number of tokens staked in this strategy
    uint256 private totalDeposits;
    // total number of tokens queued for deposit into vaults
    uint256 public totalQueued;
    // total number of vaults currently unbonding
    uint256 public numVaultsUnbonding;
    // index of validator to withdraw from on next withdrawal
    uint256 public validatorWithdrawalIndex;

    event DepositQueuedTokens();
    event Unbond(uint256 amount);
    event UnstakeClaim(uint256 amount);
    event RestakeRewards();
    event AddValidator(address indexed pool, address rewardsReceiver);
    event QueueValidatorRemoval(address indexed pool, address rewardsReceiver);
    event FinalizeValidatorRemoval(address indexed pool, address rewardsReceiver);
    event UpgradedVaults();
    event AddFee(address receiver, uint256 feeBasisPoints);
    event UpdateFee(uint256 index, address receiver, uint256 feeBasisPoints);
    event SetValidatorMEVRewardsPercentage(uint256 validatorMEVRewardsPercentage);
    event SetVaultImplementation(address vaultImplementation);

    error FeesTooLarge();
    error SenderNotAuthorized();
    error UnbondingInProgress();
    error MustWithdrawAllVaults();
    error ValidatorAlreadyAdded();
    error RemovalAlreadyQueued();
    error NoRemovalQueued();
    error InvalidVaultIds();
    error InvalidAmount();
    error NoVaultsUnbonding();

    /**
     * @notice Initializes contract
     * @param _token address of POL token
     * @param _stakingPool address of the staking pool that controls this strategy
     * @param _stakeManager address of the Polygon stake manager
     * @param _vaultImplementation address of the implementation contract to use when deploying new vaults
     * @param _vaultsPerValidator number of vaults to deploy per validator
     * @param _validatorMEVRewardsPercentage basis point amount of MEV fees that validators will receive
     * @param _fees list of fees to be paid on rewards
     **/
    function initialize(
        address _token,
        address _stakingPool,
        address _stakeManager,
        address _vaultImplementation,
        uint256 _vaultsPerValidator,
        uint256 _validatorMEVRewardsPercentage,
        Fee[] memory _fees
    ) public initializer {
        __Strategy_init(_token, _stakingPool);

        stakeManager = _stakeManager;
        vaultImplementation = _vaultImplementation;
        vaultsPerValidator = _vaultsPerValidator;
        validatorMEVRewardsPercentage = _validatorMEVRewardsPercentage;

        for (uint256 i = 0; i < _fees.length; ++i) {
            fees.push(_fees[i]);
        }
        if (_totalFeesBasisPoints() > 3000) revert FeesTooLarge();
    }

    /**
     * @notice Reverts if sender is not fund flow controller
     */
    modifier onlyFundFlowController() {
        if (msg.sender != fundFlowController) revert SenderNotAuthorized();
        _;
    }

    /**
     * @notice Returns a list of all validators
     * @return list of validators
     */
    function getValidators() external view returns (Validator[] memory) {
        return validators;
    }

    /**
     * @notice Returns a list of all vaults controlled by this contract grouped by validator
     * @return list of vault addresses
     */
    function getVaults() external view returns (IPolygonVault[][] memory) {
        return vaults;
    }

    /**
     * @notice Deposits tokens from the staking pool into this strategy
     * @param _amount amount to deposit
     */
    function deposit(uint256 _amount, bytes calldata) external onlyStakingPool {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        totalDeposits += _amount;
        totalQueued += _amount;
    }

    /**
     * @notice Withdraws tokens from this strategy and sends them to staking pool
     * @param _amount amount to withdraw
     */
    function withdraw(uint256 _amount, bytes calldata) external onlyStakingPool {
        token.safeTransfer(msg.sender, _amount);
        totalDeposits -= _amount;
        totalQueued -= _amount;
    }

    /**
     * @notice Deposits queued tokens into vaults
     * @param _vaultIds list of vaults to deposit into
     * @param _amounts list of amounts to deposit into each vault
     */
    function depositQueuedTokens(
        uint256[][] calldata _vaultIds,
        uint256[][] calldata _amounts
    ) external onlyFundFlowController {
        if (_vaultIds.length != vaults.length) revert InvalidVaultIds();
        if (
            validatorRemoval.isActive &&
            _vaultIds.length > validatorRemoval.validatorId &&
            _vaultIds[validatorRemoval.validatorId].length != 0
        ) revert InvalidVaultIds();
        if (numVaultsUnbonding != 0) revert UnbondingInProgress();

        uint256 preBalance = token.balanceOf(address(this));

        for (uint256 i = 0; i < _vaultIds.length; ++i) {
            uint256 depositIndex = validators[i].depositIndex;

            for (uint256 j = 0; j < _vaultIds[i].length; ++j) {
                uint256 index = _vaultIds[i][j];
                uint256 amount = _amounts[i][j];

                if (amount == 0) revert InvalidAmount();
                if (index > depositIndex) revert InvalidVaultIds();

                if (index == depositIndex) ++depositIndex;
                vaults[i][index].deposit(amount);
            }

            validators[i].depositIndex = depositIndex;
        }

        // balance change could be positive if many rewards are claimed while depositing
        int256 balanceChange = int256(token.balanceOf(address(this))) - int256(preBalance);
        if (balanceChange < 0) {
            totalQueued -= uint256(-1 * balanceChange);
        } else if (balanceChange > 0) {
            totalQueued += uint256(balanceChange);
        }

        emit DepositQueuedTokens();
    }

    /**
     * @notice Unbonds token deposits in vaults
     * @param _toUnbond amount to unbond
     */
    function unbond(uint256 _toUnbond) external onlyFundFlowController {
        if (numVaultsUnbonding != 0) revert UnbondingInProgress();
        if (_toUnbond == 0) revert InvalidAmount();

        uint256[] memory numVaultsUnbonded = new uint256[](validators.length);
        uint256 i = validatorWithdrawalIndex;
        uint256 skipIndex = validatorRemoval.isActive
            ? validatorRemoval.validatorId
            : type(uint256).max;

        while (_toUnbond != 0) {
            if (i != skipIndex) {
                uint256 depositIndex = validators[i].depositIndex;

                if (numVaultsUnbonded[i] < depositIndex) {
                    uint256 vaultIndex = depositIndex - (1 + numVaultsUnbonded[i]);

                    IPolygonVault vault = vaults[i][vaultIndex];

                    if (vault.getPrincipalDeposits() != 0) {
                        vault.unbond();
                        ++numVaultsUnbonded[i];

                        uint256 deposits = vault.getTotalDeposits();
                        _toUnbond = deposits >= _toUnbond ? 0 : _toUnbond - deposits;
                    }
                }
            }

            ++i;
            if (i >= vaults.length) i = 0;
        }

        validatorWithdrawalIndex = i;

        uint256 totalVaultsUnbonded;
        for (uint256 j = 0; j < numVaultsUnbonded.length; ++j) {
            if (numVaultsUnbonded[j] == 0) continue;

            validators[j].depositIndex -= numVaultsUnbonded[j];
            totalVaultsUnbonded += numVaultsUnbonded[j];
        }

        numVaultsUnbonding = totalVaultsUnbonded;

        emit Unbond(_toUnbond);
    }

    /**
     * @notice Claims and withdraws tokens from vaults that are unbonded
     * @param _vaultIds list of vaults to withdraw from
     */
    function unstakeClaim(uint256[][] calldata _vaultIds) external onlyFundFlowController {
        if (numVaultsUnbonding == 0) revert NoVaultsUnbonding();
        if (
            validatorRemoval.isActive &&
            _vaultIds.length > validatorRemoval.validatorId &&
            _vaultIds[validatorRemoval.validatorId].length != 0
        ) revert InvalidVaultIds();

        uint256 preBalance = token.balanceOf(address(this));
        uint256 vaultsWithdrawn;

        for (uint256 i = 0; i < _vaultIds.length; ++i) {
            for (uint256 j = 0; j < _vaultIds[i].length; ++j) {
                vaults[i][_vaultIds[i][j]].withdraw();
                ++vaultsWithdrawn;
            }
        }

        if (vaultsWithdrawn != numVaultsUnbonding) revert MustWithdrawAllVaults();
        numVaultsUnbonding = 0;

        uint256 amountWithdrawn = token.balanceOf(address(this)) - preBalance;
        totalQueued += amountWithdrawn;

        emit UnstakeClaim(amountWithdrawn);
    }

    /**
     * @notice Returns the deposit change since deposits were last updated
     * @dev deposit change could be positive or negative depending on reward rate and whether
     * any slashing occurred
     * @return deposit change
     */
    function getDepositChange() public view returns (int) {
        uint256 totalBalance = token.balanceOf(address(this));

        for (uint256 i = 0; i < vaults.length; ++i) {
            for (uint256 j = 0; j < vaults[i].length; ++j) {
                totalBalance += vaults[i][j].getTotalDeposits();
            }
        }
        return int(totalBalance) - int(totalDeposits);
    }

    /**
     * @notice Updates deposit accounting and calculates fees on newly earned rewards
     * @return depositChange change in deposits since last update
     * @return receivers list of fee receivers
     * @return amounts list of fee amounts
     */
    function updateDeposits(
        bytes calldata
    )
        external
        onlyStakingPool
        returns (int256 depositChange, address[] memory receivers, uint256[] memory amounts)
    {
        depositChange = getDepositChange();
        uint256 balance = token.balanceOf(address(this));

        if (depositChange > 0) {
            totalDeposits += uint256(depositChange);

            uint256 validatorMEVRewards = ((balance - totalQueued) *
                validatorMEVRewardsPercentage) / 10000;

            receivers = new address[](fees.length + (validatorMEVRewards != 0 ? 1 : 0));
            amounts = new uint256[](receivers.length);

            for (uint256 i = 0; i < fees.length; ++i) {
                receivers[i] = fees[i].receiver;
                amounts[i] = (uint256(depositChange) * fees[i].basisPoints) / 10000;
            }

            if (validatorMEVRewards != 0) {
                receivers[receivers.length - 1] = address(validatorMEVRewardsPool);
                amounts[amounts.length - 1] = validatorMEVRewards;
            }
        } else if (depositChange < 0) {
            totalDeposits -= uint256(depositChange * -1);
        }

        totalQueued = balance;
    }

    /**
     * @notice Restakes rewards in the polygon staking contract
     * @param _vaultIds list of vaults to restake rewards for
     */
    function restakeRewards(uint256[][] calldata _vaultIds) external {
        for (uint256 i = 0; i < _vaultIds.length; ++i) {
            for (uint256 j = 0; j < _vaultIds[i].length; ++j) {
                vaults[i][_vaultIds[i][j]].restakeRewards();
            }
        }

        emit RestakeRewards();
    }

    /**
     * @notice Returns the total amount of deposits as tracked in this strategy
     * @return total deposits
     */
    function getTotalDeposits() public view override returns (uint256) {
        return totalDeposits;
    }

    /**
     * @notice Returns the maximum amount of tokens this strategy can hold
     * @return maximum deposits
     */
    function getMaxDeposits() public view override returns (uint256) {
        return type(uint256).max;
    }

    /**
     * @notice Returns the minimum amount of tokens that must remain in this strategy
     * @return minimum deposits
     */
    function getMinDeposits() public view override returns (uint256) {
        return totalDeposits > totalQueued ? totalDeposits - totalQueued : 0;
    }

    /**
     * @notice Returns whether an account should receive validator rewards
     * @dev used by the validator MEV rewards pool
     * @return 1 for accounts that should receive rewards, 0 otherwise
     */
    function staked(address _account) public view returns (uint256) {
        for (uint256 i = 0; i < validators.length; ++i) {
            if (validators[i].rewardsReceiver == _account) return 1;
        }
        return 0;
    }

    /**
     * @notice Returns the total number of active validators
     * @dev used by the validator MEV rewards pool
     * @return total number of active validators
     */
    function totalStaked() public view returns (uint256) {
        uint256 totalValidators = validators.length;
        if (validatorRemoval.isActive) --totalValidators;
        return totalValidators;
    }

    /**
     * @notice Adds a new validator
     * @param _pool address of validator shares pool
     * @param _rewardsReceiver address to receive validator share of MEV rewards
     */
    function addValidator(address _pool, address _rewardsReceiver) external onlyOwner {
        for (uint256 i = 0; i < validators.length; ++i) {
            if (validators[i].pool == _pool) revert ValidatorAlreadyAdded();
        }
        validatorMEVRewardsPool.updateReward(_rewardsReceiver);
        validators.push(Validator(_pool, _rewardsReceiver, 0));
        vaults.push();

        for (uint256 i = 0; i < vaultsPerValidator; ++i) {
            address vault = address(
                new ERC1967Proxy(
                    vaultImplementation,
                    abi.encodeWithSignature(
                        "initialize(address,address,address,address)",
                        address(token),
                        address(this),
                        stakeManager,
                        _pool
                    )
                )
            );
            token.safeApprove(vault, type(uint256).max);
            vaults[vaults.length - 1].push(IPolygonVault(vault));
        }

        emit AddValidator(_pool, _rewardsReceiver);
    }

    /**
     * @notice Queues a validator for removal
     * @param _validatorId id of validator to remove
     */
    function queueValidatorRemoval(uint256 _validatorId) external onlyOwner {
        if (validatorRemoval.isActive) revert RemovalAlreadyQueued();

        uint256 totalValidatorDeposits;

        for (uint256 i = 0; i < vaults[_validatorId].length; ++i) {
            IPolygonVault vault = vaults[_validatorId][i];

            uint256 deposits = vault.getTotalDeposits();
            if (deposits == 0) continue;

            if (vault.isUnbonding() || vault.isWithdrawable()) {
                --numVaultsUnbonding;
            } else {
                vault.unbond();
            }

            totalValidatorDeposits += deposits;
        }

        validatorMEVRewardsPool.updateReward(validators[_validatorId].rewardsReceiver);
        delete validators[_validatorId].rewardsReceiver;

        validatorRemoval = ValidatorRemoval(
            true,
            uint64(_validatorId),
            uint128(totalValidatorDeposits)
        );

        emit QueueValidatorRemoval(
            validators[_validatorId].pool,
            validators[_validatorId].rewardsReceiver
        );
    }

    /**
     * @notice Finalizes a queued validator removal
     * @dev all vaults must be empty or unbonded
     */
    function finalizeValidatorRemoval() external {
        if (!validatorRemoval.isActive) revert NoRemovalQueued();

        uint256 validatorId = validatorRemoval.validatorId;
        uint256 balanceBefore = token.balanceOf(address(this));

        for (uint256 i = 0; i < vaults[validatorId].length; ++i) {
            IPolygonVault vault = vaults[validatorId][i];
            if (vault.getTotalDeposits() != 0) {
                vault.withdraw();
            }
        }

        uint256 amountWithdrawn = token.balanceOf(address(this)) - balanceBefore;
        totalQueued += amountWithdrawn;

        emit FinalizeValidatorRemoval(
            validators[validatorId].pool,
            validators[validatorId].rewardsReceiver
        );

        validators[validatorId] = validators[validators.length - 1];
        validators.pop();
        vaults[validatorId] = vaults[vaults.length - 1];
        vaults.pop();
        delete validatorRemoval;
    }

    /**
     * @notice Upgrades vaults to a new implementation contract
     * @param _data list of encoded function calls to be executed for each vault after upgrade
     */
    function upgradeVaults(bytes[][] memory _data) external onlyOwner {
        for (uint256 i = 0; i < vaults.length; ++i) {
            for (uint256 j = 0; j < vaults[i].length; ++j) {
                if (_data.length == 0 || _data[i][j].length == 0) {
                    vaults[i][j].upgradeTo(vaultImplementation);
                } else {
                    vaults[i][j].upgradeToAndCall(vaultImplementation, _data[i][j]);
                }
            }
        }
        emit UpgradedVaults();
    }

    /**
     * @notice Returns a list of all fees and fee receivers
     * @return list of fees
     */
    function getFees() external view returns (Fee[] memory) {
        return fees;
    }

    /**
     * @notice Adds a new fee
     * @dev stakingPool.updateStrategyRewards is called to credit all past fees at
     * the old rate before the percentage changes
     * @param _receiver receiver of fee
     * @param _feeBasisPoints fee in basis points
     **/
    function addFee(address _receiver, uint256 _feeBasisPoints) external onlyOwner {
        _updateStrategyRewards();
        fees.push(Fee(_receiver, _feeBasisPoints));
        if (_totalFeesBasisPoints() > 3000) revert FeesTooLarge();
        emit AddFee(_receiver, _feeBasisPoints);
    }

    /**
     * @notice Updates an existing fee
     * @dev stakingPool.updateStrategyRewards is called to credit all past fees at
     * the old rate before the percentage changes
     * @param _index index of fee
     * @param _receiver receiver of fee
     * @param _feeBasisPoints fee in basis points
     **/
    function updateFee(
        uint256 _index,
        address _receiver,
        uint256 _feeBasisPoints
    ) external onlyOwner {
        _updateStrategyRewards();

        if (_feeBasisPoints == 0) {
            fees[_index] = fees[fees.length - 1];
            fees.pop();
        } else {
            fees[_index].receiver = _receiver;
            fees[_index].basisPoints = _feeBasisPoints;
        }

        if (_totalFeesBasisPoints() > 3000) revert FeesTooLarge();
        emit UpdateFee(_index, _receiver, _feeBasisPoints);
    }

    /**
     * @notice Sets the validator MEV rewards pool
     * @param _validatorMEVRewardsPool address of rewards pool
     */
    function setValidatorMEVRewardsPool(address _validatorMEVRewardsPool) external onlyOwner {
        validatorMEVRewardsPool = IRewardsPool(_validatorMEVRewardsPool);
    }

    /**
     * @notice Sets the percentage of MEV rewards that validators receiver
     * @param _validatorMEVRewardsPercentage basis point amount
     */
    function setValidatorMEVRewardsPercentage(
        uint256 _validatorMEVRewardsPercentage
    ) external onlyOwner {
        validatorMEVRewardsPercentage = _validatorMEVRewardsPercentage;
        emit SetValidatorMEVRewardsPercentage(_validatorMEVRewardsPercentage);
    }

    /**
     * @notice Sets a new vault implementation contract to be used when deploying/upgrading vaults
     * @param _vaultImplementation address of implementation contract
     */
    function setVaultImplementation(address _vaultImplementation) external onlyOwner {
        vaultImplementation = _vaultImplementation;
        emit SetVaultImplementation(_vaultImplementation);
    }

    /**
     * @notice Sets the fund flow controller
     * @param _fundFlowController address of fund flow controller
     */
    function setFundFlowController(address _fundFlowController) external onlyOwner {
        fundFlowController = _fundFlowController;
    }

    /**
     * @notice Updates rewards for all strategies controlled by the staking pool
     * @dev called before fees are changed to credit any past rewards at the old rate
     */
    function _updateStrategyRewards() internal {
        address[] memory strategies = stakingPool.getStrategies();
        uint256[] memory strategyIdxs = new uint256[](strategies.length);
        for (uint256 i = 0; i < strategies.length; ++i) {
            strategyIdxs[i] = i;
        }
        stakingPool.updateStrategyRewards(strategyIdxs, "");
    }

    /**
     * @notice Returns the sum of all fees
     * @return sum of fees in basis points
     **/
    function _totalFeesBasisPoints() private view returns (uint256) {
        uint256 totalFees;
        for (uint i = 0; i < fees.length; ++i) {
            totalFees += fees[i].basisPoints;
        }
        return totalFees;
    }
}
