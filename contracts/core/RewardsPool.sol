// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./tokens/base/VirtualERC677.sol";
import "./interfaces/IRewardsPoolController.sol";

/**
 * @title RewardsPool
 * @notice Handles reward distribution for a single asset
 * @dev rewards can only be positive (user balances can only increase)
 */
contract RewardsPool is VirtualERC677 {
    using SafeERC20 for IERC677;

    IERC677 public token;
    IRewardsPoolController public controller;

    uint public withdrawableRewards;
    uint public rewardPerToken;
    mapping(address => uint) public userRewardPerTokenPaid;

    event Withdraw(address indexed account, uint amount);
    event DistributeRewards(address indexed sender, uint256 amountStaked, uint256 amount);

    constructor(
        address _controller,
        address _token,
        string memory _derivativeTokenName,
        string memory _derivativeTokenSymbol
    ) VirtualERC677(_derivativeTokenName, _derivativeTokenSymbol) {
        controller = IRewardsPoolController(_controller);
        token = IERC677(_token);
    }

    /**
     * @notice returns an account's total unclaimed rewards (principal balance + newly earned rewards)
     * @param _account account to return rewards for
     * @return account's total unclaimed rewards
     **/
    function balanceOf(address _account) public view virtual override(IERC20, VirtualERC20) returns (uint) {
        return
            (controller.staked(_account) * (rewardPerToken - userRewardPerTokenPaid[_account])) /
            1e18 +
            super.balanceOf(_account);
    }

    /**
     * @notice withdraws an account's earned rewards
     **/
    function withdraw() external {
        uint256 toWithdraw = balanceOf(msg.sender);
        require(toWithdraw > 0, "No rewards to withdraw");

        _withdraw(msg.sender, toWithdraw);
    }

    /**
     * @notice withdraws an account's earned rewards
     * @dev used by PoolOwners
     * @param _account account to withdraw for
     **/
    function withdraw(address _account) external {
        require(msg.sender == address(controller), "Controller only");

        uint256 toWithdraw = balanceOf(_account);

        if (toWithdraw > 0) {
            _withdraw(_account, toWithdraw);
        }
    }

    /**
     * @notice ERC677 implementation that proxies reward distribution
     **/
    function onTokenTransfer(
        address,
        uint256,
        bytes calldata
    ) external {
        require(msg.sender == address(token), "Only callable by token");
        distributeRewards();
    }

    /**
     * @notice distributes new rewards that have been deposited
     **/
    function distributeRewards() public {
        require(controller.totalStaked() > 0, "Cannot distribute when nothing is staked");
        uint256 toDistribute = token.balanceOf(address(this)) - withdrawableRewards;
        withdrawableRewards += toDistribute;
        _updateRewardPerToken(toDistribute);
        emit DistributeRewards(msg.sender, controller.totalStaked(), toDistribute);
    }

    /**
     * @notice updates an account's principal reward balance
     * @param _account account to update for
     **/
    function updateReward(address _account) public virtual {
        uint toMint = balanceOf(_account) - super.balanceOf(_account);
        if (toMint > 0) {
            _mint(_account, toMint);
        }
        userRewardPerTokenPaid[_account] = rewardPerToken;
    }

    /**
     * @notice withdraws rewards for an account
     * @param _account account to withdraw for
     * @param _amount amount to withdraw
     **/
    function _withdraw(address _account, uint _amount) internal {
        updateReward(_account);
        _burn(_account, _amount);
        withdrawableRewards -= _amount;
        token.safeTransfer(_account, _amount);
        emit Withdraw(_account, _amount);
    }

    /**
     * @notice updates rewardPerToken
     * @param _reward deposited reward amount
     **/
    function _updateRewardPerToken(uint _reward) internal {
        uint totalStaked = controller.totalStaked();
        require(totalStaked > 0, "Staked amount must be > 0");
        rewardPerToken += ((_reward * 1e18) / totalStaked);
    }

    /**
     * @notice transfers unclaimed rewards from one account to another
     * @param _from account to transfer from
     * @param _to account to transfer to
     * @param _amount amount to transfer
     **/
    function _transfer(
        address _from,
        address _to,
        uint _amount
    ) internal override {
        updateReward(_from);
        super._transfer(_from, _to, _amount);
    }
}
