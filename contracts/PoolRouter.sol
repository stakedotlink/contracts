// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.11;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "./interfaces/IERC677.sol";
import "./interfaces/IStakingPool.sol";

/**
 * @title PoolRouter
 * @dev Handles staking allowances and acts as a proxy for staking pools
 */
contract PoolRouter is Ownable {
    using SafeERC20 for IERC677;

    IERC677 public allowanceToken;
    mapping(address => uint) public allowanceStakes;

    struct StakingConfig {
        IERC677 token;
        IStakingPool stakingPool;
        uint stakePerAllowance;
        mapping(address => uint) tokenStakes;
    }

    address[] private tokens;
    mapping(address => StakingConfig) public stakingConfigs;

    constructor(address _allowanceToken) {
        allowanceToken = IERC677(_allowanceToken);
    }

    /**
     * @dev Returns a list of all supported tokens
     * @return list of tokens
     **/
    function supportedTokens() external view returns (address[] memory) {
        return tokens;
    }

    /**
     * @dev Calculates the amount of unused allowance for an account
     * @param _account account to calculate for
     * @return amount of unused allowance
     **/
    function unusedAllowance(address _account) external view returns (uint) {
        uint maxAllowanceInUse;

        for (uint i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            StakingConfig storage config = stakingConfigs[token];

            uint allowanceInUse = config.tokenStakes[_account] / config.stakePerAllowance;
            maxAllowanceInUse = Math.max(allowanceInUse, maxAllowanceInUse);
        }

        if (maxAllowanceInUse >= allowanceStakes[_account]) return 0;
        return allowanceStakes[_account] - maxAllowanceInUse;
    }

    /**
     * @dev ERC677 implementation to receive a token or allowance stake
     * @param _sender of the token transfer
     * @param _value of the token transfer
     **/
    function onTokenTransfer(
        address _sender,
        uint _value,
        bytes calldata
    ) external {
        require(
            msg.sender == address(allowanceToken) || address(stakingConfigs[msg.sender].token) == msg.sender,
            "Only callable by supported tokens"
        );

        if (msg.sender == address(allowanceToken)) {
            allowanceStakes[_sender] += _value;
            return;
        }

        _stake(msg.sender, _sender, _value);
    }

    /**
     * @dev stakes tokens in a staking pool
     * @param _token token to stake
     * @param _amount amount to stake
     **/
    function stake(address _token, uint _amount) external {
        require(_tokenSupported(_token), "Token not supported");

        IERC677(_token).safeTransferFrom(msg.sender, address(this), _amount);
        _stake(_token, msg.sender, _amount);
    }

    /**
     * @dev withdraws tokens from a staking pool
     * @param _token token to withdraw
     * @param _amount amount to withdraw
     **/
    function withdraw(address _token, uint _amount) external {
        require(_tokenSupported(_token), "Token not supported");

        StakingConfig storage config = stakingConfigs[_token];

        if (_amount >= config.tokenStakes[msg.sender]) {
            config.tokenStakes[msg.sender] = 0;
        } else {
            config.tokenStakes[msg.sender] -= _amount;
        }

        config.stakingPool.withdraw(msg.sender, _amount);
        IERC677(_token).safeTransfer(msg.sender, _amount);
    }

    /**
     * @dev withdraws allowance
     * @param _amount amount to withdraw
     **/
    function withdrawAllowance(uint _amount) external {
        require(_amount <= allowanceStakes[msg.sender], "Cannot withdraw more than staked allowance balance");

        uint allowanceToRemain = allowanceStakes[msg.sender] - _amount;

        for (uint i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            StakingConfig storage config = stakingConfigs[token];

            uint allowanceInUse = config.tokenStakes[msg.sender] / config.stakePerAllowance;
            require(allowanceInUse <= allowanceToRemain, "Cannot withdraw allowance that is in use");
        }

        allowanceStakes[msg.sender] = allowanceToRemain;
        allowanceToken.safeTransfer(msg.sender, _amount);
    }

    /**
     * @dev adds a new token and staking config
     * @param _token staking token to add
     * @param _stakingPool staking pool for token
     * @param _stakePerAllowance stake amount per allowance
     **/
    function addToken(
        address _token,
        address _stakingPool,
        uint _stakePerAllowance
    ) external onlyOwner {
        require(!_tokenSupported(_token), "Cannot add token that is already supported");

        StakingConfig storage config = stakingConfigs[_token];
        config.token = IERC677(_token);
        config.stakingPool = IStakingPool(_stakingPool);
        config.stakePerAllowance = _stakePerAllowance;
        tokens.push(_token);
        IERC677(_token).safeApprove(_stakingPool, type(uint).max);
    }

    /**
     * @dev removes an existing token and staking config
     * @param _token staking token to remove
     **/
    function removeToken(address _token) external onlyOwner {
        require(_tokenSupported(_token), "Cannot remove token that is not supported");

        delete stakingConfigs[_token].token;

        for (uint i = 0; i < tokens.length; i++) {
            if (tokens[i] == _token) {
                tokens[i] = tokens[tokens.length - 1];
                tokens.pop();
                return;
            }
        }
    }

    /**
     * @dev stakes tokens in a staking pool
     * @param _token token to stake
     * @param _account account to stake for
     * @param _amount amount to stake
     **/
    function _stake(
        address _token,
        address _account,
        uint _amount
    ) private {
        StakingConfig storage config = stakingConfigs[_token];

        uint allowanceRequired = _amount / config.stakePerAllowance;
        uint allowanceInUse = config.tokenStakes[_account] / config.stakePerAllowance;
        require((allowanceInUse + allowanceRequired) <= allowanceStakes[_account], "Not enough allowance staked");

        config.tokenStakes[_account] += _amount;
        config.stakingPool.stake(_account, _amount);
    }

    /**
     * @dev checks if a token is supported
     * @param _token token to check
     * @return whether or not token is supported
     **/
    function _tokenSupported(address _token) private returns (bool) {
        return address(stakingConfigs[_token].token) != address(0);
    }
}
