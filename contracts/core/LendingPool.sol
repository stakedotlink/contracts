// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./base/RewardsPoolController.sol";
import "./interfaces/IPoolRouter.sol";
import "./interfaces/IFeeCurve.sol";

/**
 * @title Lending Pool
 * @notice Allows users to stake allowance tokens, stakers receive a percentage of earned rewards
 */
contract LendingPool is RewardsPoolController {
    using SafeERC20 for IERC20;

    IERC20 public immutable allowanceToken;
    IPoolRouter public immutable poolRouter;
    IFeeCurve public feeCurve;

    event AllowanceStaked(address indexed user, uint amount);
    event AllowanceWithdrawn(address indexed user, uint amount);

    struct VestingSchedule {
        uint totalAmount;
        uint64 startTimestamp;
        uint64 durationSeconds;
    }
    mapping(address => VestingSchedule) private vestingSchedules;

    constructor(
        address _allowanceToken,
        string memory _dTokenName,
        string memory _dTokenSymbol,
        address _poolRouter,
        address _feeCurve
    ) RewardsPoolController(_dTokenName, _dTokenSymbol) {
        allowanceToken = IERC20(_allowanceToken);
        poolRouter = IPoolRouter(_poolRouter);
        feeCurve = IFeeCurve(_feeCurve);
    }

    /**
     * @notice ERC677 implementation to stake allowance or distribute rewards
     * @param _sender of the stake
     * @param _value of the token transfer
     **/
    function onTokenTransfer(
        address _sender,
        uint _value,
        bytes calldata _calldata
    ) external override {
        require(
            msg.sender == address(allowanceToken) || isTokenSupported(msg.sender),
            "Sender must be allowance or rewards token"
        );

        if (msg.sender == address(allowanceToken)) {
            _stakeAllowance(_sender, _value);

            if (_calldata.length > 1) {
                (uint64 startTimestamp, uint64 durationSeconds) = abi.decode(_calldata, (uint64, uint64));
                _setVestingSchedule(_sender, _value, startTimestamp, durationSeconds);
            }
        } else {
            distributeToken(msg.sender);
        }
    }

    /**
     * @notice returns an accounts balance minus the amount of tokens that are currently vesting
     * @param _account account
     * @return balance accounts balance
     */
    function balanceOf(address _account) public view virtual override(ERC20, IERC20) returns (uint256) {
        return super.balanceOf(_account) - (vestingSchedules[_account].totalAmount - _vestedTokens(_account));
    }

    /**
     * @notice receipt tokens within the lending pool cannot be transferred
     */
    function _transfer(
        address,
        address,
        uint256
    ) internal virtual override {
        revert("Token cannot be transferred");
    }

    /**
     * @notice returns an account's staked amount for use by reward pools
     * controlled by this contract. Overridden as the the staked amount needs to include any vesting tokens.
     * @dev required by RewardsPoolController
     * @return account's staked amount
     */
    function staked(address _account) external view override returns (uint) {
        return (rewardRedirects[_account] == address(0) ? super.balanceOf(_account) : 0) + redirectedStakes[_account];
    }

    /**
     * @notice returns the current fee rate based on the % of allowance token borrowed
     * @param _token the token address of the pool
     * @param _index the pool index
     * @return current rate
     **/
    function currentRate(address _token, uint16 _index) public view returns (uint) {
        return feeCurve.currentRate(poolRouter.poolUtilisation(_token, _index));
    }

    /**
     * @notice returns the current fee rate based on a specified percentage
     * @dev 1 ether = 100%, 0.5 ether = 50% etc
     * @param _percentageBorrowed the percentage borrowed for fee calculation
     * @return current rate
     **/
    function currentRateAt(uint _percentageBorrowed) public view returns (uint) {
        return feeCurve.currentRate(_percentageBorrowed);
    }

    /**
     * @notice withdraws lent allowance tokens if there are enough available
     * @param _amount amount to withdraw
     **/
    function withdrawAllowance(uint _amount) external updateRewards(msg.sender) {
        require(!poolRouter.isReservedMode(), "Allowance cannot be withdrawn when pools are reserved");
        require(balanceOf(msg.sender) >= _amount, "Withdrawal amount exceeds balance");

        uint toWithdraw = _amount;
        if (_amount == type(uint).max) {
            toWithdraw = balanceOf(msg.sender);
        }

        VestingSchedule memory vestingSchedule = vestingSchedules[msg.sender];
        if (
            vestingSchedule.startTimestamp != 0 &&
            block.timestamp > vestingSchedule.startTimestamp + vestingSchedule.durationSeconds
        ) {
            delete vestingSchedules[msg.sender];
        }

        _burn(msg.sender, toWithdraw);
        allowanceToken.safeTransfer(msg.sender, toWithdraw);

        emit AllowanceWithdrawn(msg.sender, toWithdraw);
    }

    /**
     * @notice returns the vesting schedule of a given account
     * @param _account account
     * @return vestingSchedule accounts vesting schedule
     */
    function getVestingSchedule(address _account) external view returns (VestingSchedule memory) {
        return vestingSchedules[_account];
    }

    /**
     * @notice sets the fee curve interface
     * @param _feeCurve interface
     */
    function setFeeCurve(address _feeCurve) external onlyOwner {
        require(_feeCurve != address(0), "Invalid fee curve address");
        feeCurve = IFeeCurve(_feeCurve);
    }

    /**
     * @notice stakes allowane tokens for an account
     * @dev used by pool router
     * @param _account account to stake for
     * @param _amount amount to stake
     **/
    function stakeAllowance(address _account, uint _amount) external {
        require(msg.sender == address(poolRouter), "Sender is not pool router");
        allowanceToken.safeTransferFrom(msg.sender, address(this), _amount);
        _stakeAllowance(_account, _amount);
    }

    /**
     * @notice stakes allowance tokens for lending
     * @param _amount amount to stake
     **/
    function _stakeAllowance(address _sender, uint _amount) private updateRewards(_sender) {
        _mint(_sender, _amount);
        emit AllowanceStaked(_sender, _amount);
    }

    /**
     * @notice sets an accounts derivative token vesting schedule. If a schedule already exists:
     * - If the new start timestamp is after the previous schedule, the schedule is overwritten and any remaining vesting tokens go into the new schedule
     * - Will release any tokens that have vested but not transferred
     * - If the start timestamp is before the current schedule, the current schedule is used
     */
    function _setVestingSchedule(
        address _account,
        uint _amount,
        uint64 _startTimestamp,
        uint64 _durationSeconds
    ) internal {
        require(_startTimestamp > 0, "Start timestamp cannot be 0");
        require(_durationSeconds > 0, "Seconds duration cannot be 0");

        VestingSchedule storage vestingSchedule = vestingSchedules[_account];
        if (_startTimestamp > vestingSchedule.startTimestamp) {
            if (vestingSchedule.startTimestamp != 0) {
                vestingSchedule.totalAmount -= _vestedTokens(_account);
            }
            vestingSchedule.startTimestamp = _startTimestamp;
            vestingSchedule.durationSeconds = _durationSeconds;
        }
        vestingSchedule.totalAmount += _amount;
    }

    /**
     * @notice Returns the amount of tokens that are currently locked within vesting
     */
    function _vestedTokens(address _account) internal view virtual returns (uint256) {
        VestingSchedule memory vestingSchedule = vestingSchedules[_account];
        uint totalVested = vestingSchedule.totalAmount;
        uint64 startTimestamp = vestingSchedule.startTimestamp;
        uint64 timestamp = uint64(block.timestamp);

        if (totalVested == 0 || timestamp < startTimestamp) {
            return 0;
        } else if (timestamp > startTimestamp + vestingSchedule.durationSeconds) {
            return totalVested;
        } else {
            return ((totalVested * (timestamp - startTimestamp)) / vestingSchedule.durationSeconds);
        }
    }
}
