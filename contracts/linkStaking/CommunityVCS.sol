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
        _deployVaults(1);
    }

    /**
     * @notice returns the maximum that can be deposited into this strategy
     * @return max deposit
     */
    function getMaxDeposits() public view override returns (uint) {
        return maxDeposits;
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
        return stakeController.getCommunityStakerLimits();
    }

    /**
     * @notice sets the maximum that can be deposited into this strategy
     * @param _maxDeposits maximum amount
     */
    function setMaxDeposits(uint _maxDeposits) external onlyOwner {
        maxDeposits = _maxDeposits;
    }

    /**
     * @notice sets the maximum number of vaults that can be deployed at once
     * @param _maxVaultDeployments maximum amount
     */
    function setMaxVaultDeployments(uint _maxVaultDeployments) external onlyOwner {
        maxVaultDeployments = _maxVaultDeployments;
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

    /**
     * @notice deploys new vaults
     * @param _numVaults number of vaults to deploy
     */
    function _deployVaults(uint _numVaults) internal {
        bytes memory data = abi.encodeWithSignature(
            "initialize(address,address,address)",
            address(token),
            address(this),
            address(stakeController)
        );
        for (uint i = 0; i < _numVaults; i++) {
            _deployVault(data);
        }
    }
}
