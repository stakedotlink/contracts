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
    struct TokenConfig {
        IERC20 token;
        IRewardsPool rewardsPool;
    }

    TokenConfig[] private tokenConfigs;

    event WithdrawRewards(address indexed account);
    event AddToken(address indexed token, address rewardsPool);
    event RemoveToken(address indexed token, address rewardsPool);

    modifier updateRewards(address _account) {
        for (uint i = 0; i < tokenConfigs.length; i++) {
            tokenConfigs[i].rewardsPool.updateReward(_account);
        }
        _;
    }

    modifier isPoolCreator() {
        bool found = false;
        address[] memory poolCreators = rewardPoolCreators();
        for (uint i = 0; i < poolCreators.length; i++) {
            if (poolCreators[i] == msg.sender) {
                found = true;
                break;
            }
        }
        require(found, "Caller is not a pool creator");
        _;
    }

    /**
     * @notice returns a list of configs for all supported tokens
     * @return list of token configs
     **/
    function supportedTokens() external view returns (TokenConfig[] memory) {
        return tokenConfigs;
    }

    /**
     * @notice returns true/false to whether a given token is supported
     * @param _token token address
     * @return is token supported
     **/
    function isTokenSupported(address _token) public view returns (bool) {
        for (uint i = 0; i < tokenConfigs.length; i++) {
            if (_token == address(tokenConfigs[i].token)) {
                return true;
            }
        }
        return false;
    }

    /**
     * @notice fetch the list of addresses authorised to create RewardPools
     * @return pool creator address list
     **/
    function rewardPoolCreators() public view virtual returns (address[] memory) {
        address[] memory addresses = new address[](1);
        addresses[0] = super.owner();
        return addresses;
    }

    /**
     * @notice returns a list of withdrawable rewards for an account
     * @param _account account to return reward amounts for
     * @return list of withdrawable reward amounts
     **/
    function withdrawableRewards(address _account) external view returns (uint[] memory) {
        uint[] memory withdrawable = new uint[](tokenConfigs.length);

        for (uint i = 0; i < tokenConfigs.length; i++) {
            withdrawable[i] = tokenConfigs[i].rewardsPool.balanceOf(_account);
        }

        return withdrawable;
    }

    /**
     * @notice withdraws an account's earned rewards for a list of tokens
     * @param _idxs indexes of tokens to withdraw
     **/
    function withdrawRewards(uint[] memory _idxs) public {
        for (uint i = 0; i < _idxs.length; i++) {
            tokenConfigs[_idxs[i]].rewardsPool.withdraw(msg.sender);
        }
        emit WithdrawRewards(msg.sender);
    }

    /**
     * @notice adds a new token
     * @param _token token to add
     * @param _rewardsPool token rewards pool to add
     **/
    function addToken(address _token, address _rewardsPool) external isPoolCreator {
        require(!isTokenSupported(_token), "Token is already supported");
        _addToken(_token, _rewardsPool);
    }

    /**
     * @notice removes a supported token
     * @param _idx index of token to remove
     **/
    function removeToken(uint _idx) external onlyOwner {
        require(_idx < tokenConfigs.length, "Token is not supported");

        TokenConfig memory tokenConfig = tokenConfigs[_idx];

        tokenConfigs[_idx] = tokenConfigs[tokenConfigs.length - 1];
        tokenConfigs.pop();

        emit RemoveToken(address(tokenConfig.token), address(tokenConfig.rewardsPool));
    }

    /**
     * @notice adds a new token
     * @param _token token to add
     * @param _rewardsPool token rewards pool to add
     **/
    function _addToken(address _token, address _rewardsPool) private {
        TokenConfig memory tokenConfig = TokenConfig(IERC20(_token), IRewardsPool(_rewardsPool));
        tokenConfigs.push(tokenConfig);

        emit AddToken(_token, _rewardsPool);
    }
}
