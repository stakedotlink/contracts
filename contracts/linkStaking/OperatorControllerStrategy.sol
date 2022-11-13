// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../core/interfaces/IERC677.sol";

import "../core/base/Strategy.sol";
import "./OperatorStrategy.sol";

/**
 * @title Operator Controller Strategy
 * @notice Implemented strategy for managing multiple operators depositing collateral into the Chainlink staking controller.
 */
contract OperatorControllerStrategy is Strategy {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    address public stakeController;

    OperatorStrategy[] private operatorStrategies;
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
        stakeController = _stakeController;
    }

    /**
     * @notice deploys a new operator strategy to provide a unique address for the staking controller. Unique addresses needed
     * as the staking controller is strict in regards to one address one maximum limit.
     */
    function deployOperatorStrategy() external onlyOwner returns (address) {
        OperatorStrategy operatorStrategy = new OperatorStrategy();
        operatorStrategy.initialize(address(token), address(this), stakeController);
        operatorStrategy.transferOwnership(owner());
        operatorStrategies.push(operatorStrategy);
        token.approve(address(operatorStrategy), type(uint256).max);
        return address(operatorStrategy);
    }

    /**
     * @notice get a deployed operator strategy at index
     * @param _idx index
     * @return operatorStrategy address
     */
    function getOperatorStrategy(uint _idx) external view returns (OperatorStrategy) {
        return operatorStrategies[_idx];
    }

    /**
     * @notice returns the deposit change (positive/negative) since deposits were last updated
     * @return int deposit change
     */
    function depositChange() public view returns (int) {
        int totalDepositChange = 0;
        for (uint i = 0; i < operatorStrategies.length; i++) {
            totalDepositChange += operatorStrategies[i].depositChange();
        }
        return totalDepositChange;
    }

    /**
     * @notice deposits the amount of token into the Chainlink staking contract
     * @param _amount amount to deposit
     */
    function deposit(uint256 _amount) external onlyStakingPool {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        totalDeposited += _amount;

        uint depositAmount = _amount;
        uint i = operatorStrategies.length - 1;
        while (depositAmount > 0) {
            OperatorStrategy operatorStrategy = operatorStrategies[i];
            uint canDeposit = operatorStrategy.canDeposit();

            if (depositAmount > canDeposit) {
                operatorStrategy.deposit(canDeposit);
                depositAmount -= canDeposit;
            } else {
                operatorStrategy.deposit(depositAmount);
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

        for (uint i = 0; i < operatorStrategies.length; i++) {
            operatorStrategies[i].updateDeposits();
        }
    }

    /**
     * @notice returns the available amount to be withdrawn, always zero as withdrawals disabled
     * @return uint available withdrawal room
     */
    function canWithdraw() public pure override returns (uint) {
        return 0;
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
        if (operatorStrategies.length == 0) {
            return 0;
        }
        return operatorStrategies[0].maxDeposits() * operatorStrategies.length;
    }

    /**
     * @notice minimum amount of tokens that can be deposited as set by the staking controller
     * @return uint min deposits
     */
    function minDeposits() public view override returns (uint) {
        uint totalMinDeposits = 0;
        for (uint i = 0; i < operatorStrategies.length; i++) {
            totalMinDeposits += operatorStrategies[i].minDeposits();
        }
        return totalMinDeposits;
    }

    /**
     * @notice allows the staking pool to be changed after deployment, only if the staking pool was set as an empty
     * address on deploy
     * @param _stakingPool new staking pool address
     */
    function setStakingPool(address _stakingPool) external onlyOwner {
        require(
            _stakingPool != address(0) && address(stakingPool) == address(0),
            "Staking pool cannot be empty/pool is already set"
        );
        stakingPool = IStakingPool(_stakingPool);
    }
}
