// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "./base/VaultControllerStrategy.sol";
import "./interfaces/ICommunityVault.sol";

/**
 * @title Community Vault Controller Strategy
 * @notice Implemented strategy for managing multiple Chainlink community staking vaults
 */
contract CommunityVCS is VaultControllerStrategy {
    uint128 public vaultDeploymentThreshold;
    uint128 public vaultDeploymentAmount;

    event SetVaultDeploymentParams(uint128 vaultDeploymentThreshold, uint128 vaultDeploymentAmount);

    error VaultsAboveThreshold();

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
     * @param _maxDepositSizeBP basis point amount of the remaing deposit room in the Chainlink staking contract
     * that can be deposited at once
     * @param _vaultMaxDeposits maximum deposit limit for a single vault
     * @param _vaultDeploymentThreshold the min number of non-full vaults before a new batch is deployed
     * @param _vaultDeploymentAmount amount of vaults to deploy when threshold is met
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
        uint128 _vaultDeploymentAmount
    ) public initializer {
        if (address(token) == address(0)) {
            __VaultControllerStrategy_init(
                _token,
                _stakingPool,
                _stakeController,
                _vaultImplementation,
                _fees,
                _maxDepositSizeBP,
                _vaultMaxDeposits
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
     * @notice Claims Chanlink staking rewards from vaults
     * @param _vaults list if vault indexes to claim from
     * @param _minRewards min amount of rewards per vault required to claim
     */
    function claimRewards(
        uint256[] calldata _vaults,
        uint256 _minRewards
    ) external returns (uint256) {
        address receiver = address(this);
        uint256 balanceBefore = token.balanceOf(address(this));
        for (uint256 i = 0; i < _vaults.length; ++i) {
            ICommunityVault(address(vaults[_vaults[i]])).claimRewards(_minRewards, receiver);
        }
        uint256 balanceAfter = token.balanceOf(address(this));
        return balanceAfter - balanceBefore;
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
     * @notice Deploys new vaults
     * @param _numVaults number of vaults to deploy
     */
    function _deployVaults(uint256 _numVaults) internal {
        bytes memory data = abi.encodeWithSignature(
            "initialize(address,address,address,address)",
            address(token),
            address(this),
            address(stakeController),
            stakeController.getRewardVault()
        );
        for (uint256 i = 0; i < _numVaults; i++) {
            _deployVault(data);
        }
    }
}
