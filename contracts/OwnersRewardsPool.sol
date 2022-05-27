// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./RewardsPool.sol";

/**
 * @title OwnersRewardsPool
 * @dev Handles distribution of owners rewards
 */
contract OwnersRewardsPool is RewardsPool {
    using SafeERC20 for IERC677;

    address public poolOwners;
    uint256 public withdrawableRewards;

    event Withdraw(address indexed account, uint amount);
    event DistributeRewards(address indexed sender, uint256 amountStaked, uint256 amount);

    constructor(
        address _poolOwners,
        address _token,
        string memory _dTokenName,
        string memory _dTokenSymbol
    ) RewardsPool(_poolOwners, _token, _dTokenName, _dTokenSymbol) {
        poolOwners = _poolOwners;
    }

    /**
     * @dev withdraws an account's earned rewards
     **/
    function withdraw() external {
        uint256 toWithdraw = balanceOf(msg.sender);
        require(toWithdraw > 0, "No rewards to withdraw");

        withdrawableRewards -= toWithdraw;
        _withdraw(msg.sender, toWithdraw);
    }

    /**
     * @dev withdraws an account's earned rewards
     * @param _account account to withdraw for
     **/
    function withdraw(address _account) external {
        require(msg.sender == poolOwners, "PoolOwners only");

        uint256 toWithdraw = balanceOf(_account);

        if (toWithdraw > 0) {
            withdrawableRewards -= toWithdraw;
            _withdraw(_account, toWithdraw);
        }
    }

    /**
     * @dev ERC677 implementation that automatically calls distributeRewards
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
     * @dev distributes new rewards that have been deposited
     **/
    function distributeRewards() public {
        require(sdToken.totalSupply() > 0, "Cannot distribute when nothing is staked");
        uint256 toDistribute = token.balanceOf(address(this)) - withdrawableRewards;
        withdrawableRewards += toDistribute;
        _updateRewardPerToken(toDistribute);
        emit DistributeRewards(msg.sender, sdToken.totalSupply(), toDistribute);
    }

    /**
     * @dev withdraws rewards for an account
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
