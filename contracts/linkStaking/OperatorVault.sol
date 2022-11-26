// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "./base/Vault.sol";

/**
 * @title Operator Vault
 * @notice Vault contract for depositing LINK collateral into the Chainlink staking controller as an operator
 */
contract OperatorVault is Vault {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    address public operator;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _token,
        address _vaultController,
        address _stakeController,
        address _operator
    ) public initializer {
        __Vault_init(_token, _vaultController, _stakeController);
        operator = _operator;
    }

    modifier onlyOperator() {
        require(operator == msg.sender, "Operator only");
        _;
    }

    /**
     * @notice returns the total balance of this contract in the Chainlink staking contract
     * @return balance total balance
     */
    function getTotalDeposits() public view override returns (uint) {
        return
            stakeController.getStake(address(this)) +
            stakeController.getBaseReward(address(this)) +
            stakeController.getDelegationReward(address(this));
    }

    function raiseAlert() external onlyOperator {
        stakeController.raiseAlert();
        token.safeTransfer(vaultController, token.balanceOf(address(this)));
    }

    function setOperator(address _operator) external onlyOwner {
        require(operator == address(0), "Operator is already set");
        operator = _operator;
    }
}
