// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.11;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/IOwnersRewardsPool.sol";
import "./interfaces/IAllowance.sol";
import "./interfaces/IERC677.sol";

/**
 * @title Pool Owners
 * @dev Handles owners token staking, staking allowance minting/burning, & owners rewards distribution
 */
contract PoolOwners is Ownable {
    using SafeERC20 for IERC677;

    IAllowance public allowanceToken;
    IERC677 public ownersToken;

    mapping(address => uint) private ownersTokenStakes;
    uint private totalOwnersTokenStakes;

    address[] private tokens;
    mapping(address => address) public rewardPools;

    event StakeOwnersToken(address indexed account, uint amount);
    event WithdrawOwnersToken(address indexed account, uint amount);
    event WithdrawRewards(address indexed account);
    event AddToken(address indexed token, address rewardsPool);
    event RemoveToken(address indexed token);

    constructor(address _ownersToken, address _allowanceToken) {
        ownersToken = IERC677(_ownersToken);
        allowanceToken = IAllowance(_allowanceToken);
    }

    modifier updateRewards(address _account) {
        for (uint16 i = 0; i < tokens.length; i++) {
            IOwnersRewardsPool(rewardPools[tokens[i]]).updateReward(_account);
        }
        _;
    }

    /**
     * @dev Returns a list of all supported tokens
     * @return list of tokens
     **/
    function supportedTokens() external view returns (address[] memory) {
        return tokens;
    }

    /**
     * @dev Returns an account's staked owner's token balance
     * @return staked balance
     **/
    function balanceOf(address _account) external view returns (uint) {
        return ownersTokenStakes[_account];
    }

    /**
     * @dev returns the total amount of owners tokens staked
     * @return total amount staked
     **/
    function totalSupply() external view returns (uint256) {
        return totalOwnersTokenStakes;
    }

    /**
     * @dev returns a list of withdrawable rewards for an account
     * @param _account account to return reward amounts for
     * @return list of withdrawable reward amounts
     **/
    function withdrawableRewards(address _account) external view returns (uint[] memory) {
        uint[] memory withdrawable = new uint[](tokens.length);

        for (uint i = 0; i < tokens.length; i++) {
            withdrawable[i] = IOwnersRewardsPool(rewardPools[tokens[i]]).balanceOf(_account);
        }

        return withdrawable;
    }

    /**
     * @dev ERC677 implementation that proxies staking
     * @param _sender of the token transfer
     * @param _value of the token transfer
     **/
    function onTokenTransfer(
        address _sender,
        uint _value,
        bytes calldata
    ) external {
        require(msg.sender == address(ownersToken), "Sender must be staking token");
        _stake(_sender, _value);
    }

    /**
     * @dev stakes owners tokens & mints allowance tokens
     * @param _amount amount to stake
     **/
    function stake(uint _amount) external {
        ownersToken.safeTransferFrom(msg.sender, address(this), _amount);
        _stake(msg.sender, _amount);
    }

    /**
     * @dev burns allowance tokens and withdraws staked owners tokens
     * @param _amount amount to withdraw
     **/
    function withdraw(uint _amount) public updateRewards(msg.sender) {
        allowanceToken.burn(msg.sender, _amount);
        ownersTokenStakes[msg.sender] -= _amount;
        totalOwnersTokenStakes -= _amount;
        ownersToken.safeTransfer(msg.sender, _amount);
        emit WithdrawOwnersToken(msg.sender, _amount);
    }

    /**
     * @dev withdraws an account's earned rewards for a specific token
     * @param _token token to withdraw
     **/
    function withdrawRewards(address _token) public {
        require(rewardPools[_token] != address(0), "Token is not supported");

        _withdrawReward(_token, msg.sender);
        emit WithdrawRewards(msg.sender);
    }

    /**
     * @dev withdraws an account's earned rewards for a all tokens
     **/
    function withdrawAllRewards() public {
        for (uint i = 0; i < tokens.length; i++) {
            _withdrawReward(tokens[i], msg.sender);
        }
        emit WithdrawRewards(msg.sender);
    }

    /**
     * @dev withdraws an account's earned rewards for all tokens and withdraws their owners tokens
     **/
    function exit() external {
        withdraw(ownersTokenStakes[msg.sender]);
        withdrawAllRewards();
    }

    /**
     * @dev adds a new token
     * @param _token token to add
     * @param _rewardPool token reward pool to add
     **/
    function addToken(address _token, address _rewardPool) external onlyOwner {
        require(rewardPools[_token] == address(0), "Cannot add token that is already supported");

        tokens.push(_token);
        rewardPools[_token] = _rewardPool;
        emit AddToken(_token, _rewardPool);
    }

    /**
     * @dev removes an existing token
     * @param _token token to remove
     **/
    function removeToken(address _token) external onlyOwner {
        require(rewardPools[_token] != address(0), "Cannot remove token that is not supported");

        delete rewardPools[_token];

        for (uint i = 0; i < tokens.length; i++) {
            if (tokens[i] == _token) {
                tokens[i] = tokens[tokens.length - 1];
                tokens.pop();
                break;
            }
        }

        emit RemoveToken(_token);
    }

    /**
     * @dev stakes owners tokens & mints allowance tokens
     * @param _account account to stake for
     * @param _amount amount to stake
     **/
    function _stake(address _account, uint _amount) private updateRewards(_account) {
        ownersTokenStakes[_account] += _amount;
        totalOwnersTokenStakes += _amount;
        allowanceToken.mint(_account, _amount);
        emit StakeOwnersToken(_account, _amount);
    }

    /**
     * @dev withdraws rewards for a specific token
     * @param _token token to withdraw
     * @param _account account to withdraw for
     **/
    function _withdrawReward(address _token, address _account) private {
        IOwnersRewardsPool(rewardPools[_token]).withdraw(_account);
    }
}
