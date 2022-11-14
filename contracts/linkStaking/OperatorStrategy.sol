// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../core/interfaces/IERC677.sol";
import "./interfaces/IStaking.sol";

import "../core/base/Strategy.sol";

/**
 * @title Operator Strategy
 * @notice Implemented strategy for depositing LINK collateral into the Chainlink staking controller as an operator
 */
contract OperatorStrategy is Strategy {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    IStaking public stakeController;

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
     * @notice returns the deposit change (positive/negative) since deposits were last updated
     * @return int deposit change
     */
    function depositChange() public view returns (int) {
        return
            int(
                stakeController.getStake(address(this)) +
                    stakeController.getBaseReward(address(this)) +
                    stakeController.getDelegationReward(address(this))
            ) - int(totalDeposited);
    }

    /**
     * @notice deposits the amount of token into the Chainlink staking contract
     * @param _amount amount to deposit
     */
    function deposit(uint256 _amount) external onlyStakingPool {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        IERC677(address(token)).transferAndCall(address(stakeController), _amount, "0x00");
        totalDeposited += _amount;
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
        if (!stakeController.isActive() || stakeController.isPaused() || !stakeController.isOperator(address(this))) {
            return 0;
        }
        (, uint max) = stakeController.getOperatorLimits();
        return max;
    }

    /**
     * @notice minimum amount of tokens that can be deposited as set by the staking controller
     * @return uint min deposits
     */
    function minDeposits() public view override returns (uint) {
        (uint min, ) = stakeController.getOperatorLimits();
        if (totalDeposited > min) {
            return totalDeposited;
        }
        return min;
    }

    /**
     * @notice migrates the tokens deposited into a new stake controller,
     */
    function migrate(bytes calldata data) external onlyOwner {
        stakeController.migrate(data);
        stakeController = IStaking(stakeController.getMigrationTarget());
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
