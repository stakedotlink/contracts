// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "../base/VaultControllerStrategy.sol";

/**
 * @title Mock Vault Controller Strategy
 * @dev Mocks contract for testing
 */
contract VCSMock is VaultControllerStrategy {
    uint private totalPrincipalDeposits;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _token,
        address _stakingPool,
        address _stakeController,
        uint _minDepositThreshold,
        Fee[] memory _fees,
        address[] calldata _initialVaults
    ) public initializer {
        __VaultControllerStrategy_init(_token, _stakingPool, _stakeController, _minDepositThreshold, _fees);
        for (uint i = 0; i < _initialVaults.length; i++) {
            address vault = _initialVaults[i];
            vaults.push(IVault(vault));
            token.approve(vault, type(uint256).max);
        }
    }

    function getMaxDeposits() public view override returns (uint) {
        return totalDeposits;
    }

    function getMinDeposits() public view override returns (uint) {
        return totalDeposits;
    }

    function getVaultDepositLimits() public view override returns (uint, uint) {
        return stakeController.getOperatorLimits();
    }

    function depositToVaults(
        uint _startIndex,
        uint _toDeposit,
        uint _vaultMinDeposits,
        uint _vaultMaxDeposits
    ) external returns (uint) {
        return _depositToVaults(_startIndex, _toDeposit, _vaultMinDeposits, _vaultMaxDeposits);
    }

    function getBufferedDeposits() external view returns (uint) {
        return bufferedDeposits;
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
