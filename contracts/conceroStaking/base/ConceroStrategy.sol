// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../../core/interfaces/IERC677.sol";
import "../../core/base/Strategy.sol";
import "../../core/interfaces/IWithdrawalPool.sol";
import "../interfaces/IConceroPool.sol";

/**
 * @title Concero Strategy
 * @notice Base strategy contract that manages deposits in the Concero pool
 */
abstract contract ConceroStrategy is Strategy {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    IConceroPool public conceroPool;
    IWithdrawalPool public withdrawalPool;

    uint256 internal totalDeposits;
    uint256 internal maxDeposits;

    uint64 public timeOfLastWithdrawalRequest;
    uint64 public minTimeBetweenWithdrawalRequests;
    uint128 public withdrawalRequestThreshold;

    uint256[10] private __gap;

    error InsufficientAvailableBalance();
    error MinTimeNotElapsed();
    error InsufficientQueuedWithdrawals();
    error UnnecessaryRequest();

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
    function __ConceroStrategy_init(
        address _token,
        address _stakingPool,
        address _conceroPool,
        address _withdrawalPool,
        uint256 _maxDeposits,
        uint64 _minTimeBetweenWithdrawalRequests,
        uint128 _withdrawalRequestThreshold
    ) public onlyInitializing {
        __Strategy_init(_token, _stakingPool);
        conceroPool = IConceroPool(_conceroPool);
        withdrawalPool = IWithdrawalPool(_withdrawalPool);
        maxDeposits = _maxDeposits;
        minTimeBetweenWithdrawalRequests = _minTimeBetweenWithdrawalRequests;
        withdrawalRequestThreshold = _withdrawalRequestThreshold;
    }

    function checkUpkeep(bytes calldata) external view returns (bool, bytes memory) {
        if (block.timestamp < timeOfLastWithdrawalRequest + minTimeBetweenWithdrawalRequests) return (false, "");

        uint256 totalQueuedWithdrawals = withdrawalPool.getTotalQueuedWithdrawals();
        if (totalQueuedWithdrawals < withdrawalRequestThreshold) return (false, "");
        if (totalQueuedWithdrawals <= conceroPool.availableToWithdraw(_getConceroPoolToken())) return (false, "");

        return (true, "");
    }

    function performUpkeep(bytes calldata) external {
        if (block.timestamp < timeOfLastWithdrawalRequest + minTimeBetweenWithdrawalRequests) revert MinTimeNotElapsed();

        uint256 totalQueuedWithdrawals = withdrawalPool.getTotalQueuedWithdrawals();
        if (totalQueuedWithdrawals < withdrawalRequestThreshold) revert InsufficientQueuedWithdrawals();
        if (totalQueuedWithdrawals <= conceroPool.availableToWithdraw(_getConceroPoolToken())) revert UnnecessaryRequest();

        conceroPool.withdrawLiquidityRequest(_getConceroPoolToken(), totalQueuedWithdrawals);
        timeOfLastWithdrawalRequest = uint64(block.timestamp);
    }

    /**
     * @notice returns the deposit change since deposits were last updated
     * @return deposit change
     */
    function getDepositChange() public view returns (int) {
        uint256 totalBalance = conceroPool.s_userBalances(_getConceroPoolToken(), address(this));
        return int(totalBalance) - int(totalDeposits);
    }

    /**
     * @notice updates deposit accounting and calculates fees on newly earned rewards
     * @dev reverts if sender is not stakingPool
     * @return depositChange change in deposits since last update
     * @return receivers list of fee receivers
     * @return amounts list of fee amounts
     */
    function updateDeposits(bytes calldata)
        external
        onlyStakingPool
        returns (
            int256 depositChange,
            address[] memory,
            uint256[] memory
        )
    {
        depositChange = getDepositChange();

        if (depositChange > 0) {
            totalDeposits += uint256(depositChange);
        } else if (depositChange < 0) {
            totalDeposits -= uint256(depositChange * -1);
        }

        return (depositChange, new address[](0), new uint256[](0));
    }

    /**
     * @notice returns the total amount of deposits as tracked in this strategy
     * @return total deposits
     */
    function getTotalDeposits() public view override returns (uint256) {
        return totalDeposits;
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
        uint256 availableBalance = conceroPool.availableToWithdraw(_getConceroPoolToken());
        return availableBalance >= totalDeposits ? 0 : totalDeposits - availableBalance;
    }

    /**
     * @notice sets the maximum than can be deposited into this strategy
     * @param _maxDeposits maximum deposits
     */
    function setMaxDeposits(uint256 _maxDeposits) external onlyOwner {
        maxDeposits = _maxDeposits;
    }

    /**
     * @notice sets the mimimum time between withdrawal requests
     * @param _minTimeBetweenWithdrawalRequests min time in seconds
     */
    function setMinTimeBetweenWithdrawalRequests(uint64 _minTimeBetweenWithdrawalRequests) external onlyOwner {
        minTimeBetweenWithdrawalRequests = _minTimeBetweenWithdrawalRequests;
    }

    /**
     * @notice sets the the minimum amount of queued withdrawals needed to request a withdrawal
     * @param _withdrawalRequestThreshold min amount of queued withdrawals
     */
    function setWithdrawalRequestThreshold(uint128 _withdrawalRequestThreshold) external onlyOwner {
        withdrawalRequestThreshold = _withdrawalRequestThreshold;
    }

    /**
     * @notice returns the token address for this strategy as stored in the Concero pool
     * @return token address
     */
    function _getConceroPoolToken() internal view virtual returns (address) {
        return address(token);
    }
}
