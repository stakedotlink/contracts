// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "./base/VaultControllerStrategy.sol";

/**
 * @title Operator Vault Controller Strategy
 * @notice Implemented strategy for managing multiple Chainlink operator staking vaults
 */
contract OperatorVCS is VaultControllerStrategy {
    uint private totalPrincipalDeposits;

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
        address[] calldata _initialVaults
    ) public initializer {
        __VaultControllerStrategy_init(
            _token,
            _stakingPool,
            _stakeController,
            _vaultImplementation,
            _minDepositThreshold,
            _fees
        );
        for (uint i = 0; i < _initialVaults.length; i++) {
            address vault = _initialVaults[i];
            vaults.push(IVault(vault));
            token.approve(vault, type(uint256).max);
        }
    }

    /**
     * @notice maximum amount of tokens that can be deposited into this strategy
     * @return uint max deposits
     */
    function getMaxDeposits() public view override returns (uint) {
        (, uint vaultMaxDeposits) = getVaultDepositLimits();
        return totalDeposits + vaultMaxDeposits * vaults.length - (totalPrincipalDeposits + bufferedDeposits);
    }

    /**
     * @notice minimum amount of tokens that must remain in this strategy
     * @return uint min deposits
     */
    function getMinDeposits() public view override returns (uint) {
        return totalDeposits;
    }

    function getVaultDepositLimits() public view override returns (uint, uint) {
        return stakeController.getOperatorLimits();
    }

    function _depositBufferedTokens(
        uint _startIndex,
        uint _toDeposit,
        uint _vaultMinDeposits,
        uint _vaultMaxDeposits
    ) internal override {
        uint deposited = _depositToVaults(_startIndex, _toDeposit, _vaultMinDeposits, _vaultMaxDeposits);
        totalPrincipalDeposits += deposited;
        bufferedDeposits -= deposited;
    }
}
