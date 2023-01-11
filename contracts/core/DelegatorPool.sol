// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "./base/RewardsPoolController.sol";
import "./interfaces/IPoolRouter.sol";

/**
 * @title Delegator Pool
 * @notice Allows users to stake allowance tokens and receive a percentage of earned rewards
 */
contract DelegatorPool is RewardsPoolController {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct VestingSchedule {
        uint256 totalAmount;
        uint64 startTimestamp;
        uint64 durationSeconds;
    }

    IERC20Upgradeable public allowanceToken;
    IPoolRouter public poolRouter;
    address public feeCurve;

    mapping(address => VestingSchedule) private vestingSchedules;

    event AllowanceStaked(address indexed user, uint256 amount);
    event AllowanceWithdrawn(address indexed user, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _allowanceToken,
        string memory _dTokenName,
        string memory _dTokenSymbol
    ) public initializer {
        __RewardsPoolController_init(_dTokenName, _dTokenSymbol);
        allowanceToken = IERC20Upgradeable(_allowanceToken);
    }

    /**
     * @notice ERC677 implementation to stake allowance or distribute rewards
     * @param _sender of the stake
     * @param _value of the token transfer
     * @param _calldata encoded vesting startTimestamp and durationSeconds if applicable
     **/
    function onTokenTransfer(
        address _sender,
        uint256 _value,
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
     * @param _account account address
     * @return balance accounts balance
     */
    function balanceOf(address _account) public view override returns (uint256) {
        return super.balanceOf(_account) - (vestingSchedules[_account].totalAmount - _vestedTokens(_account));
    }

    /**
     * @notice returns an accounts balance including any tokens that are currently vesting
     * @param _account account address
     * @return balance accounts balance
     */
    function totalBalanceOf(address _account) public view returns (uint256) {
        return super.balanceOf(_account);
    }

    /**
     * @notice receipt tokens within the delegator pool cannot be transferred
     */
    function _transfer(
        address,
        address,
        uint256
    ) internal override {
        revert("Token cannot be transferred");
    }

    /**
     * @notice returns an account's staked amount for use by reward pools
     * controlled by this contract. Overridden as the the staked amount needs to include any vesting tokens.
     * @dev required by RewardsPoolController
     * @param _account account address
     * @return account's staked amount
     */
    function staked(address _account) external view override returns (uint256) {
        return (rewardRedirects[_account] == address(0) ? super.balanceOf(_account) : 0) + redirectedStakes[_account];
    }

    /**
     * @notice withdraws allowance tokens if no pools are in reserve mode
     * @param _amount amount to withdraw
     **/
    function withdrawAllowance(uint256 _amount) external updateRewards(msg.sender) {
        require(!poolRouter.isReservedMode(), "Allowance cannot be withdrawn when pools are reserved");
        require(balanceOf(msg.sender) >= _amount, "Withdrawal amount exceeds balance");

        VestingSchedule memory vestingSchedule = vestingSchedules[msg.sender];
        if (
            vestingSchedule.startTimestamp != 0 &&
            block.timestamp > vestingSchedule.startTimestamp + vestingSchedule.durationSeconds
        ) {
            delete vestingSchedules[msg.sender];
        }

        _burn(msg.sender, _amount);
        allowanceToken.safeTransfer(msg.sender, _amount);

        emit AllowanceWithdrawn(msg.sender, _amount);
    }

    /**
     * @notice returns the vesting schedule of a given account
     * @param _account account address
     * @return vestingSchedule account's vesting schedule
     */
    function getVestingSchedule(address _account) external view returns (VestingSchedule memory) {
        return vestingSchedules[_account];
    }

    /**
     * @notice sets the pool router address
     * @param _poolRouter pool router address
     **/
    function setPoolRouter(address _poolRouter) external onlyOwner {
        require(address(poolRouter) == address(0), "pool router already set");
        poolRouter = IPoolRouter(_poolRouter);
    }

    /**
     * @notice stakes allowance tokens
     * @param _sender account to stake for
     * @param _amount amount to stake
     **/
    function _stakeAllowance(address _sender, uint256 _amount) private updateRewards(_sender) {
        _mint(_sender, _amount);
        emit AllowanceStaked(_sender, _amount);
    }

    /**
     * @notice sets an account's derivative token vesting schedule. If a schedule already exists:
     * - If the new start timestamp is after the previous schedule, the schedule is overwritten and any remaining vesting tokens go into the new schedule
     * - Will release any tokens that have vested but not transferred
     * - If the start timestamp is before the current schedule, the current schedule is used
     * @param _account account address
     * @param _amount amount of tokens to lock
     * @param _startTimestamp vesting start time
     * @param _durationSeconds vesting duration
     */
    function _setVestingSchedule(
        address _account,
        uint256 _amount,
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
     * @notice Returns the amount of tokens that are currently vested for an account
     * @param _account account address
     */
    function _vestedTokens(address _account) internal view returns (uint256) {
        VestingSchedule memory vestingSchedule = vestingSchedules[_account];
        uint256 totalAmount = vestingSchedule.totalAmount;
        uint64 startTimestamp = vestingSchedule.startTimestamp;
        uint64 timestamp = uint64(block.timestamp);

        if (totalAmount == 0 || timestamp < startTimestamp) {
            return 0;
        } else if (timestamp > startTimestamp + vestingSchedule.durationSeconds) {
            return totalAmount;
        } else {
            return ((totalAmount * (timestamp - startTimestamp)) / vestingSchedule.durationSeconds);
        }
    }
}
