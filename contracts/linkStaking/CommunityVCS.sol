// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "./base/VaultControllerStrategy.sol";

/**
 * @title Community Vault Controller Strategy
 * @notice Implemented strategy for managing multiple Chainlink community staking vaults
 */
contract CommunityVCS is VaultControllerStrategy {
    uint private maxDeposits;
    uint public maxVaultDeployments;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _token,
        address _stakingPool,
        address _stakeController,
        address _vaultImplementation,
        uint _minDepositThreshold,
        Fee[] memory _fees,
        uint _maxDeposits,
        uint _maxVaultDeployments
    ) public initializer {
        __VaultControllerStrategy_init(
            _token,
            _stakingPool,
            _stakeController,
            _vaultImplementation,
            _minDepositThreshold,
            _fees
        );
        maxDeposits = _maxDeposits;
        maxVaultDeployments = _maxVaultDeployments;
    }

    /**
     * @notice maximum amount of tokens that can be deposited into this strategy
     * @return uint max deposits
     */
    function getMaxDeposits() public view override returns (uint) {
        return maxDeposits;
    }

    /**
     * @notice minimum amount of tokens that must remain in this strategy
     * @return uint min deposits
     */
    function getMinDeposits() public view override returns (uint) {
        return totalDeposits;
    }

    function getVaultDepositLimits() public view override returns (uint, uint) {
        return stakeController.getCommunityStakerLimits();
    }

    function setMaxDeposits(uint _maxDeposits) external onlyOwner {
        maxDeposits = _maxDeposits;
    }

    function setMaxVaultDeployments(uint _maxVaultDeployments) external onlyOwner {
        maxVaultDeployments = _maxVaultDeployments;
    }

    function _depositBufferedTokens(
        uint _startIndex,
        uint _toDeposit,
        uint _vaultMinDeposits,
        uint _vaultMaxDeposits
    ) internal override {
        uint deposited = _depositToVaults(_startIndex, _toDeposit, _vaultMinDeposits, _vaultMaxDeposits);
        require(
            deposited >= minDepositThreshold || vaults[vaults.length - 1].getPrincipalDeposits() >= _vaultMaxDeposits,
            "Invalid deposit"
        );

        uint toDepositRemaining = _toDeposit - deposited;
        uint vaultsToDeploy = toDepositRemaining / _vaultMaxDeposits;
        if (toDepositRemaining % _vaultMaxDeposits >= _vaultMinDeposits) {
            vaultsToDeploy += 1;
        }

        if (vaultsToDeploy > 0) {
            if (vaultsToDeploy > maxVaultDeployments) {
                vaultsToDeploy = maxVaultDeployments;
            }
            _deployVaults(vaultsToDeploy);
            deposited += _depositToVaults(
                vaults.length - vaultsToDeploy,
                toDepositRemaining,
                _vaultMinDeposits,
                _vaultMaxDeposits
            );
        }

        bufferedDeposits -= deposited;
    }

    function _deployVaults(uint _numVaults) internal {
        //TODO: implement
    }
}
