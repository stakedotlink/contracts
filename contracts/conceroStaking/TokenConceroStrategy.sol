// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../core/interfaces/IERC677.sol";
import "./base/ConceroStrategy.sol";
import "../core/interfaces/IWithdrawalPool.sol";
import "./interfaces/IConceroPool.sol";

/**
 * @title Token Concero Strategy
 * @notice Manages token deposits in the Concero pool
 */
contract TokenConceroStrategy is ConceroStrategy {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice initializes contract
     * @param _token address of asset token
     * @param _stakingPool address of the staking pool that controls this strategy
     * @param _conceroPool address of the Concero staking pool
     * @param _withdrawalPool address of the withdrawal pool
     * @param _maxDeposits maximum amount that can be deposited into this strategy
     * @param _minTimeBetweenWithdrawalRequests mimimum time between withdrawal requests
     * @param _withdrawalRequestThreshold minimum amount of queued withdrawals needed to request a withdrawal
     **/
    function initialize(
        address _token,
        address _stakingPool,
        address _conceroPool,
        address _withdrawalPool,
        uint256 _maxDeposits,
        uint64 _minTimeBetweenWithdrawalRequests,
        uint128 _withdrawalRequestThreshold
    ) public initializer {
        __ConceroStrategy_init(
            _token,
            _stakingPool,
            _conceroPool,
            _withdrawalPool,
            _maxDeposits,
            _minTimeBetweenWithdrawalRequests,
            _withdrawalRequestThreshold
        );
        token.safeApprove(_conceroPool, type(uint256).max);
    }

    /**
     * @notice deposits tokens from the staking pool into the Concero pool
     * @dev reverts if sender is not stakingPool
     * @param _amount amount to deposit
     */
    function deposit(uint256 _amount, bytes calldata) external onlyStakingPool {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        conceroPool.depositToken(address(token), _amount);
        totalDeposits += _amount;
    }

    /**
     * @notice withdraws tokens from the Concero pool and sends them to the staking pool
     * @dev reverts if sender is not stakingPool
     * @param _amount amount to withdraw
     */
    function withdraw(uint256 _amount, bytes calldata) external onlyStakingPool {
        uint256 availableBalance = conceroPool.availableToWithdraw(address(token));
        if (_amount > availableBalance) revert InsufficientAvailableBalance();

        totalDeposits -= _amount;
        conceroPool.withdrawLiquidityRequest(address(token), _amount);
        token.safeTransfer(msg.sender, _amount);
    }
}
