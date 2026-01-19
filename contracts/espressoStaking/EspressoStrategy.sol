// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../core/base/Strategy.sol";
import "../core/interfaces/IRewardsPool.sol";
import "./interfaces/IEspressoVault.sol";

/**
 * @title Espresso Strategy
 * @notice Strategy for managing multiple Espresso staking vaults
 */
contract EspressoStrategy is Strategy {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    uint256 private constant BASIS_POINTS = 10000;

    struct Fee {
        // address to recieve fee
        address receiver;
        // value of fee in basis points
        uint256 basisPoints;
    }

    // list of fees that are paid on rewards
    Fee[] private fees;

    // address of Espresso delegation contract
    address public espressoStaking;
    // address of Espresso rewards contract
    address public espressoRewards;
    // address of fund flow controller
    address public fundFlowController;
    // address of rewards oracle
    address public rewardsOracle;
    // max reward change allowed per update in basis points
    uint256 public maxRewardChangeBPS;

    // list of vaults
    IEspressoVault[] private vaults;
    // address of vault implementation contract to be used when deploying new vaults
    address public vaultImplementation;

    // total number of tokens staked in this strategy
    uint256 private totalDeposits;
    // total number of tokens queued for deposit into vaults
    uint256 public totalQueued;
    // total number of vaults currently unbonding
    uint256 public numVaultsUnbonding;
    // index of vault to withdraw from on next withdrawal
    uint256 public vaultWithdrawalIndex;

    event DepositQueuedTokens(uint256 amount);
    event Unbond(uint256 amount);
    event ForceUnbond(uint256 amount);
    event ClaimUnbond(uint256 amount);
    event RestakeRewards();
    event WithdrawRewards();
    event ClaimValidatorExits();
    event AddVault(address indexed validator);
    event RemoveVault(address indexed vault);
    event UpgradedVaults(address[] vaults);
    event AddFee(address receiver, uint256 feeBasisPoints);
    event UpdateFee(uint256 index, address receiver, uint256 feeBasisPoints);
    event RemoveFee(uint256 index, address receiver, uint256 feeBasisPoints);
    event SetVaultImplementation(address vaultImplementation);
    event SetMaxRewardChangeBPS(uint256 maxRewardChangeBPS);

    error FeesTooLarge();
    error SenderNotAuthorized();
    error InvalidParamLengths();
    error InvalidAmount();
    error UnbondingInProgress();
    error InsufficientDeposits();
    error InvalidVaultIds();
    error NoVaultsUnbonding();
    error MustWithdrawAllVaults();
    error VaultNotEmpty();
    error InvalidAddress();
    error RewardsTooHigh();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes contract
     * @param _token address of ESP token
     * @param _stakingPool address of the staking pool that controls this strategy
     * @param _espressoStaking address of Espresso delegation contract
     * @param _espressoRewards address of Espresso rewards contract
     * @param _vaultImplementation address of the implementation contract to use when deploying new vaults
     * @param _maxRewardChangeBPS max reward change allowed per update in basis points
     * @param _fees list of fees to be paid on rewards
     **/
    function initialize(
        address _token,
        address _stakingPool,
        address _espressoStaking,
        address _espressoRewards,
        address _vaultImplementation,
        uint256 _maxRewardChangeBPS,
        Fee[] memory _fees
    ) public initializer {
        __Strategy_init(_token, _stakingPool);

        espressoStaking = _espressoStaking;
        espressoRewards = _espressoRewards;
        vaultImplementation = _vaultImplementation;
        maxRewardChangeBPS = _maxRewardChangeBPS;

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
     * @notice Reverts if sender is not rewards oracle
     */
    modifier onlyRewardsOracle() {
        if (msg.sender != rewardsOracle) revert SenderNotAuthorized();
        _;
    }

    /**
     * @notice Returns a list of all vaults controlled by this contract
     * @return list of vault addresses
     */
    function getVaults() external view returns (IEspressoVault[] memory) {
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
        uint256[] calldata _vaultIds,
        uint256[] calldata _amounts
    ) external onlyFundFlowController {
        if (_vaultIds.length == 0 || _vaultIds.length != _amounts.length)
            revert InvalidParamLengths();

        uint256 totalAmount;

        for (uint256 i = 0; i < _vaultIds.length; ++i) {
            uint256 amount = _amounts[i];
            if (amount == 0) revert InvalidAmount();

            vaults[_vaultIds[i]].deposit(amount);
            totalAmount += amount;
        }

        totalQueued -= totalAmount;

        emit DepositQueuedTokens(totalAmount);
    }

    /**
     * @notice Unbonds token deposits in vaults
     * @param _toUnbond amount to unbond
     */
    function unbond(uint256 _toUnbond) external onlyFundFlowController {
        if (numVaultsUnbonding != 0) revert UnbondingInProgress();
        if (_toUnbond == 0) revert InvalidAmount();

        uint256 toUnbondRemaining = _toUnbond;

        uint256 i = vaultWithdrawalIndex;
        uint256 numVaultsUnbonded;

        while (toUnbondRemaining != 0) {
            IEspressoVault vault = vaults[i];
            uint256 principalDeposits = vault.getPrincipalDeposits();

            if (!vault.isActive()) {
                uint256 deposits = vault.getTotalDeposits();
                toUnbondRemaining = toUnbondRemaining <= deposits
                    ? 0
                    : toUnbondRemaining - deposits;
            } else if (principalDeposits != 0) {
                uint256 vaultToUnbond = principalDeposits >= toUnbondRemaining
                    ? toUnbondRemaining
                    : principalDeposits;

                vault.unbond(vaultToUnbond);

                toUnbondRemaining -= vaultToUnbond;
                ++numVaultsUnbonded;
            }

            i = (i + 1) % vaults.length;
            if (i == vaultWithdrawalIndex) break;
        }

        if (toUnbondRemaining > 0) revert InsufficientDeposits();

        vaultWithdrawalIndex = i;
        numVaultsUnbonding = numVaultsUnbonded;

        emit Unbond(_toUnbond);
    }

    /**
     * @notice Unbonds token deposits in vaults
     * @dev used to rebalance deposits between vaults if necessary
     * @param _vaultIds list of vaults to unbond
     * @param _amounts list of amounts to unbond
     */
    function forceUnbond(
        uint256[] calldata _vaultIds,
        uint256[] calldata _amounts
    ) external onlyFundFlowController {
        if (_vaultIds.length != _amounts.length) revert InvalidParamLengths();
        if (numVaultsUnbonding != 0) revert UnbondingInProgress();

        uint256 totalUnbonded;

        for (uint256 i = 0; i < _vaultIds.length; ++i) {
            if (i > 0 && _vaultIds[i] <= _vaultIds[i - 1]) revert InvalidVaultIds();
            if (_amounts[i] == 0) revert InvalidAmount();

            vaults[_vaultIds[i]].unbond(_amounts[i]);
            totalUnbonded += _amounts[i];
        }

        numVaultsUnbonding = _vaultIds.length;

        emit ForceUnbond(totalUnbonded);
    }

    /**
     * @notice Withdraws tokens from vaults that are unbonded
     * @param _vaultIds list of vaults to withdraw from
     */
    function claimUnbond(uint256[] calldata _vaultIds) external onlyFundFlowController {
        if (numVaultsUnbonding == 0) revert NoVaultsUnbonding();

        uint256 preBalance = token.balanceOf(address(this));
        uint256 vaultsWithdrawn;

        for (uint256 i = 0; i < _vaultIds.length; ++i) {
            vaults[_vaultIds[i]].withdraw();
            ++vaultsWithdrawn;
        }

        if (vaultsWithdrawn != numVaultsUnbonding) revert MustWithdrawAllVaults();
        numVaultsUnbonding = 0;

        uint256 amountWithdrawn = token.balanceOf(address(this)) - preBalance;
        totalQueued += amountWithdrawn;

        emit ClaimUnbond(amountWithdrawn);
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
            totalBalance += vaults[i].getTotalDeposits();
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

            receivers = new address[](fees.length);
            amounts = new uint256[](receivers.length);

            for (uint256 i = 0; i < fees.length; ++i) {
                receivers[i] = fees[i].receiver;
                amounts[i] = (uint256(depositChange) * fees[i].basisPoints) / BASIS_POINTS;
            }
        } else if (depositChange < 0) {
            totalDeposits -= uint256(depositChange * -1);
        }

        totalQueued = balance;
    }

    /**
     * @notice Restakes rewards in the Espresso staking contract
     * @param _vaultIds list of vaults to restake rewards for
     * @param _lifetimeRewards list of lifetime rewards values for each vault
     * @param _authData list of authorization data for each vault
     */
    function restakeRewards(
        uint256[] calldata _vaultIds,
        uint256[] calldata _lifetimeRewards,
        bytes[] calldata _authData
    ) external onlyFundFlowController {
        if (_vaultIds.length != _lifetimeRewards.length || _vaultIds.length != _authData.length) {
            revert InvalidParamLengths();
        }

        for (uint256 i = 0; i < _vaultIds.length; ++i) {
            vaults[_vaultIds[i]].restakeRewards(_lifetimeRewards[i], _authData[i]);
        }

        emit RestakeRewards();
    }

    /**
     * @notice Withdraws rewards from the Espresso staking contract
     * @param _vaultIds list of vaults to withdraw rewards for
     * @param _lifetimeRewards list of lifetime rewards values for each vault
     * @param _authData list of authorization data for each vault
     */
    function withdrawRewards(
        uint256[] calldata _vaultIds,
        uint256[] calldata _lifetimeRewards,
        bytes[] calldata _authData
    ) external onlyFundFlowController {
        if (_vaultIds.length != _lifetimeRewards.length || _vaultIds.length != _authData.length) {
            revert InvalidParamLengths();
        }

        uint256 preBalance = token.balanceOf(address(this));

        for (uint256 i = 0; i < _vaultIds.length; ++i) {
            vaults[_vaultIds[i]].withdrawRewards(_lifetimeRewards[i], _authData[i]);
        }

        totalQueued += token.balanceOf(address(this)) - preBalance;

        emit WithdrawRewards();
    }

    /**
     * @notice Updates lifetime rewards tracking for specified vaults
     * @dev Used to sync lifetime rewards which is fetched off chain
     * @param _vaultIds list of vaults to update lifetime rewards for
     * @param _lifetimeRewards list of lifetime rewards values for each vault
     */
    function updateLifetimeRewards(
        uint256[] calldata _vaultIds,
        uint256[] calldata _lifetimeRewards
    ) external onlyRewardsOracle {
        if (_vaultIds.length != _lifetimeRewards.length) revert InvalidParamLengths();

        for (uint256 i = 0; i < _vaultIds.length; ++i) {
            vaults[_vaultIds[i]].updateLifetimeRewards(_lifetimeRewards[i]);
        }

        int256 rewards = getDepositChange();
        if (rewards > 0 && uint256(rewards) > (totalDeposits * maxRewardChangeBPS) / BASIS_POINTS)
            revert RewardsTooHigh();
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
     * @notice Claims validator exits for specified vaults
     * @param _vaultIds list of vaults to claim validator exits for
     */
    function claimValidatorExits(uint256[] calldata _vaultIds) external onlyOwner {
        uint256 preBalance = token.balanceOf(address(this));

        for (uint256 i = 0; i < _vaultIds.length; ++i) {
            vaults[_vaultIds[i]].claimValidatorExit();
        }

        totalQueued += token.balanceOf(address(this)) - preBalance;

        emit ClaimValidatorExits();
    }

    /**
     * @notice Adds a new vault
     * @param _validator address of validator
     */
    function addVault(address _validator) external onlyOwner {
        address vault = address(
            new ERC1967Proxy(
                vaultImplementation,
                abi.encodeWithSignature(
                    "initialize(address,address,address,address,address)",
                    address(token),
                    address(this),
                    espressoStaking,
                    espressoRewards,
                    _validator
                )
            )
        );
        token.safeApprove(vault, type(uint256).max);
        vaults.push(IEspressoVault(vault));

        emit AddVault(_validator);
    }

    /**
     * @notice Removes vaults
     * @dev Withdraws any remaining principal deposits so vault must be empty or any
     * unbonding periods must have elapsed for remaining deposits, otherwise call will revert.
     * Will not check for unclaimed rewards so rewards must be claimed before removing a vault,
     * otherwise they will be lost.
     * @param _vaultIdxs list of vault indices to remove (must be in ascending order)
     */
    function removeVaults(uint256[] calldata _vaultIdxs) external onlyOwner {
        if (_vaultIdxs.length == 0) revert InvalidParamLengths();

        uint256 preBalance = token.balanceOf(address(this));

        // Process vaults in reverse order to avoid index shifting issues
        for (uint256 i = _vaultIdxs.length; i > 0; --i) {
            uint256 vaultIdx = _vaultIdxs[i - 1];

            // Ensure indices are in ascending order to prevent issues
            if (i < _vaultIdxs.length && vaultIdx >= _vaultIdxs[i]) revert InvalidVaultIds();

            IEspressoVault vault = vaults[vaultIdx];

            // Withdraw all deposits (assumes all unbonding periods have elapsed)
            if (vault.getQueuedWithdrawals() > 0) {
                vault.withdraw();
                --numVaultsUnbonding;
            }
            if (!vault.isActive() && vault.getPrincipalDeposits() > 0) vault.claimValidatorExit();

            // Ensure vault is empty
            if (vault.getPrincipalDeposits() > 0) revert VaultNotEmpty();

            // Remove token approval
            token.safeApprove(address(vault), 0);

            // Adjust vaultWithdrawalIndex if needed
            if (vaultIdx == vaults.length - 1 && vaultWithdrawalIndex == vaults.length - 1) {
                vaultWithdrawalIndex = 0;
            } else if (vaultWithdrawalIndex > vaultIdx) {
                --vaultWithdrawalIndex;
            }

            // Shift remaining vaults to fill the gap
            for (uint256 j = vaultIdx; j < vaults.length - 1; ++j) {
                vaults[j] = vaults[j + 1];
            }
            vaults.pop();

            emit RemoveVault(address(vault));
        }

        uint256 amountWithdrawn = token.balanceOf(address(this)) - preBalance;
        totalQueued += amountWithdrawn;
    }

    /**
     * @notice Upgrades vaults to a new implementation contract
     * @param _vaults list of vaults to upgrade
     * @param _data list of encoded function calls to be executed for each vault after upgrade
     */
    function upgradeVaults(address[] calldata _vaults, bytes[] memory _data) external onlyOwner {
        for (uint256 i = 0; i < _vaults.length; ++i) {
            if (_data.length == 0 || _data[i].length == 0) {
                IEspressoVault(_vaults[i]).upgradeTo(vaultImplementation);
            } else {
                IEspressoVault(_vaults[i]).upgradeToAndCall(vaultImplementation, _data[i]);
            }
        }
        emit UpgradedVaults(_vaults);
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
            Fee memory toRemove = fees[_index];
            fees[_index] = fees[fees.length - 1];
            fees.pop();
            emit RemoveFee(_index, toRemove.receiver, toRemove.basisPoints);
        } else {
            fees[_index].receiver = _receiver;
            fees[_index].basisPoints = _feeBasisPoints;
            if (_totalFeesBasisPoints() > 3000) revert FeesTooLarge();
            emit UpdateFee(_index, _receiver, _feeBasisPoints);
        }
    }

    /**
     * @notice Sets a new vault implementation contract to be used when deploying/upgrading vaults
     * @param _vaultImplementation address of implementation contract
     */
    function setVaultImplementation(address _vaultImplementation) external onlyOwner {
        if (_vaultImplementation == address(0)) revert InvalidAddress();
        vaultImplementation = _vaultImplementation;
        emit SetVaultImplementation(_vaultImplementation);
    }

    /**
     * @notice Sets the fund flow controller
     * @param _fundFlowController address of fund flow controller
     */
    function setFundFlowController(address _fundFlowController) external onlyOwner {
        if (_fundFlowController == address(0)) revert InvalidAddress();
        fundFlowController = _fundFlowController;
    }

    /**
     * @notice Sets the rewards oracle
     * @param _rewardsOracle address of rewards oracle
     */
    function setRewardsOracle(address _rewardsOracle) external onlyOwner {
        if (_rewardsOracle == address(0)) revert InvalidAddress();
        rewardsOracle = _rewardsOracle;
    }

    /**
     * @notice Sets the max reward change allowed per update in basis points
     * @param _maxRewardChangeBPS max reward change allowed per update in basis points
     */
    function setMaxRewardChangeBPS(uint256 _maxRewardChangeBPS) external onlyOwner {
        maxRewardChangeBPS = _maxRewardChangeBPS;
        emit SetMaxRewardChangeBPS(_maxRewardChangeBPS);
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
