// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "./base/ConceroStrategy.sol";
import "../ethStaking/interfaces/IWrappedETH.sol";

/**
 * @title ETH Concero Strategy
 * @notice Manages ETH deposits in the Concero pool
 */
contract ETHConceroStrategy is ConceroStrategy {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    receive() external payable {}

    /**
     * @notice initializes contract
     * @param _wrappedETH address of wrapped ETH token
     * @param _stakingPool address of the staking pool that controls this strategy
     * @param _conceroPool address of the Concero staking pool
     * @param _withdrawalPool address of the withdrawal pool
     * @param _maxDeposits maximum amount that can be deposited into this strategy
     * @param _minTimeBetweenWithdrawalRequests mimimum time between withdrawal requests
     * @param _withdrawalRequestThreshold minimum amount of queued withdrawals needed to request a withdrawal
     **/
    function initialize(
        address _wrappedETH,
        address _stakingPool,
        address _conceroPool,
        address _withdrawalPool,
        uint256 _maxDeposits,
        uint64 _minTimeBetweenWithdrawalRequests,
        uint128 _withdrawalRequestThreshold
    ) public initializer {
        __ConceroStrategy_init(
            _wrappedETH,
            _stakingPool,
            _conceroPool,
            _withdrawalPool,
            _maxDeposits,
            _minTimeBetweenWithdrawalRequests,
            _withdrawalRequestThreshold
        );
    }

    /**
     * @notice deposits ETH from the staking pool into the Concero pool
     * @dev reverts if sender is not stakingPool
     * @param _amount amount to deposit
     */
    function deposit(uint256 _amount, bytes calldata) external onlyStakingPool {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        IWrappedETH(address(token)).unwrap(_amount);
        conceroPool.depositEther{value: _amount}();
        totalDeposits += _amount;
    }

    /**
     * @notice withdraws tokens from the Concero pool and sends them to the staking pool
     * @dev reverts if sender is not stakingPool
     * @param _amount amount to withdraw
     */
    function withdraw(uint256 _amount, bytes calldata) external onlyStakingPool {
        uint256 availableBalance = conceroPool.availableToWithdraw(_getConceroPoolToken());
        if (_amount > availableBalance) revert InsufficientAvailableBalance();

        totalDeposits -= _amount;
        conceroPool.withdrawLiquidityRequest(_getConceroPoolToken(), _amount);
        IWrappedETH(address(token)).wrap{value: _amount}();
        token.safeTransfer(msg.sender, _amount);
    }

    /**
     * @notice returns the token address for this strategy as stored in the Concero pool
     * @return token address
     */
    function _getConceroPoolToken() internal pure override returns (address) {
        return address(0);
    }
}
