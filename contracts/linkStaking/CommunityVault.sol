// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "./base/Vault.sol";

/**
 * @title Community Vault
 * @notice Vault contract for depositing LINK collateral into the Chainlink staking controller as a community staker
 */
contract CommunityVault is Vault {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _token,
        address _vaultController,
        address _stakeController
    ) public initializer {
        __Vault_init(_token, _vaultController, _stakeController);
    }

    /**
     * @notice returns the total balance of this contract in the Chainlink staking contract
     * @return total balance
     */
    function getTotalDeposits() public view override returns (uint) {
        return stakeController.getStake(address(this)) + stakeController.getBaseReward(address(this));
    }
}
