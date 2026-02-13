// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/IEspressoRewards.sol";

/**
 * @title Espresso Rewards Mock
 * @notice Mock contract for testing EspressoVault and EspressoStrategy rewards claiming
 * @dev Simulates the RewardClaim contract from Espresso Network
 */
contract EspressoRewardsMock is IEspressoRewards {
    using SafeERC20 for IERC20;

    IERC20 public token;

    // claimer => total lifetime rewards claimed
    mapping(address => uint256) public claimedRewards;
    // total lifetime rewards claimed across all users
    uint256 public totalClaimed;
    // daily limit in wei
    uint256 public dailyLimitWei;
    // current day number
    uint256 private _currentDay;
    // amount claimed today
    uint256 private _claimedToday;
    // whether to skip auth verification (for testing convenience)
    bool public skipAuthVerification;

    event RewardsClaimed(address indexed claimer, uint256 amount);
    event DailyLimitUpdated(uint256 oldLimit, uint256 newLimit);

    error InvalidRewardAmount();
    error AlreadyClaimed();
    error InvalidAuthRoot();
    error DailyLimitExceeded();

    /**
     * @notice Initializes the mock contract
     * @param _token address of the rewards token (ESP)
     * @param _dailyLimitWei maximum claimable wei per day (0 for no limit)
     */
    constructor(address _token, uint256 _dailyLimitWei) {
        token = IERC20(_token);
        dailyLimitWei = _dailyLimitWei;
        skipAuthVerification = true; // Default to skipping for easier testing
    }

    /**
     * @notice Claims rewards for the caller
     * @dev In production, authData contains a Merkle proof verified against lightClient
     * @param _lifetimeRewards total lifetime rewards for the claimer
     * @param _authData authorization data (Merkle proof in production)
     */
    function claimRewards(uint256 _lifetimeRewards, bytes calldata _authData) external override {
        if (_lifetimeRewards == 0) revert InvalidRewardAmount();
        if (_lifetimeRewards < claimedRewards[msg.sender]) revert InvalidRewardAmount();
        if (_lifetimeRewards == claimedRewards[msg.sender]) revert AlreadyClaimed();

        // Verify auth data (skip in test mode for convenience)
        if (!skipAuthVerification) {
            if (!_verifyAuthRoot(_lifetimeRewards, _authData)) revert InvalidAuthRoot();
        }

        uint256 amountToClaim = _lifetimeRewards - claimedRewards[msg.sender];

        // Enforce daily limit if set
        if (dailyLimitWei > 0) {
            _enforceDailyLimit(amountToClaim);
        }

        claimedRewards[msg.sender] = _lifetimeRewards;
        totalClaimed += amountToClaim;

        token.safeTransfer(msg.sender, amountToClaim);

        emit RewardsClaimed(msg.sender, amountToClaim);
    }

    /**
     * @notice Verifies the authorization data
     * @dev Override this in tests to implement custom verification logic
     * @param _lifetimeRewards total lifetime rewards
     * @param _authData authorization data
     * @return valid whether the auth data is valid
     */
    function _verifyAuthRoot(
        uint256 _lifetimeRewards,
        bytes calldata _authData
    ) internal view virtual returns (bool) {
        // In production, this verifies a Merkle proof against the light client
        // For mock purposes, we accept any non-empty auth data
        return _authData.length > 0;
    }

    /**
     * @notice Enforces the daily claim limit
     * @param _amount amount being claimed
     */
    function _enforceDailyLimit(uint256 _amount) internal {
        uint256 today = block.timestamp / 1 days;

        if (today > _currentDay) {
            _currentDay = today;
            _claimedToday = 0;
        }

        if (_claimedToday + _amount > dailyLimitWei) revert DailyLimitExceeded();

        _claimedToday += _amount;
    }

    /**
     * @notice Sets the daily claim limit
     * @param _dailyLimitWei new daily limit in wei
     */
    function setDailyLimit(uint256 _dailyLimitWei) external {
        uint256 oldLimit = dailyLimitWei;
        dailyLimitWei = _dailyLimitWei;

        emit DailyLimitUpdated(oldLimit, _dailyLimitWei);
    }

    /**
     * @notice Sets whether to skip auth verification
     * @param _skip whether to skip verification
     */
    function setSkipAuthVerification(bool _skip) external {
        skipAuthVerification = _skip;
    }

    /**
     * @notice Deposits rewards tokens into the contract
     * @param _amount amount of tokens to deposit
     */
    function depositRewards(uint256 _amount) external {
        token.safeTransferFrom(msg.sender, address(this), _amount);
    }

    /**
     * @notice Returns the amount claimed today
     * @return amount claimed today
     */
    function getClaimedToday() external view returns (uint256) {
        uint256 today = block.timestamp / 1 days;
        if (today > _currentDay) {
            return 0;
        }
        return _claimedToday;
    }
}
