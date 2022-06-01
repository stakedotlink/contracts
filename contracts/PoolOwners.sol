// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./tokens/base/ERC677.sol";
import "./interfaces/IERC677.sol";
import "./base/RewardsPoolController.sol";

/**
 * @title Pool Owners
 * @notice Handles owners token staking, staking allowance, & owners rewards distribution
 */
contract PoolOwners is ERC677, RewardsPoolController {
    using SafeERC20 for IERC677;

    IERC677 public ownersToken;
    mapping(address => uint) private ownersTokenStakes;

    event Stake(address indexed account, uint amount);
    event Withdraw(address indexed account, uint amount);

    constructor(
        address _ownersToken,
        string memory _allowanceTokenName,
        string memory _allowanceTokenSymbol
    ) ERC677(_allowanceTokenName, _allowanceTokenSymbol, 0) {
        ownersToken = IERC677(_ownersToken);
    }

    /**
     * @notice returns an account's staked amount for use by reward pools
     * controlled by this contract
     * @dev required by RewardsPoolController
     * @return account's staked amount
     */
    function rpcStaked(address _account) external view returns (uint) {
        return staked(_account);
    }

    /**
     * @notice returns the total staked amount for use by reward pools
     * controlled by this contract
     * @dev required by RewardsPoolController
     * @return total staked amount
     */
    function rpcTotalStaked() external view returns (uint) {
        return totalSupply();
    }

    /**
     * @notice returns an account's staked amount
     * @return account's staked amount
     */
    function staked(address _account) public view returns (uint) {
        return ownersTokenStakes[_account];
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
     * @notice stakes owners tokens & mints allowance tokens
     * @param _account account to stake for
     * @param _amount amount to stake
     **/
    function _stake(address _account, uint _amount) private updateRewards(_account) {
        _mint(_account, _amount);
        ownersTokenStakes[_account] += _amount;

        emit Stake(_account, _amount);
    }
}
