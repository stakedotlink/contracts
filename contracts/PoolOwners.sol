// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./tokens/base/ERC677.sol";
import "./interfaces/IOwnersRewardsPool.sol";
import "./interfaces/IERC677.sol";

/**
 * @title Pool Owners
 * @notice Handles owners token staking, staking allowance, & owners rewards distribution
 */
contract PoolOwners is ERC677, Ownable {
    using SafeERC20 for IERC677;

    struct TokenConfig {
        IERC20 token;
        IOwnersRewardsPool rewardsPool;
    }

    TokenConfig[] private tokenConfigs;

    IERC677 public ownersToken;
    mapping(address => uint) private ownersTokenStakes;

    event Stake(address indexed account, uint amount);
    event Withdraw(address indexed account, uint amount);
    event WithdrawRewards(address indexed account);
    event AddToken(address indexed token, address rewardsPool);
    event RemoveToken(address indexed token, address rewardsPool);

    constructor(
        address _ownersToken,
        string memory _allowanceTokenName,
        string memory _allowanceTokenSymbol
    ) ERC677(_allowanceTokenName, _allowanceTokenSymbol, 0) {
        ownersToken = IERC677(_ownersToken);
    }

    modifier updateRewards(address _account) {
        for (uint16 i = 0; i < tokenConfigs.length; i++) {
            tokenConfigs[i].rewardsPool.updateReward(_account);
        }
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
     * @notice returns an account's staked amount
     * @return account's staked amount
     */
    function staked(address _account) external view returns (uint) {
        return ownersTokenStakes[_account];
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
     * @notice ERC677 implementation that proxies staking
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
     * @notice stakes owners tokens & mints allowance tokens
     * @param _amount amount to stake
     **/
    function stake(uint _amount) external {
        ownersToken.safeTransferFrom(msg.sender, address(this), _amount);
        _stake(msg.sender, _amount);
    }

    /**
     * @notice burns allowance tokens and withdraws staked owners tokens
     * @param _amount amount to withdraw
     **/
    function withdraw(uint _amount) public updateRewards(msg.sender) {
        _burn(msg.sender, _amount);
        ownersTokenStakes[msg.sender] -= _amount;
        ownersToken.safeTransfer(msg.sender, _amount);
        emit Withdraw(msg.sender, _amount);
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
    function addToken(address _token, address _rewardsPool) external onlyOwner {
        require(!_tokenIsSupported(_token), "Token is already supported");

        TokenConfig memory tokenConfig = TokenConfig(IERC20(_token), IOwnersRewardsPool(_rewardsPool));
        tokenConfigs.push(tokenConfig);

        emit AddToken(_token, _rewardsPool);
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
     * @notice stakes owners tokens & mints allowance tokens
     * @param _account account to stake for
     * @param _amount amount to stake
     **/
    function _stake(address _account, uint _amount) private updateRewards(_account) {
        _mint(_account, _amount);
        ownersTokenStakes[_account] += _amount;

        emit Stake(_account, _amount);
    }

    /**
     * @notice checks whether or not a token is supported
     * @param _token address of token
     * @return true if token exists, false otherwise
     **/
    function _tokenIsSupported(address _token) private view returns (bool) {
        for (uint i = 0; i < tokenConfigs.length; i++) {
            if (address(tokenConfigs[i].token) == _token) {
                return true;
            }
        }
        return false;
    }
}
