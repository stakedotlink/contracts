// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../core/interfaces/IERC677.sol";
import "../core/base/Strategy.sol";
import "./interfaces/IOperatorVault.sol";
import "./interfaces/IStaking.sol";

/**
 * @title Operator Controller Strategy
 * @notice Implemented strategy for managing multiple operators depositing collateral into the Chainlink staking controller.
 */
contract OperatorControllerStrategy is Strategy {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    IStaking public stakeController;

    IOperatorVault[] private operatorVaults;
    uint public totalDeposited;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _token,
        address _stakingPool,
        address _stakeController
    ) public initializer {
        __Strategy_init(_token, _stakingPool);
        stakeController = IStaking(_stakeController);
    }

    /**
     * @notice adds a new operator vault to provide a unique address for the staking controller. Unique addresses needed
     * as the staking controller is strict in regards to one address one maximum limit.
     * @param _operatorVault address of vault
     */
    function addOperatorVault(address _operatorVault) external onlyOwner {
        operatorVaults.push(IOperatorVault(_operatorVault));
        token.approve(_operatorVault, type(uint256).max);
    }

    /**
     * @notice returns a list of all operator vaults
     * @return operatorVaults list of vault addresses
     */
    function getOperatorVaults() external view returns (IOperatorVault[] memory) {
        return operatorVaults;
    }

    /**
     * @notice returns the deposit change (positive/negative) since deposits were last updated
     * @return int deposit change
     */
    function depositChange() public view returns (int) {
        uint totalBalance = 0;
        for (uint i = 0; i < operatorVaults.length; i++) {
            totalBalance += operatorVaults[i].totalBalance();
        }
        return int(totalBalance) - int(totalDeposited);
    }

    /**
     * @notice deposits the amount of token into the Chainlink staking contract
     * @param _amount amount to deposit
     */
    function deposit(uint256 _amount) external onlyStakingPool {
        token.safeTransferFrom(msg.sender, address(this), _amount);

        (uint minDeposit, uint maxDeposit) = stakeController.getOperatorLimits();
        uint depositAmount = token.balanceOf(address(this));
        totalDeposited += _amount;

        uint i = operatorVaults.length - 1;
        while (depositAmount > 0) {
            IOperatorVault operatorVault = operatorVaults[i];
            uint canDeposit = maxDeposit - operatorVault.totalDeposits();

            if (minDeposit > depositAmount) {
                break;
            } else if (depositAmount > canDeposit) {
                operatorVault.deposit(canDeposit);
                depositAmount -= canDeposit;
            } else {
                operatorVault.deposit(depositAmount);
                depositAmount = 0;
            }

            if (i == 0) {
                break;
            }
            i--;
        }
    }

    /**
     * @notice withdrawals are not yet implemented in this iteration of Chainlink staking
     */
    function withdraw(uint256) external view onlyStakingPool {
        revert("withdrawals not yet implemented");
    }

    /**
     * @notice updates the total amount deposited for reward distribution
     * @return receivers list of fee receivers (always none)
     * @return amounts list of fee amounts (always none)
     */
    function updateDeposits() external onlyStakingPool returns (address[] memory receivers, uint[] memory amounts) {
        receivers = new address[](0);
        amounts = new uint[](0);

        int balanceChange = depositChange();
        if (balanceChange > 0) {
            totalDeposited += uint(balanceChange);
        } else if (balanceChange < 0) {
            totalDeposited -= uint(balanceChange * -1);
        }
    }

    /**
     * @notice the amount of total deposits as tracked in the strategy
     * @return uint total deposited
     */
    function totalDeposits() public view override returns (uint) {
        return totalDeposited;
    }

    /**
     * @notice maximum amount of tokens that can be deposited as set by the staking controller
     * @return uint max deposits
     */
    function maxDeposits() public view override returns (uint) {
        if (operatorVaults.length == 0 || !stakeController.isActive() || stakeController.isPaused()) {
            return 0;
        }

        (, uint max) = stakeController.getOperatorLimits();
        return max * operatorVaults.length;
    }

    /**
     * @notice minimum amount of tokens that can be deposited as set by the staking controller
     * @return uint min deposits
     */
    function minDeposits() public view override returns (uint) {
        (uint min, ) = stakeController.getOperatorLimits();
        uint totalMinDeposits = min * operatorVaults.length;

        if (totalDeposited > totalMinDeposits) {
            return totalDeposited;
        }
        return totalMinDeposits;
    }
}
