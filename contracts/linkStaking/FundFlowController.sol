// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./interfaces/IVaultControllerStrategy.sol";
import "./interfaces/IOperatorVCS.sol";
import "./interfaces/IVault.sol";
import "./interfaces/IOperatorVault.sol";

/**
 * @title Fund Flow Controller
 * @notice Manages deposits and withdrawals for the Chainlink staking vaults
 */
contract FundFlowController is UUPSUpgradeable, OwnableUpgradeable {
    IVaultControllerStrategy public operatorVCS;
    IVaultControllerStrategy public communityVCS;

    uint64 public unbondingPeriod;
    uint64 public claimPeriod;

    uint64 public numVaultGroups;
    uint64 public curUnbondedVaultGroup;
    uint256[] public timeOfLastUpdateByGroup;

    error SenderNotAuthorized();
    error NoUpdateNeeded();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes contract
     * @param _operatorVCS address of OperatorVCS
     * @param _communityVCS address of CommunityVCS
     * @param _unbondingPeriod unbonding period as set in Chainlink staking contract
     * @param _claimPeriod claim period as set in Chainlink staking contract
     * @param _numVaultGroups total number of vault groups
     */
    function initialize(
        address _operatorVCS,
        address _communityVCS,
        uint64 _unbondingPeriod,
        uint64 _claimPeriod,
        uint64 _numVaultGroups
    ) public initializer {
        __UUPSUpgradeable_init();
        __Ownable_init();
        operatorVCS = IVaultControllerStrategy(_operatorVCS);
        communityVCS = IVaultControllerStrategy(_communityVCS);
        unbondingPeriod = _unbondingPeriod;
        claimPeriod = _claimPeriod;
        numVaultGroups = _numVaultGroups;
        for (uint256 i = 0; i < _numVaultGroups; ++i) {
            timeOfLastUpdateByGroup.push(0);
        }
    }

    /**
     * @notice Returns encoded vault deposit order for each strategy
     * @param _toDeposit amount to deposit
     * @return list of encoded vault deposit data
     */
    function getDepositData(uint256 _toDeposit) external view returns (bytes[] memory) {
        uint256 toDeposit = 2 * _toDeposit;
        bytes[] memory depositData = new bytes[](2);

        (
            uint64[] memory opVaultDepositOrder,
            uint256 opVaultsTotalToDeposit
        ) = _getVaultDepositOrder(operatorVCS, toDeposit);
        depositData[0] = abi.encode(opVaultDepositOrder);

        if (opVaultsTotalToDeposit < toDeposit) {
            (uint64[] memory comVaultDepositOrder, ) = _getVaultDepositOrder(
                communityVCS,
                toDeposit - opVaultsTotalToDeposit
            );
            depositData[1] = abi.encode(comVaultDepositOrder);
        } else {
            depositData[1] = abi.encode(new uint64[](0));
        }

        return depositData;
    }

    /**
     * @notice Returns encoded vault withdrawal order for each strategy
     * @param _toWithdraw amount to withdraw
     * @return list of encoded vault withdrawal data
     */
    function getWithdrawalData(uint256 _toWithdraw) external view returns (bytes[] memory) {
        uint256 toWithdraw = 2 * _toWithdraw;
        bytes[] memory withdrawalData = new bytes[](2);

        (
            uint64[] memory comVaultWithdrawalOrder,
            uint256 comVaultsTotalToWithdraw
        ) = _getVaultWithdrawalOrder(communityVCS, toWithdraw);
        withdrawalData[1] = abi.encode(comVaultWithdrawalOrder);

        if (comVaultsTotalToWithdraw < toWithdraw) {
            (uint64[] memory opVaultWithdrawalOrder, ) = _getVaultWithdrawalOrder(
                operatorVCS,
                toWithdraw - comVaultsTotalToWithdraw
            );
            withdrawalData[0] = abi.encode(opVaultWithdrawalOrder);
        } else {
            withdrawalData[0] = abi.encode(new uint64[](0));
        }

        return withdrawalData;
    }

    /**
     * @notice Returns whether claim period is active
     * @dev funds can only be withdrawn while the claim period is active
     * @return true of claim period is active, false otherwise
     */
    function claimPeriodActive() external view returns (bool) {
        uint256 claimPeriodStart = timeOfLastUpdateByGroup[curUnbondedVaultGroup] + unbondingPeriod;
        uint256 claimPeriodEnd = claimPeriodStart + claimPeriod;

        return block.timestamp >= claimPeriodStart && block.timestamp <= claimPeriodEnd;
    }

    /**
     * @notice  Executes a vault group update
     * @dev re-unbonds all vaults in the current vault group and increments the current vault group
     * to the next one which will have just entered the claim period
     * @dev an update is needed once per claim period right after the claim period expires for the
     * current vault group
     */
    function updateVaultGroups() external {
        uint256 nextUnbondedVaultGroup = _getNextGroup(curUnbondedVaultGroup, numVaultGroups);

        if (
            timeOfLastUpdateByGroup[nextUnbondedVaultGroup] != 0 &&
            block.timestamp <=
            timeOfLastUpdateByGroup[curUnbondedVaultGroup] + unbondingPeriod + claimPeriod
        ) revert NoUpdateNeeded();

        if (
            curUnbondedVaultGroup != 0 &&
            timeOfLastUpdateByGroup[curUnbondedVaultGroup] == 0 &&
            block.timestamp <= timeOfLastUpdateByGroup[curUnbondedVaultGroup - 1] + claimPeriod
        ) revert NoUpdateNeeded();

        if (block.timestamp < timeOfLastUpdateByGroup[nextUnbondedVaultGroup] + unbondingPeriod)
            revert NoUpdateNeeded();

        (
            uint256[] memory curGroupOpVaultsToUnbond,
            uint256 curGroupOpVaultsTotalDepositRoom,
            uint256 nextGroupOpVaultsTotalUnbonded
        ) = _getVaultUpdateData(operatorVCS, nextUnbondedVaultGroup);

        (
            uint256[] memory curGroupComVaultsToUnbond,
            uint256 curGroupComVaultsTotalDepositRoom,
            uint256 nextGroupComVaultsTotalUnbonded
        ) = _getVaultUpdateData(communityVCS, nextUnbondedVaultGroup);

        operatorVCS.updateVaultGroups(
            curGroupOpVaultsToUnbond,
            curGroupOpVaultsTotalDepositRoom,
            nextUnbondedVaultGroup,
            nextGroupOpVaultsTotalUnbonded
        );
        communityVCS.updateVaultGroups(
            curGroupComVaultsToUnbond,
            curGroupComVaultsTotalDepositRoom,
            nextUnbondedVaultGroup,
            nextGroupComVaultsTotalUnbonded
        );

        timeOfLastUpdateByGroup[curUnbondedVaultGroup] = uint64(block.timestamp);
        curUnbondedVaultGroup = uint64(nextUnbondedVaultGroup);
    }

    /**
     * @notice Calculates and updates totalDepositRoom and totalUnbonded for a list of operator vault groups
     * @param _vaultGroups list of vault groups
     */
    function updateOperatorVaultGroupAccounting(uint256[] calldata _vaultGroups) external {
        address[] memory vaults = operatorVCS.getVaults();
        (, uint256 maxDeposits) = operatorVCS.getVaultDepositLimits();
        (, , , uint64 depositIndex) = operatorVCS.globalVaultState();

        uint256[] memory totalDepositRoom = new uint256[](_vaultGroups.length);
        uint256 totalUnbonded = operatorVCS.totalUnbonded();

        for (uint256 i = 0; i < _vaultGroups.length; ++i) {
            (uint256 depositRoom, ) = _getTotalDepositRoom(
                vaults,
                numVaultGroups,
                _vaultGroups[i],
                maxDeposits,
                depositIndex
            );
            totalDepositRoom[i] = depositRoom;

            if (_vaultGroups[i] == curUnbondedVaultGroup) {
                totalUnbonded = _getTotalUnbonded(vaults, numVaultGroups, _vaultGroups[i]);
            }
        }

        IOperatorVCS(address(operatorVCS)).updateVaultGroupAccounting(
            _vaultGroups,
            totalDepositRoom,
            totalUnbonded,
            maxDeposits
        );
    }

    /**
     * @notice Returns the vault deposit order for a strategy
     * @param _vcs strategy
     * @param _toDeposit amount to deposit
     * @return vault deposit order
     * @return total deposit space across returned vaults
     */
    function _getVaultDepositOrder(
        IVaultControllerStrategy _vcs,
        uint256 _toDeposit
    ) internal view returns (uint64[] memory, uint256) {
        address[] memory vaults = _vcs.getVaults();
        if (vaults.length == 0) return (new uint64[](0), 0);

        uint256[] memory depositRoom = new uint256[](numVaultGroups);

        for (uint256 i = 0; i < numVaultGroups; ++i) {
            (, uint256 totalDepositRoom) = _vcs.vaultGroups(i);
            depositRoom[i] = totalDepositRoom;
        }

        (, , uint64 groupDepositIndex, uint64 maxVaultIndex) = _vcs.globalVaultState();
        uint256 maxDeposits = _vcs.vaultMaxDeposits();
        uint256[] memory groupDepositOrder = _sortIndexesDescending(depositRoom);

        uint256[] memory vaultDepositOrder = new uint256[](vaults.length);
        uint256 totalVaultsAdded;
        uint256 totalDepositsAdded;

        if (groupDepositIndex < maxVaultIndex) {
            vaultDepositOrder[0] = groupDepositIndex;
            ++totalVaultsAdded;
            (uint256 withdrawalIndex, ) = _vcs.vaultGroups(groupDepositIndex % numVaultGroups);
            uint256 deposits = IVault(vaults[groupDepositIndex]).getPrincipalDeposits();
            if (
                deposits != maxDeposits && (groupDepositIndex != withdrawalIndex || deposits == 0)
            ) {
                totalDepositsAdded += maxDeposits - deposits;
            }
        }

        for (uint256 i = 0; i < numVaultGroups; ++i) {
            (uint256 withdrawalIndex, ) = _vcs.vaultGroups(groupDepositOrder[i]);

            for (uint256 j = groupDepositOrder[i]; j < maxVaultIndex; j += numVaultGroups) {
                uint256 deposits = IVault(vaults[j]).getPrincipalDeposits();
                if (j != groupDepositIndex && deposits != maxDeposits) {
                    vaultDepositOrder[totalVaultsAdded] = j;
                    ++totalVaultsAdded;
                    if (j != withdrawalIndex || deposits == 0)
                        totalDepositsAdded += maxDeposits - deposits;
                    if (totalDepositsAdded >= _toDeposit) break;
                }
            }

            if (totalDepositsAdded >= _toDeposit) break;
        }

        if (totalDepositsAdded == 0) return (new uint64[](0), 0);

        uint64[] memory vaultDepositOrderFormatted = new uint64[](totalVaultsAdded);
        for (uint256 i = 0; i < totalVaultsAdded; ++i) {
            vaultDepositOrderFormatted[i] = uint64(vaultDepositOrder[i]);
        }

        return (vaultDepositOrderFormatted, totalDepositsAdded);
    }

    /**
     * @notice Returns the vaut withdrawal order for a strategy
     * @param _vcs strategy
     * @param _toWithdraw amount to withdraw
     * @return vault withdrawal order
     * @return total withdrawal space across returned vaults
     */
    function _getVaultWithdrawalOrder(
        IVaultControllerStrategy _vcs,
        uint256 _toWithdraw
    ) internal view returns (uint64[] memory, uint256) {
        address[] memory vaults = _vcs.getVaults();
        (, , , uint64 maxVaultIndex) = _vcs.globalVaultState();
        (uint64 withdrawalIndex, ) = _vcs.vaultGroups(curUnbondedVaultGroup);

        uint256[] memory vaultWithdrawalOrder = new uint256[](vaults.length);
        uint256 totalVaultsAdded;
        uint256 totalWithdrawsAdded;

        if (withdrawalIndex < maxVaultIndex) {
            vaultWithdrawalOrder[0] = withdrawalIndex;
            ++totalVaultsAdded;
            totalWithdrawsAdded += IVault(vaults[withdrawalIndex]).getPrincipalDeposits();
        }

        for (uint256 i = curUnbondedVaultGroup; i < maxVaultIndex; i += numVaultGroups) {
            IVault vault = IVault(vaults[i]);
            uint256 deposits = vault.getPrincipalDeposits();

            if (i != withdrawalIndex && deposits != 0 && vault.claimPeriodActive()) {
                vaultWithdrawalOrder[totalVaultsAdded] = i;
                totalWithdrawsAdded += deposits;
                totalVaultsAdded++;
            }

            if (totalWithdrawsAdded >= _toWithdraw) break;
        }

        if (totalWithdrawsAdded == 0) return (new uint64[](0), 0);

        uint64[] memory vaultWithdrawalOrderFormatted = new uint64[](totalVaultsAdded);
        for (uint256 i = 0; i < totalVaultsAdded; ++i) {
            vaultWithdrawalOrderFormatted[i] = uint64(vaultWithdrawalOrder[i]);
        }

        return (vaultWithdrawalOrderFormatted, totalWithdrawsAdded);
    }

    /**
     * @notice Returns data needed to execute a vault group update for a strategy
     * @param _vcs strategy
     * @param _nextUnbondedVaultGroup index of next unbonded vault group
     * @return list of vaults to unbond in current vault group
     * @return total deposit room across all vaults in current vault group
     * @return total unbonded across all vaults in next vault group
     */
    function _getVaultUpdateData(
        IVaultControllerStrategy _vcs,
        uint256 _nextUnbondedVaultGroup
    ) internal view returns (uint256[] memory, uint256, uint256) {
        address[] memory vaults = _vcs.getVaults();
        (, , , uint64 depositIndex) = _vcs.globalVaultState();

        (
            uint256 curGroupTotalDepositRoom,
            uint256[] memory curGroupVaultsToUnbond
        ) = _getTotalDepositRoom(
                vaults,
                numVaultGroups,
                curUnbondedVaultGroup,
                _vcs.vaultMaxDeposits(),
                depositIndex
            );

        uint256 nextGroupTotalUnbonded = _getTotalUnbonded(
            vaults,
            numVaultGroups,
            _nextUnbondedVaultGroup
        );

        return (curGroupVaultsToUnbond, curGroupTotalDepositRoom, nextGroupTotalUnbonded);
    }

    /**
     * @notice Returns the total deposit room and a list of non-empty vaults for a vault group
     * @param _vaults list of all vaults
     * @param _numVaultGroups total number of vault groups
     * @param _vaultGroup index of vault group
     * @param _vaultMaxDeposits max deposits per vault
     * @return total deposit room
     * @return list of non-empty vaults
     */
    function _getTotalDepositRoom(
        address[] memory _vaults,
        uint256 _numVaultGroups,
        uint256 _vaultGroup,
        uint256 _vaultMaxDeposits,
        uint256 _depositIndex
    ) internal view returns (uint256, uint256[] memory) {
        uint256 totalDepositRoom;
        uint256 numNonEmptyVaults;
        uint256[] memory nonEmptyVaults = new uint256[](_vaults.length);

        for (uint256 i = _vaultGroup; i < _depositIndex; i += _numVaultGroups) {
            if (IVault(_vaults[i]).isRemoved()) continue;

            uint256 principalDeposits = IVault(_vaults[i]).getPrincipalDeposits();
            totalDepositRoom += _vaultMaxDeposits - principalDeposits;
            if (principalDeposits != 0) {
                nonEmptyVaults[numNonEmptyVaults] = i;
                numNonEmptyVaults++;
            }
        }

        uint256[] memory nonEmptyVaultsFormatted = new uint256[](numNonEmptyVaults);
        for (uint256 i = 0; i < numNonEmptyVaults; ++i) {
            nonEmptyVaultsFormatted[i] = nonEmptyVaults[i];
        }

        return (totalDepositRoom, nonEmptyVaultsFormatted);
    }

    /**
     * @notice Returns a the total amount unbonded for a vault group
     * @param _vaults list of all vaults
     * @param _numVaultGroups total number of vault groups
     * @param _vaultGroup index of vault group
     * @return total unbonded
     */
    function _getTotalUnbonded(
        address[] memory _vaults,
        uint256 _numVaultGroups,
        uint256 _vaultGroup
    ) internal view returns (uint256) {
        uint256 totalUnbonded;

        for (uint256 i = _vaultGroup; i < _vaults.length; i += _numVaultGroups) {
            if (!IVault(_vaults[i]).claimPeriodActive() || IVault(_vaults[i]).isRemoved()) continue;

            totalUnbonded += IVault(_vaults[i]).getPrincipalDeposits();
        }

        return totalUnbonded;
    }

    /**
     * @notice Returns the index of the next vault group
     * @param _curGroup index of current vault group
     * @param _numGroups total number of vault groups
     */
    function _getNextGroup(uint256 _curGroup, uint256 _numGroups) internal pure returns (uint256) {
        return _curGroup == _numGroups - 1 ? 0 : _curGroup + 1;
    }

    /**
     * @notice Returns a sorted list of indexes for a list of values in descending order
     * @param _values list of values
     * @return sorted list of indexes
     */
    function _sortIndexesDescending(
        uint256[] memory _values
    ) internal pure returns (uint256[] memory) {
        uint256 n = _values.length;

        uint256[] memory indexes = new uint256[](n);
        for (uint256 i = 0; i < n; ++i) {
            indexes[i] = i;
        }

        for (uint256 i = 0; i < n - 1; ++i) {
            for (uint256 j = 0; j < n - i - 1; ++j) {
                if (_values[j] < _values[j + 1]) {
                    (_values[j], _values[j + 1]) = (_values[j + 1], _values[j]);
                    (indexes[j], indexes[j + 1]) = (indexes[j + 1], indexes[j]);
                }
            }
        }

        return indexes;
    }

    /**
     * @dev Checks authorization for contract upgrades
     */
    function _authorizeUpgrade(address) internal override onlyOwner {}
}
