// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../tokens/base/VirtualERC677.sol";

/**
 * @title RewardsPool
 * @notice Base rewards pool to be inherited from - handles reward distribution for a single asset
 * @dev rewards can only be postive (user balances can only increase)
 */
abstract contract RewardsPool is VirtualERC677 {
    using SafeERC20 for IERC677;

    IERC677 public token;

    uint public rewardPerToken;
    mapping(address => uint) public userRewardPerTokenPaid;

    constructor(
        address _token,
        string memory _derivativeTokenName,
        string memory _derivativeTokenSymbol
    ) VirtualERC677(_derivativeTokenName, _derivativeTokenSymbol) {
        token = IERC677(_token);
    }

    /**
     * @notice returns an account's total unclaimed rewards (principal balance + newly earned rewards)
     * @param _account account to return rewards for
     * @return account's total unclaimed rewards
     **/
    function balanceOf(address _account) public view virtual override(IERC20, VirtualERC20) returns (uint) {
        return (_staked(_account) * (rewardPerToken - userRewardPerTokenPaid[_account])) / 1e18 + super.balanceOf(_account);
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
     * @notice returns an account's staked amount
     * @param _account to return staked amount for
     * @return account's staked amount
     **/
    function _staked(address _account) internal view virtual returns (uint);

    /**
     * @notice returns the total staked amount
     * @return total staked amount
     **/
    function _totalStaked() internal view virtual returns (uint);

    /**
     * @notice updates rewardPerToken
     * @param _reward deposited reward amount
     **/
    function _updateRewardPerToken(uint _reward) internal {
        uint totalStaked = _totalStaked();
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
