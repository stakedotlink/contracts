// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IERC677.sol";
import "./base/RewardsPoolController.sol";

/**
 * @title Pool Owners
 * @notice Handles owners token staking & rewards distribution
 */
contract PoolOwners is RewardsPoolController {
    using SafeERC20 for IERC677;

    IERC677 public token;
    mapping(address => uint) private tokenStakes;
    uint public totalStaked;

    event Stake(address indexed account, uint amount);
    event Withdraw(address indexed account, uint amount);

    constructor(address _token) {
        token = IERC677(_token);
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
        return totalStaked;
    }

    /**
     * @notice returns an account's staked amount
     * @return account's staked amount
     */
    function staked(address _account) public view returns (uint) {
        return tokenStakes[_account];
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
        require(
            msg.sender == address(token) || isTokenSupported(msg.sender),
            "Sender must be staking token or supported rewards token"
        );
        if (msg.sender == address(token)) {
            _stake(_sender, _value);
        } else {
            distributeToken(msg.sender);
        }
    }

    /**
     * @notice stakes owners tokens & mints allowance tokens
     * @param _amount amount to stake
     **/
    function stake(uint _amount) external {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        _stake(msg.sender, _amount);
    }

    /**
     * @notice returns a list of all fees
     * @return list of fees
     */
    function getFees() public pure override returns (address[] memory, uint[] memory) {
        address[] memory receivers;
        uint[] memory basisPoints;
        return (receivers, basisPoints);
    }

    /**
     * @notice burns allowance tokens and withdraws staked owners tokens
     * @param _amount amount to withdraw
     **/
    function withdraw(uint _amount) public updateRewards(msg.sender) {
        tokenStakes[msg.sender] -= _amount;
        totalStaked -= _amount;
        token.safeTransfer(msg.sender, _amount);
        emit Withdraw(msg.sender, _amount);
    }

    /**
     * @notice stakes owners tokens & mints allowance tokens
     * @param _account account to stake for
     * @param _amount amount to stake
     **/
    function _stake(address _account, uint _amount) private updateRewards(_account) {
        tokenStakes[_account] += _amount;
        totalStaked += _amount;
        emit Stake(_account, _amount);
    }
}
