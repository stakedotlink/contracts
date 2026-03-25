// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

import "./base/VaultControllerStrategy.sol";
import "./interfaces/ICommunityVault.sol";

/**
 * @title Community Vault Controller Strategy
 * @notice Implemented strategy for managing multiple Chainlink community staking vaults
 */
contract CommunityVCS is VaultControllerStrategy {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // min number of non-full vaults before a new batch is deployed
    uint128 public vaultDeploymentThreshold;
    // number of vaults to deploy when threshold is met
    uint128 public vaultDeploymentAmount;

    // number of vaults to process per batch during deposit updates
    uint64 public vaultsPerBatch;
    // index of the next vault to be processed in the current update
    uint64 public currentVaultIndex;
    // running accumulator of vault deposits across batched calls
    uint128 public totalVaultDepositsAccum;

    // address authorized to initiate vault deposit updates
    address public depositUpdater;

    event SetVaultDeploymentParams(uint128 vaultDeploymentThreshold, uint128 vaultDeploymentAmount);
    event SetVaultsPerBatch(uint64 vaultsPerBatch);
    event SetDepositUpdater(address depositUpdater);

    error VaultsAboveThreshold();
    error DepositUpdateInProgress();
    error DepositUpdateNotReady();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes contract
     * @param _token address of LINK token
     * @param _stakingPool address of the staking pool that controls this strategy
     * @param _stakeController address of Chainlink staking contract
     * @param _vaultImplementation address of the implementation contract to use when deploying new vaults
     * @param _fees list of fees to be paid on rewards
     * @param _maxDepositSizeBP max basis point amount of the deposit room in the Chainlink staking contract
     * that can be deposited at once
     * @param _vaultMaxDeposits max number of tokens that a vault can hold
     * @param _vaultDeploymentThreshold min number of non-full vaults before a new batch is deployed
     * @param _vaultDeploymentAmount number of vaults to deploy when threshold is met
     * @param _vaultDepositController address of vault deposit controller
     *
     */
    function initialize(
        address _token,
        address _stakingPool,
        address _stakeController,
        address _vaultImplementation,
        Fee[] memory _fees,
        uint256 _maxDepositSizeBP,
        uint256 _vaultMaxDeposits,
        uint128 _vaultDeploymentThreshold,
        uint128 _vaultDeploymentAmount,
        address _vaultDepositController
    ) public reinitializer(2) {
        if (address(token) == address(0)) {
            __VaultControllerStrategy_init(
                _token,
                _stakingPool,
                _stakeController,
                _vaultImplementation,
                _fees,
                _maxDepositSizeBP,
                _vaultMaxDeposits,
                _vaultDepositController
            );
            vaultDeploymentThreshold = _vaultDeploymentThreshold;
            vaultDeploymentAmount = _vaultDeploymentAmount;
            _deployVaults(_vaultDeploymentAmount);
            globalVaultState = GlobalVaultState(5, 0, 0, 0);
        } else {
            globalVaultState = GlobalVaultState(5, 0, 0, uint64(maxDepositSizeBP + 1));
            maxDepositSizeBP = _maxDepositSizeBP;
            delete fundFlowController;
            vaultMaxDeposits = _vaultMaxDeposits;
        }

        for (uint64 i = 0; i < 5; ++i) {
            vaultGroups.push(VaultGroup(i, 0));
        }
    }

    /**
     * @notice Reverts if a batched deposit update is in progress
     */
    modifier notDuringDepositUpdate() {
        if (currentVaultIndex != 0) revert DepositUpdateInProgress();
        _;
    }

    /**
     * @notice Deposits tokens from the staking pool into vaults
     * @param _amount amount to deposit
     * @param _data encoded vault deposit order
     */
    function deposit(
        uint256 _amount,
        bytes calldata _data
    ) external override onlyStakingPool notDuringDepositUpdate {
        (, uint256 maxDeposits) = getVaultDepositLimits();

        // if vault deposit limit has changed in Chainlink staking contract, make adjustments
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

            vaultMaxDeposits = maxDeposits;
        }

        if (vaultDepositController == address(0)) revert VaultDepositControllerNotSet();

        (bool success, ) = vaultDepositController.delegatecall(
            abi.encodeWithSelector(VaultDepositController.deposit.selector, _amount, _data)
        );

        if (!success) revert DepositFailed();
    }

    /**
     * @notice Withdraws tokens from vaults and sends them to staking pool
     * @param _amount amount to withdraw
     * @param _data encoded vault withdrawal order
     */
    function withdraw(
        uint256 _amount,
        bytes calldata _data
    ) public override onlyStakingPool notDuringDepositUpdate {
        super.withdraw(_amount, _data);
    }

    /**
     * @notice Claims Chanlink staking rewards from vaults
     * @param _vaults list if vault indexes to claim from
     * @param _minRewards min amount of rewards per vault required to claim
     */
    function claimRewards(
        uint256[] calldata _vaults,
        uint256 _minRewards
    ) external notDuringDepositUpdate returns (uint256) {
        address receiver = address(this);
        uint256 balanceBefore = token.balanceOf(address(this));
        for (uint256 i = 0; i < _vaults.length; ++i) {
            ICommunityVault(address(vaults[_vaults[i]])).claimRewards(_minRewards, receiver);
        }
        uint256 balanceAfter = token.balanceOf(address(this));
        return balanceAfter - balanceBefore;
    }

    /**
     * @notice Returns the available deposit room for this strategy
     * @return available deposit room (0 if a batched deposit update is in progress)
     */
    function canDeposit() public view override returns (uint256) {
        if (currentVaultIndex != 0) return 0;
        return super.canDeposit();
    }

    /**
     * @notice Returns the available withdrawal room for this strategy
     * @return available withdrawal room (0 if a batched deposit update is in progress)
     */
    function canWithdraw() public view override returns (uint256) {
        if (currentVaultIndex != 0) return 0;
        return super.canWithdraw();
    }

    /**
     * @notice Returns the maximum amount of tokens this strategy can hold
     * @return maximum deposits
     */
    function getMaxDeposits() public view virtual override returns (uint256) {
        return stakeController.getMerkleRoot() == bytes32(0) ? super.getMaxDeposits() : 0;
    }

    /**
     * @notice Returns whether a new batch of vaults should be deployed
     * @return true if new batch should be deployed, false otherwise
     */
    function checkUpkeep(bytes calldata) external view returns (bool, bytes memory) {
        return (
            (vaults.length - globalVaultState.depositIndex) < vaultDeploymentThreshold,
            bytes("")
        );
    }

    /**
     * @notice Deploys a new batch of vaults
     */
    function performUpkeep(bytes calldata) external {
        if ((vaults.length - globalVaultState.depositIndex) >= vaultDeploymentThreshold)
            revert VaultsAboveThreshold();
        _deployVaults(vaultDeploymentAmount);
    }

    /**
     * @notice Deploys a new batch of vaults
     * @param _numVaults number of vaults to deploy
     */
    function addVaults(uint256 _numVaults) external onlyOwner {
        _deployVaults(_numVaults);
    }

    /**
     * @notice Processes the next batch of vaults for a deposit update
     * @dev accumulates getTotalDeposits() for the next `vaultsPerBatch` vaults.
     * While an update is in progress, deposits, withdrawals, and reward claims are blocked.
     */
    function updateVaultDeposits() external {
        if (currentVaultIndex == 0 && msg.sender != depositUpdater) revert SenderNotAuthorized();

        uint256 numVaults = vaults.length;
        uint64 startIndex = currentVaultIndex;
        uint64 batchSize = vaultsPerBatch;
        uint256 endIndex = startIndex + batchSize;
        if (endIndex > numVaults) endIndex = numVaults;

        uint256 total;
        for (uint256 i = startIndex; i < endIndex; ++i) {
            total += vaults[i].getTotalDeposits();
        }

        totalVaultDepositsAccum += uint128(total);
        currentVaultIndex = uint64(endIndex);
    }

    /**
     * @notice Updates deposit accounting and calculates fees on newly earned rewards
     * @dev can only be called after all vault deposit batches have been processed
     * @return depositChange change in deposits since last update
     * @return receivers list of fee receivers
     * @return amounts list of fee amounts
     */
    function updateDeposits(
        bytes calldata _data
    )
        external
        override
        onlyStakingPool
        returns (int256 depositChange, address[] memory receivers, uint256[] memory amounts)
    {
        if (vaultsPerBatch == 0) {
            // batching not configured, use default behavior
            depositChange = getDepositChange();
        } else {
            if (currentVaultIndex < vaults.length) revert DepositUpdateNotReady();

            uint256 totalBalance = uint256(totalVaultDepositsAccum) +
                token.balanceOf(address(this));

            currentVaultIndex = 0;
            totalVaultDepositsAccum = 0;

            depositChange = int(totalBalance) - int(totalDeposits);
        }

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
     * @notice Sets the vault deployment parameters
     * @param _vaultDeploymentThreshold the min number of non-full vaults before a new batch is deployed
     * @param _vaultDeploymentAmount amount of vaults to deploy when threshold is met
     */
    function setVaultDeploymentParams(
        uint128 _vaultDeploymentThreshold,
        uint128 _vaultDeploymentAmount
    ) external onlyOwner {
        vaultDeploymentThreshold = _vaultDeploymentThreshold;
        vaultDeploymentAmount = _vaultDeploymentAmount;
        emit SetVaultDeploymentParams(_vaultDeploymentThreshold, _vaultDeploymentAmount);
    }

    /**
     * @notice Sets the number of vaults to process per batch during deposit updates
     * @param _vaultsPerBatch number of vaults per batch
     */
    function setVaultsPerBatch(uint64 _vaultsPerBatch) external onlyOwner notDuringDepositUpdate {
        vaultsPerBatch = _vaultsPerBatch;
        emit SetVaultsPerBatch(_vaultsPerBatch);
    }

    /**
     * @notice Sets the address authorized to initiate vault deposit updates
     * @param _depositUpdater address of the deposit updater
     */
    function setDepositUpdater(address _depositUpdater) external onlyOwner {
        depositUpdater = _depositUpdater;
        emit SetDepositUpdater(_depositUpdater);
    }

    /**
     * @notice Deploys new vaults
     * @param _numVaults number of vaults to deploy
     */
    function _deployVaults(uint256 _numVaults) internal {
        bytes memory data = abi.encodeWithSignature(
            "initialize(address,address,address,address,address)",
            address(token),
            address(this),
            address(stakeController),
            stakeController.getRewardVault(),
            delegateRegistry
        );
        for (uint256 i = 0; i < _numVaults; i++) {
            _deployVault(data);
        }
    }
}
