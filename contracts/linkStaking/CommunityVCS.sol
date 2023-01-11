// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "./base/VaultControllerStrategy.sol";

/**
 * @title Community Vault Controller Strategy
 * @notice Implemented strategy for managing multiple Chainlink community staking vaults
 */
contract CommunityVCS is VaultControllerStrategy {
    uint256 private maxDeposits;
    uint256 public maxVaultDeployments;

    event SetMaxDeposits(uint256 maxDeposits);
    event SetMaxVaultDeployments(uint256 maxVaultDeployments);
    event DepositBufferedTokens(uint256 amountDeposited, uint256 vaultsDeployed);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _token,
        address _stakingPool,
        address _stakeController,
        address _vaultImplementation,
        uint256 _minDepositThreshold,
        Fee[] memory _fees,
        uint256 _maxDeposits,
        uint256 _maxVaultDeployments
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
        _deployVaults(1);
    }

    /**
     * @notice returns the maximum that can be deposited into this strategy
     * @return maximum deposits
     */
    function getMaxDeposits() public view override returns (uint256) {
        return maxDeposits;
    }

    /**
     * @notice returns the minimum that must remain this strategy
     * @return minimum deposits
     */
    function getMinDeposits() public view override returns (uint256) {
        return totalDeposits;
    }

    /**
     * @notice returns the vault deposit limits
     * @return minimum amount of deposits that a vault can hold
     * @return maximum amount of deposits that a vault can hold
     */
    function getVaultDepositLimits() public view override returns (uint256, uint256) {
        return stakeController.getCommunityStakerLimits();
    }

    /**
     * @notice sets the maximum that can be deposited into this strategy
     * @param _maxDeposits maximum amount
     */
    function setMaxDeposits(uint256 _maxDeposits) external onlyOwner {
        maxDeposits = _maxDeposits;
        emit SetMaxDeposits(_maxDeposits);
    }

    /**
     * @notice sets the maximum number of vaults that can be deployed at once
     * @param _maxVaultDeployments maximum amount
     */
    function setMaxVaultDeployments(uint256 _maxVaultDeployments) external onlyOwner {
        maxVaultDeployments = _maxVaultDeployments;
        emit SetMaxVaultDeployments(_maxVaultDeployments);
    }

    /**
     * @notice deposits buffered tokens into vaults
     * @param _startIndex index of first vault to deposit into
     * @param _toDeposit amount to deposit
     * @param _vaultMinDeposits minimum amount of deposits that a vault can hold
     * @param _vaultMaxDeposits minimum amount of deposits that a vault can hold
     */
    function _depositBufferedTokens(
        uint256 _startIndex,
        uint256 _toDeposit,
        uint256 _vaultMinDeposits,
        uint256 _vaultMaxDeposits
    ) internal override {
        uint256 deposited = _depositToVaults(_startIndex, _toDeposit, _vaultMinDeposits, _vaultMaxDeposits);
        require(
            deposited >= minDepositThreshold || vaults[vaults.length - 1].getPrincipalDeposits() >= _vaultMaxDeposits,
            "Invalid deposit"
        );

        uint256 toDepositRemaining = _toDeposit - deposited;
        uint256 vaultsToDeploy = toDepositRemaining / _vaultMaxDeposits;
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
        emit DepositBufferedTokens(deposited, vaultsToDeploy);
    }

    /**
     * @notice deploys new vaults
     * @param _numVaults number of vaults to deploy
     */
    function _deployVaults(uint256 _numVaults) internal {
        bytes memory data = abi.encodeWithSignature(
            "initialize(address,address,address)",
            address(token),
            address(this),
            address(stakeController)
        );
        for (uint256 i = 0; i < _numVaults; i++) {
            _deployVault(data);
        }
    }
}
