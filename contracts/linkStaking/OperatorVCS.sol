// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "./base/VaultControllerStrategy.sol";

/**
 * @title Operator Vault Controller Strategy
 * @notice Implemented strategy for managing multiple Chainlink operator staking vaults
 */
contract OperatorVCS is VaultControllerStrategy {
    uint private totalPrincipalDeposits;

    event VaultAdded(address indexed operator);
    event DepositBufferedTokens(uint depositedAmount);

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
     * @notice returns the maximum that can be deposited into this strategy
     * @return max deposit
     */
    function getMaxDeposits() public view override returns (uint) {
        (, uint vaultMaxDeposits) = getVaultDepositLimits();
        return totalDeposits + vaultMaxDeposits * vaults.length - (totalPrincipalDeposits + bufferedDeposits);
    }

    /**
     * @notice returns the minimum that must remain this strategy
     * @return min deposit
     */
    function getMinDeposits() public view override returns (uint) {
        return totalDeposits;
    }

    /**
     * @notice returns the vault deposit limits
     * @return minimum minimum amount of deposits that a vault can hold
     * @return maximum maximum amount of deposits that a vault can hold
     */
    function getVaultDepositLimits() public view override returns (uint, uint) {
        return stakeController.getOperatorLimits();
    }

    /**
     * @notice deploys a new vault
     * @param _operator address of operator that the vault represents
     */
    function addVault(address _operator) external onlyOwner {
        bytes memory data = abi.encodeWithSignature(
            "initialize(address,address,address,address)",
            address(token),
            address(this),
            address(stakeController),
            _operator
        );
        _deployVault(data);
        emit VaultAdded(_operator);
    }

    /**
     * @notice deposits buffered tokens into vaults
     * @param _startIndex index of first vault to deposit into
     * @param _toDeposit amount to deposit
     * @param _vaultMinDeposits minimum amount of deposits that a vault can hold
     * @param _vaultMaxDeposits minimum amount of deposits that a vault can hold
     */
    function _depositBufferedTokens(
        uint _startIndex,
        uint _toDeposit,
        uint _vaultMinDeposits,
        uint _vaultMaxDeposits
    ) internal override {
        uint deposited = _depositToVaults(_startIndex, _toDeposit, _vaultMinDeposits, _vaultMaxDeposits);
        totalPrincipalDeposits += deposited;
        bufferedDeposits -= deposited;
        emit DepositBufferedTokens(deposited);
    }
}
