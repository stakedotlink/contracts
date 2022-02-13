// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.11;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./tokens/base/VirtualERC677.sol";

/**
 * @title RewardsPool
 * @dev Base rewards pool to be inherited from - handles rewards distribution of an asset based on a staking derivative token
 * that represents a user's staked balance
 */
contract RewardsPool is VirtualERC677 {
    using SafeERC20 for IERC677;

    IERC677 public token;
    IERC677 public derivativeToken;
    uint256 public rewardPerToken;

    mapping(address => uint256) public userRewardPerTokenPaid;

    event Withdraw(address indexed account, uint256 amount);

    constructor(
        address _token,
        string memory _dTokenName,
        string memory _dTokenSymbol
    ) VirtualERC677(_dTokenName, _dTokenSymbol) {
        token = IERC677(_token);
        derivativeToken = IERC677(address(this));
    }

    /**
     * @dev calculates an account's total unclaimed rewards (principal balance + newly earned rewards)
     * @param _account account to calculate rewards for
     * @return account's total unclaimed rewards
     **/
    function balanceOf(address _account) public view virtual override returns (uint256) {
        return
            (derivativeToken.balanceOf(_account) * (rewardPerToken - userRewardPerTokenPaid[_account])) /
            1e18 +
            super.balanceOf(_account);
    }

    /**
     * @dev updates an account's principal reward balance
     * @param _account account to update for
     **/
    function updateReward(address _account) public {
        uint256 toMint = balanceOf(_account) - super.balanceOf(_account);
        if (toMint > 0) {
            _mint(_account, toMint);
        }
        userRewardPerTokenPaid[_account] = rewardPerToken;
    }

    /**
     * @dev updates rewardPerToken
     * @param _reward deposited reward amount
     **/
    function _updateRewardPerToken(uint256 _reward) internal {
        require(derivativeToken.totalSupply() > 0, "Staked amount must be > 0");
        rewardPerToken = rewardPerToken + ((_reward * 1e18) / derivativeToken.totalSupply());
    }

    /**
     * @dev withdraws rewards for an account
     * @param _account account to withdraw for
     * @param _amount amount to withdraw
     **/
    function _withdraw(address _account, uint256 _amount) internal {
        updateReward(_account);
        _burn(_account, _amount);
        token.safeTransfer(_account, _amount);
        emit Withdraw(_account, _amount);
    }

    /**
     * @dev transfers unclaimed rewards from one account to another
     * @param _from account to transfer from
     * @param _to account to transfer to
     * @param _amount amount to transfer
     **/
    function _transfer(
        address _from,
        address _to,
        uint256 _amount
    ) internal virtual override {
        updateReward(_from);
        super._transfer(_from, _to, _amount);
    }
}
