// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../../core/interfaces/IERC677.sol";
import "../../core/base/Strategy.sol";
import "../interfaces/IVault.sol";
import "../interfaces/IStaking.sol";
import "../interfaces/IWithdrawalController.sol";

/**
 * @title Vault Controller Strategy
 * @notice Base strategy for managing multiple Chainlink staking vaults
 */
abstract contract VaultControllerStrategy is Strategy {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct Fee {
        address receiver;
        uint256 basisPoints;
    }

    struct VaultGroup {
        uint64 withdrawalIndex;
        uint128 totalDepositRoom;
    }

    struct GlobalVaultState {
        uint64 numVaultGroups;
        uint64 curUnbondedVaultGroup;
        uint64 groupDepositIndex;
        uint64 depositIndex;
    }

    IStaking public stakeController;
    Fee[] internal fees;

    address public vaultImplementation;

    IVault[] internal vaults;
    uint256 internal totalDeposits;
    uint256 public totalPrincipalDeposits;

    uint256 public maxDepositSizeBP;

    IWithdrawalController public withdrawalController;
    uint256 internal totalUnbonded;

    VaultGroup[] public vaultGroups;
    GlobalVaultState public globalVaultState;
    uint256 internal vaultMaxDeposits;

    uint256[6] private __gap;

    event UpgradedVaults(uint256[] vaults);
    event SetMaxDepositSizeBP(uint256 maxDepositSizeBP);
    event SetVaultImplementation(address vaultImplementation);

    error FeesTooLarge();
    error InvalidBasisPoints();
    error SenderNotAuthorized();
    error InsufficientTokensUnbonded();
    error InvalidVaultIds();

    /**
     * @notice initializes contract
     * @param _token address of LINK token
     * @param _stakingPool address of the staking pool that controls this strategy
     * @param _stakeController address of Chainlink staking contract
     * @param _vaultImplementation address of the implementation contract to use when deploying new vaults
     * @param _fees list of fees to be paid on rewards
     * @param _maxDepositSizeBP basis point amount of the remaing deposit room in the Chainlink staking contract
     * that can be deposited at once
     * @param _vaultMaxDeposits maximum deposit limit for a single vault
     **/
    function __VaultControllerStrategy_init(
        address _token,
        address _stakingPool,
        address _stakeController,
        address _vaultImplementation,
        Fee[] memory _fees,
        uint256 _maxDepositSizeBP,
        uint256 _vaultMaxDeposits
    ) public onlyInitializing {
        __Strategy_init(_token, _stakingPool);

        stakeController = IStaking(_stakeController);

        require(_isContract(_vaultImplementation), "Vault implementation address must belong to a contract");
        vaultImplementation = _vaultImplementation;

        for (uint256 i = 0; i < _fees.length; ++i) {
            fees.push(_fees[i]);
        }
        if (_totalFeesBasisPoints() > 3000) revert FeesTooLarge();

        if (_maxDepositSizeBP > 10000) revert InvalidBasisPoints();
        maxDepositSizeBP = _maxDepositSizeBP;

        vaultMaxDeposits = _vaultMaxDeposits;
    }

    modifier onlyWithdrawalController() {
        if (msg.sender != address(withdrawalController)) revert SenderNotAuthorized();
        _;
    }

    /**
     * @notice returns a list of all vaults controlled by this contract
     * @return  list of vault addresses
     */
    function getVaults() external view returns (IVault[] memory) {
        return vaults;
    }

    /**
     * @notice deposits tokens into this strategy from the staking pool
     * @dev reverts if sender is not stakingPool
     * @param _amount amount to deposit
     */
    function deposit(uint256 _amount, bytes calldata _data) external onlyStakingPool {
        token.safeTransferFrom(msg.sender, address(this), _amount);

        (uint256 minDeposits, uint256 maxDeposits) = getVaultDepositLimits();

        if (maxDeposits > vaultMaxDeposits) {
            uint256 diff = maxDeposits - vaultMaxDeposits;
            uint256 totalVaults = globalVaultState.depositIndex;
            uint256 numVaultGroups = globalVaultState.numVaultGroups;
            uint256 vaultsPerGroup = totalVaults / numVaultGroups;
            uint256 remainder = totalVaults % numVaultGroups;

            for (uint256 i = 0; i < numVaultGroups; ++i) {
                uint256 numVaults = vaultsPerGroup;
                if (i < remainder) {
                    numVaults += 1;
                }

                vaultGroups[i].totalDepositRoom += uint128(numVaults * diff);
            }
        }

        uint256 toDeposit = token.balanceOf(address(this));
        uint64[] memory vaultIds = abi.decode(_data, (uint64[]));
        uint256 deposited = _depositToVaults(toDeposit, minDeposits, maxDeposits, vaultIds);

        totalDeposits += deposited;
        totalPrincipalDeposits += deposited;

        if (deposited < toDeposit) {
            token.safeTransfer(address(stakingPool), toDeposit - deposited);
        }
    }

    /**
     * @notice withdrawals are not yet implemented
     */
    function withdraw(uint256 _amount, bytes calldata _data) external onlyStakingPool {
        if (!withdrawalController.claimPeriodActive() || _amount > totalUnbonded) revert InsufficientTokensUnbonded();

        GlobalVaultState memory globalState = globalVaultState;
        uint64[] memory vaultIds = abi.decode(_data, (uint64[]));
        VaultGroup memory group = vaultGroups[globalState.curUnbondedVaultGroup];

        if (vaultIds[0] != group.withdrawalIndex) revert InvalidVaultIds();

        uint256 toWithdraw = _amount;
        uint256 unbondedRemaining = totalUnbonded;
        (uint256 minDeposits, ) = getVaultDepositLimits();

        for (uint256 i = 0; i < vaultIds.length; ++i) {
            if (vaultIds[i] % globalState.numVaultGroups != globalState.curUnbondedVaultGroup) revert InvalidVaultIds();

            group.withdrawalIndex = uint64(vaultIds[i]);
            IVault vault = vaults[vaultIds[i]];
            uint256 deposits = vault.getPrincipalDeposits();

            if (deposits != 0 && vault.unbondingActive()) {
                if (toWithdraw > deposits) {
                    vault.withdraw(deposits);
                    unbondedRemaining -= deposits;
                    toWithdraw -= deposits;
                } else if (deposits - toWithdraw > 0 && deposits - toWithdraw < minDeposits) {
                    vault.withdraw(deposits);
                    unbondedRemaining -= deposits;
                    break;
                } else {
                    vault.withdraw(toWithdraw);
                    unbondedRemaining -= toWithdraw;
                    break;
                }
            }
        }

        uint256 totalWithdrawn = totalUnbonded - unbondedRemaining;

        token.safeTransfer(msg.sender, totalWithdrawn);

        totalDeposits -= totalWithdrawn;
        totalPrincipalDeposits -= totalWithdrawn;
        totalUnbonded = unbondedRemaining;

        group.totalDepositRoom += uint128(totalWithdrawn);
        vaultGroups[globalVaultState.curUnbondedVaultGroup] = group;
    }

    function updateVaultGroups(
        uint256[] calldata _curGroupVaultsToUnbond,
        uint256 _nextGroup,
        uint256 _nextGroupTotalUnbonded
    ) external onlyWithdrawalController {
        for (uint256 i = 0; i < _curGroupVaultsToUnbond.length; ++i) {
            vaults[_curGroupVaultsToUnbond[i]].unbond();
        }

        globalVaultState.curUnbondedVaultGroup = uint64(_nextGroup);
        totalUnbonded = _nextGroupTotalUnbonded;
    }

    /**
     * @notice returns the deposit change since deposits were last updated
     * @dev deposit change could be positive or negative depending on reward rate and whether
     * any slashing occurred
     * @return deposit change
     */
    function getDepositChange() public view virtual returns (int) {
        uint256 totalBalance = token.balanceOf(address(this));
        for (uint256 i = 0; i < vaults.length; ++i) {
            totalBalance += vaults[i].getTotalDeposits();
        }
        return int(totalBalance) - int(totalDeposits);
    }

    /**
     * @notice returns the total amount of fees that will be paid on the next call to updateDeposits()
     * @dev fees are only paid when the depositChange since the last update is positive
     * @return total fees
     */
    function getPendingFees() external view virtual override returns (uint256) {
        int256 depositChange = getDepositChange();
        uint256 totalFees;

        if (depositChange > 0) {
            for (uint256 i = 0; i < fees.length; ++i) {
                totalFees += (uint256(depositChange) * fees[i].basisPoints) / 10000;
            }
        }
        return totalFees;
    }

    /**
     * @notice updates deposit accounting and calculates fees on newly earned rewards
     * @dev reverts if sender is not stakingPool
     * @return depositChange change in deposits since last update
     * @return receivers list of fee receivers
     * @return amounts list of fee amounts
     */
    function updateDeposits(bytes calldata)
        external
        virtual
        onlyStakingPool
        returns (
            int256 depositChange,
            address[] memory receivers,
            uint256[] memory amounts
        )
    {
        depositChange = getDepositChange();
        uint256 newTotalDeposits = totalDeposits;

        if (depositChange > 0) {
            newTotalDeposits += uint256(depositChange);

            receivers = new address[](fees.length);
            amounts = new uint256[](fees.length);

            for (uint256 i = 0; i < fees.length; ++i) {
                receivers[i] = fees[i].receiver;
                amounts[i] = (uint256(depositChange) * fees[i].basisPoints) / 10000;
            }
        } else if (depositChange < 0) {
            newTotalDeposits -= uint256(depositChange * -1);
        }

        uint256 balance = token.balanceOf(address(this));
        if (balance != 0) {
            token.safeTransfer(address(stakingPool), balance);
            newTotalDeposits -= balance;
        }

        totalDeposits = newTotalDeposits;
    }

    /**
     * @notice returns the total amount of deposits as tracked in this strategy
     * @return total deposits
     */
    function getTotalDeposits() public view override returns (uint256) {
        return totalDeposits;
    }

    /**
     * @notice returns the maximum that can be deposited into this strategy
     * @return maximum deposits
     */
    function getMaxDeposits() public view virtual override returns (uint256) {
        (, uint256 maxDeposits) = getVaultDepositLimits();
        return
            totalDeposits +
            (
                stakeController.isActive()
                    ? MathUpgradeable.min(
                        vaults.length * maxDeposits - totalPrincipalDeposits,
                        ((stakeController.getMaxPoolSize() - stakeController.getTotalPrincipal()) * maxDepositSizeBP) / 10000
                    )
                    : 0
            );
    }

    /**
     * @notice returns the minimum that must remain this strategy
     * @return minimum deposits
     */
    function getMinDeposits() public view virtual override returns (uint256) {
        return withdrawalController.claimPeriodActive() ? totalDeposits - totalUnbonded : totalDeposits;
    }

    /**
     * @notice returns the vault deposit limits for vaults controlled by this strategy
     * @return minimum amount of deposits that a vault can hold
     * @return maximum amount of deposits that a vault can hold
     */
    function getVaultDepositLimits() public view returns (uint256, uint256) {
        return stakeController.getStakerLimits();
    }

    /**
     * @notice Upgrades vaults to a new implementation contract
     * @param _vaults list of vault indexes to upgrade
     * @param _data list of encoded function calls to be executed for each vault after upgrade
     */
    function upgradeVaults(uint256[] calldata _vaults, bytes[] memory _data) external onlyOwner {
        for (uint256 i = 0; i < _vaults.length; ++i) {
            if (_data[i].length == 0) {
                vaults[_vaults[i]].upgradeTo(vaultImplementation);
            } else {
                vaults[_vaults[i]].upgradeToAndCall(vaultImplementation, _data[i]);
            }
        }
        emit UpgradedVaults(_vaults);
    }

    /**
     * @notice returns a list of all fees and fee receivers
     * @return list of fees
     */
    function getFees() external view returns (Fee[] memory) {
        return fees;
    }

    /**
     * @notice adds a new fee
     * @dev stakingPool.updateStrategyRewards is called to credit all past fees at
     * the old rate before the percentage changes
     * @param _receiver receiver of fee
     * @param _feeBasisPoints fee in basis points
     **/
    function addFee(address _receiver, uint256 _feeBasisPoints) external onlyOwner {
        _updateStrategyRewards();
        fees.push(Fee(_receiver, _feeBasisPoints));
        if (_totalFeesBasisPoints() > 3000) revert FeesTooLarge();
    }

    /**
     * @notice updates an existing fee
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
    }

    /**
     * @notice sets the basis point amount of the remaing deposit room in the Chainlink staking contract
     * that can be deposited at once
     * @param _maxDepositSizeBP basis point amount
     */
    function setMaxDepositSizeBP(uint256 _maxDepositSizeBP) external onlyOwner {
        if (_maxDepositSizeBP > 10000) revert InvalidBasisPoints();
        maxDepositSizeBP = _maxDepositSizeBP;
        emit SetMaxDepositSizeBP(_maxDepositSizeBP);
    }

    /**
     * @notice sets a new vault implementation contract to be used when deploying/upgrading vaults
     * @dev
     * - reverts if sender is not owner
     * - reverts if `_vaultImplementation` is not a contract
     * @param _vaultImplementation address of implementation contract
     */
    function setVaultImplementation(address _vaultImplementation) external onlyOwner {
        require(_isContract(_vaultImplementation), "Address must belong to a contract");
        vaultImplementation = _vaultImplementation;
        emit SetVaultImplementation(_vaultImplementation);
    }

    /**
     * @notice sets the address authorized to unbond tokens in the Chainlink staking contract
     * @param _withdrawalController address of withdrawal controller
     */
    function setWithdrawalController(address _withdrawalController) external onlyOwner {
        withdrawalController = IWithdrawalController(_withdrawalController);
    }

    /**
     * @notice deposits tokens into vaults
     * @dev assumes the number of vault groups is reasonably low
     * @param _toDeposit amount to deposit
     * @param _minDeposits minimum amount of deposits that a vault can hold
     * @param _maxDeposits minimum amount of deposits that a vault can hold
     * @param _vaultIds list of vaults to deposit into
     */
    function _depositToVaults(
        uint256 _toDeposit,
        uint256 _minDeposits,
        uint256 _maxDeposits,
        uint64[] memory _vaultIds
    ) internal returns (uint256) {
        uint256 toDeposit = _toDeposit;
        uint256 totalRebonded;
        GlobalVaultState memory globalState = globalVaultState;
        VaultGroup[] memory groups = vaultGroups;

        if (_vaultIds.length != 0 && _vaultIds[0] != globalState.groupDepositIndex) revert InvalidVaultIds();

        for (uint256 i = 0; i < _vaultIds.length; ++i) {
            uint256 vaultIndex = _vaultIds[i];
            if (vaultIndex >= globalState.depositIndex) revert InvalidVaultIds();

            IVault vault = vaults[vaultIndex];
            uint256 groupIndex = vaultIndex % globalState.numVaultGroups;
            VaultGroup memory group = groups[groupIndex];
            uint256 deposits = vault.getPrincipalDeposits();
            uint256 canDeposit = _maxDeposits - deposits;

            globalState.groupDepositIndex = uint64(vaultIndex);

            if (deposits == 0 && vaultIndex == group.withdrawalIndex) {
                group.withdrawalIndex += uint64(globalState.numVaultGroups);
                if (group.withdrawalIndex > globalState.depositIndex) {
                    group.withdrawalIndex = uint64(groupIndex);
                }
            }

            if (canDeposit != 0 && vaultIndex != group.withdrawalIndex) {
                if (deposits < _minDeposits && toDeposit < (_minDeposits - deposits)) {
                    break;
                }

                if (vault.unbondingActive()) {
                    totalRebonded += deposits;
                }

                if (toDeposit > canDeposit) {
                    vault.deposit(canDeposit);
                    toDeposit -= canDeposit;
                    group.totalDepositRoom -= uint128(canDeposit);
                } else {
                    vault.deposit(toDeposit);
                    group.totalDepositRoom -= uint128(toDeposit);
                    toDeposit = 0;
                    break;
                }
            }
        }

        globalVaultState = globalState;

        for (uint256 i = 0; i < globalState.numVaultGroups; ++i) {
            VaultGroup memory group = vaultGroups[i];
            if (group.withdrawalIndex != groups[i].withdrawalIndex || group.totalDepositRoom != groups[i].totalDepositRoom) {
                vaultGroups[i] = groups[i];
            }
        }

        if (totalRebonded != 0) totalUnbonded -= totalRebonded;
        if (toDeposit == 0 || toDeposit < _minDeposits) return _toDeposit - toDeposit;

        for (uint256 i = 0; i < globalState.numVaultGroups; ++i) {
            if (i != globalState.curUnbondedVaultGroup && groups[i].totalDepositRoom >= _maxDeposits) {
                return _toDeposit - toDeposit;
            }
        }

        // Deposit into additional vaults that don't yet belong to a group

        uint256 numVaults = vaults.length;
        uint256 i = globalState.depositIndex;

        while (i < numVaults) {
            IVault vault = vaults[i];
            uint256 deposits = vault.getPrincipalDeposits();
            uint256 canDeposit = _maxDeposits - deposits;

            if (deposits < _minDeposits && toDeposit < (_minDeposits - deposits)) {
                break;
            }

            if (toDeposit > canDeposit) {
                vault.deposit(canDeposit);
                toDeposit -= canDeposit;
            } else {
                vault.deposit(toDeposit);
                if (toDeposit < canDeposit) {
                    toDeposit = 0;
                    break;
                }
                toDeposit = 0;
            }

            ++i;
        }

        globalVaultState.depositIndex = uint64(i);

        return _toDeposit - toDeposit;
    }

    /**
     * @notice deploys a new vault and adds it to this strategy
     * @param _data optional encoded function call to be executed after deployment
     */
    function _deployVault(bytes memory _data) internal {
        address vault = address(new ERC1967Proxy(vaultImplementation, _data));
        token.safeApprove(vault, type(uint256).max);
        vaults.push(IVault(vault));
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
     * @notice returns the sum of all fees
     * @return sum of fees in basis points
     **/
    function _totalFeesBasisPoints() private view returns (uint256) {
        uint256 totalFees;
        for (uint i = 0; i < fees.length; ++i) {
            totalFees += fees[i].basisPoints;
        }
        return totalFees;
    }

    /**
     * @notice returns whether an address belongs to a contract
     * @param _address address to check
     * @return true if address is contract, false otherwise
     */
    function _isContract(address _address) private view returns (bool) {
        uint256 length;
        assembly {
            length := extcodesize(_address)
        }
        return length > 0;
    }
}
