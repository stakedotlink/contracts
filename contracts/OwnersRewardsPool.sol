// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./base/RewardsPool.sol";
import "./interfaces/IPoolOwners.sol";

/**
 * @title OwnersRewardsPool
 * @notice Handles distribution of owners rewards for a single asset
 */
contract OwnersRewardsPool is RewardsPool {
    using SafeERC20 for IERC677;

    IPoolOwners public poolOwners;
    uint256 public withdrawableRewards;

    event Withdraw(address indexed account, uint amount);
    event DistributeRewards(address indexed sender, uint256 amountStaked, uint256 amount);

    constructor(
        address _poolOwners,
        address _token,
        string memory _derivativeTokenName,
        string memory _derivativeTokenSymbol
    ) RewardsPool(_token, _derivativeTokenName, _derivativeTokenSymbol) {
        poolOwners = IPoolOwners(_poolOwners);
    }

    /**
     * @notice withdraws an account's earned rewards
     **/
    function withdraw() external {
        uint256 toWithdraw = balanceOf(msg.sender);
        require(toWithdraw > 0, "No rewards to withdraw");

        withdrawableRewards -= toWithdraw;
        _withdraw(msg.sender, toWithdraw);
    }

    /**
     * @notice withdraws an account's earned rewards
     * @dev used by PoolOwners
     * @param _account account to withdraw for
     **/
    function withdraw(address _account) external {
        require(msg.sender == address(poolOwners), "PoolOwners only");

        uint256 toWithdraw = balanceOf(_account);

        if (toWithdraw > 0) {
            withdrawableRewards -= toWithdraw;
            _withdraw(_account, toWithdraw);
        }
    }

    /**
     * @notice ERC677 implementation that proxies reward distribution
     * @param _sender of the token transfer
     * @param _value of the token transfer
     **/
    function onTokenTransfer(
        address _sender,
        uint256 _value,
        bytes calldata
    ) external {
        require(msg.sender == address(token), "Only callable by token");
        distributeRewards();
    }

    /**
     * @notice distributes new rewards that have been deposited
     **/
    function distributeRewards() public {
        require(_totalStaked() > 0, "Cannot distribute when nothing is staked");
        uint256 toDistribute = token.balanceOf(address(this)) - withdrawableRewards;
        withdrawableRewards += toDistribute;
        _updateRewardPerToken(toDistribute);
        emit DistributeRewards(msg.sender, _totalStaked(), toDistribute);
    }

    /**
     * @notice returns an account's staked amount
     * @param _account to return staked amount for
     * @return account's staked amount
     **/
    function _staked(address _account) internal view override returns (uint) {
        return poolOwners.staked(_account);
    }

    /**
     * @notice returns the total staked amount
     * @return total staked amount
     **/
    function _totalStaked() internal view override returns (uint) {
        return poolOwners.totalSupply();
    }

    /**
     * @notice withdraws rewards for an account
     * @param _account account to withdraw for
     * @param _amount amount to withdraw
     **/
    function _withdraw(address _account, uint _amount) internal {
        updateReward(_account);
        _burn(_account, _amount);
        token.safeTransfer(_account, _amount);
        emit Withdraw(_account, _amount);
    }
}
