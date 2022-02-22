// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.11;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./RewardsPool.sol";

/**
 * @title OwnersTimeRewardsPool
 * @dev Handles time based distribution of owners rewards over a certain period
 */
contract OwnersTimeRewardsPool is RewardsPool, Ownable {
    using SafeERC20 for IERC677;

    address public poolOwners;

    uint public periodFinish;
    uint public rewardRate;
    uint public lastUpdateTime;

    event StartRewardsDistribution(address indexed sender, uint amount, uint rewardRate, uint duration);

    constructor(
        address _poolOwners,
        address _token,
        string memory _dTokenName,
        string memory _dTokenSymbol
    ) RewardsPool(_poolOwners, _token, _dTokenName, _dTokenSymbol) {
        poolOwners = _poolOwners;
    }

    function lastTimeRewardApplicable() public view returns (uint) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    /**
     * @dev Returns the current value of rewardPerToken
     * @return rewardPerToken
     **/
    function rewardPerToken() public view override returns (uint) {
        if (sdToken.totalSupply() == 0) {
            return rewardPerTokenStored;
        }

        return
            rewardPerTokenStored +
            ((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18) /
            sdToken.totalSupply();
    }

    /**
     * @dev withdraws an account's earned rewards
     **/
    function withdraw() external {
        uint toWithdraw = balanceOf(msg.sender);
        require(toWithdraw > 0, "No rewards to withdraw");

        _withdraw(msg.sender, toWithdraw);
    }

    /**
     * @dev withdraws an account's earned rewards
     * @param _account account to withdraw for
     **/
    function withdraw(address _account) external {
        require(msg.sender == poolOwners, "PoolOwners only");

        uint toWithdraw = balanceOf(_account);

        if (toWithdraw > 0) {
            _withdraw(_account, toWithdraw);
        }
    }

    /**
     * @dev updates rewardPerToken accounting and an account's principal reward balance
     * @param _account account to update for
     **/
    function updateReward(address _account) public override {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();

        if (_account != address(0)) {
            super.updateReward(_account);
        }
    }

    /**
     * @dev ERC677 implementation that automatically calls _startRewardsDistribution
     * @param _sender of the token transfer
     * @param _value of the token transfer
     **/
    function onTokenTransfer(
        address _sender,
        uint _value,
        bytes calldata _data
    ) external {
        require(msg.sender == address(token), "Only callable by token");
        require(_sender == owner(), "Sender must be owner");
        uint duration = abi.decode(_data, (uint));
        _startRewardsDistribution(_value, duration);
    }

    /**
     * @dev Transfers tokens and calls _startRewardsDistribution
     * @param _amount amount of rewards to distribute
     * @param _duration duration of the the distribution period (seconds)
     **/
    function startRewardsDistribution(uint _amount, uint _duration) external onlyOwner {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        _startRewardsDistribution(_amount, _duration);
    }

    /**
     * @dev Starts a new rewards distribution period
     * @param _amount amount of rewards to distribute
     * @param _duration duration of the the distribution period (seconds)
     **/
    function _startRewardsDistribution(uint _amount, uint _duration) private {
        updateReward(address(0));

        if (block.timestamp >= periodFinish) {
            rewardRate = _amount / _duration;
        } else {
            uint remaining = periodFinish - block.timestamp;
            uint leftover = remaining * rewardRate;
            rewardRate = (_amount + leftover) / _duration;
        }

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + _duration;

        emit StartRewardsDistribution(msg.sender, _amount, rewardRate, _duration);
    }
}
