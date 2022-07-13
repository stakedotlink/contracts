// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../interfaces/IRewardsPoolController.sol";
import "../interfaces/IRewardsPool.sol";
import "../RewardsPool.sol";

/**
 * @title Rewards Pool Controller
 * @notice Acts as a proxy for any number of rewards pools
 */
abstract contract RewardsPoolController is Ownable, IRewardsPoolController {
    using SafeERC20 for IERC20;

    mapping(address => IRewardsPool) public tokenPools;
    address[] private tokens;

    event WithdrawRewards(address indexed account);
    event AddToken(address indexed token, address rewardsPool);
    event RemoveToken(address indexed token, address rewardsPool);

    modifier updateRewards(address _account) {
        for (uint i = 0; i < tokens.length; i++) {
            tokenPools[tokens[i]].updateReward(_account);
        }
        _;
    }

    /**
     * @notice returns a list of configs for all supported tokens
     * @return list of token configs
     **/
    function supportedTokens() external view returns (address[] memory) {
        return tokens;
    }

    /**
     * @notice returns true/false to whether a given token is supported
     * @param _token token address
     * @return is token supported
     **/
    function isTokenSupported(address _token) public view returns (bool) {
        return address(tokenPools[_token]) != address(0) ? true : false;
    }

    /**
     * @notice get all token balances of supported tokens within the controller
     * @return list of tokens with a list of token balances
     **/
    function tokenBalances() external view returns (address[] memory, uint[] memory) {
        uint[] memory balances = new uint[](tokens.length);

        for (uint i = 0; i < tokens.length; i++) {
            balances[i] = IERC20(tokens[i]).balanceOf(address(this));
        }

        return (tokens, balances);
    }

    /**
     * @notice distributes token balances to their equivalent reward pools
     * @param _tokens list of token addresses
     */
    function distributeTokens(address[] memory _tokens) public {
        for (uint i = 0; i < _tokens.length; i++) {
            distributeToken(_tokens[i]);
        }
    }

    /**
     * @notice distributes a token balance to its equivalent reward pool
     * @param _token token address
     */
    function distributeToken(address _token) public {
        require(isTokenSupported(_token), "Token not supported");

        IERC20 token = IERC20(_token);
        uint balance = token.balanceOf(address(this));
        require(balance > 0, "Cannot distribute zero balance");

        token.safeTransfer(address(tokenPools[_token]), balance);
        tokenPools[_token].distributeRewards();
    }

    /**
     * @notice returns a list of withdrawable rewards for an account
     * @param _account account to return reward amounts for
     * @return list of withdrawable reward amounts
     **/
    function withdrawableRewards(address _account) external view returns (uint[] memory) {
        uint[] memory withdrawable = new uint[](tokens.length);

        for (uint i = 0; i < tokens.length; i++) {
            withdrawable[i] = tokenPools[tokens[i]].balanceOf(_account);
        }

        return withdrawable;
    }

    /**
     * @notice withdraws an account's earned rewards for a list of tokens
     * @param _tokens list of token addresses to withdraw rewards from
     **/
    function withdrawRewards(address[] memory _tokens) public {
        for (uint i = 0; i < _tokens.length; i++) {
            tokenPools[_tokens[i]].withdraw(msg.sender);
        }
        emit WithdrawRewards(msg.sender);
    }

    /**
     * @notice adds a new token
     * @param _token token to add
     * @param _rewardsPool token rewards pool to add
     **/
    function addToken(address _token, address _rewardsPool) external onlyOwner {
        require(!isTokenSupported(_token), "Token is already supported");

        tokenPools[_token] = IRewardsPool(_rewardsPool);
        tokens.push(_token);

        if (IERC20(_token).balanceOf(address(this)) > 0) {
            distributeToken(_token);
        }

        emit AddToken(_token, _rewardsPool);
    }

    /**
     * @notice removes a supported token
     * @param _token address of token
     **/
    function removeToken(address _token) external onlyOwner {
        require(isTokenSupported(_token), "Token is not supported");

        IRewardsPool rewardsPool = tokenPools[_token];
        delete (tokenPools[_token]);
        for (uint i = 0; i < tokens.length; i++) {
            if (tokens[i] == _token) {
                tokens[i] = tokens[tokens.length - 1];
                tokens.pop();
                break;
            }
        }

        emit RemoveToken(_token, address(rewardsPool));
    }
}
