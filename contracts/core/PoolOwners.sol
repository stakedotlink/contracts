// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IERC677.sol";
import "./base/RewardsPoolController.sol";
import "./tokens/base/ERC677.sol";

/**
 * @title Pool Owners
 * @notice Handles owners token staking & rewards distribution
 */
contract PoolOwners is RewardsPoolController {
    using SafeERC20 for IERC677;

    IERC677 public immutable token;

    event Stake(address indexed account, uint amount);
    event Withdraw(address indexed account, uint amount);

    constructor(
        address _token,
        string memory _derivativeTokenName,
        string memory _derivativeTokenSymbol
    ) RewardsPoolController(_derivativeTokenName, _derivativeTokenSymbol) {
        token = IERC677(_token);
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
    ) external override {
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
     * @notice burns allowance tokens and withdraws staked owners tokens
     * @param _amount amount to withdraw
     **/
    function withdraw(uint _amount) public updateRewards(msg.sender) {
        _burn(msg.sender, _amount);
        token.safeTransfer(msg.sender, _amount);
        emit Withdraw(msg.sender, _amount);
    }

    /**
     * @notice stakes owners tokens & mints allowance tokens
     * @param _account account to stake for
     * @param _amount amount to stake
     **/
    function _stake(address _account, uint _amount) private updateRewards(_account) {
        _mint(_account, _amount);
        emit Stake(_account, _amount);
    }
}
