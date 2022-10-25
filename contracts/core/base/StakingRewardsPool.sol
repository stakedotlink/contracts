// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../tokens/base/VirtualERC677.sol";

/**
 * @title StakingRewardsPool
 * @notice Handles staking and reward distribution for a single asset
 * @dev Rewards can be positive or negative (user balances can increase and decrease)
 */
abstract contract StakingRewardsPool is VirtualERC677 {
    using SafeERC20 for IERC677;

    IERC677 public immutable token;

    mapping(address => uint) private shares;
    uint public totalShares;

    constructor(
        address _token,
        string memory _derivativeTokenName,
        string memory _derivativeTokenSymbol
    ) VirtualERC677(_derivativeTokenName, _derivativeTokenSymbol) {
        token = IERC677(_token);
    }

    /**
     * @notice returns the total supply of staking derivative tokens
     * @return total supply
     */
    function totalSupply() public view override(IERC20, VirtualERC20) returns (uint) {
        return _totalStaked();
    }

    /**
     * @notice returns an account's stake balance
     * @param _account account to return balance for
     * @return account's stake balance
     **/
    function balanceOf(address _account) public view override(IERC20, VirtualERC20) returns (uint) {
        uint balance = getStakeByShares(shares[_account]);
        if (balance < 100) {
            return 0;
        } else {
            return balance;
        }
    }

    /**
     * @notice returns an account's share balance
     * @param _account account to return balance for
     * @return account's share balance
     **/
    function sharesOf(address _account) public view returns (uint) {
        return shares[_account];
    }

    /**
     * @notice returns the amount of shares that corresponds to a staked amount
     * @param _amount staked amount
     * @return amount of shares
     **/
    function getSharesByStake(uint256 _amount) public view returns (uint256) {
        uint totalStaked = _totalStaked();
        if (totalStaked == 0) {
            return 0;
        } else {
            return (_amount * totalShares) / totalStaked;
        }
    }

    /**
     * @notice returns the amount of stake that corresponds to an amount of shares
     * @param _amount shares amount
     * @return amount of stake
     **/
    function getStakeByShares(uint256 _amount) public view returns (uint256) {
        if (totalShares == 0) {
            return 0;
        } else {
            return (_amount * _totalStaked()) / totalShares;
        }
    }

    /**
     * @notice returns the total amount of assets staked in the pool
     * @return total staked amount
     */
    function _totalStaked() internal view virtual returns (uint);

    /**
     * @notice transfers a stake balance from one account to another
     * @param _sender account to transfer from
     * @param _recipient account to transfer to
     * @param _amount amount to transfer
     **/
    function _transfer(
        address _sender,
        address _recipient,
        uint _amount
    ) internal override {
        uint sharesToTransfer = getSharesByStake(_amount);

        require(_sender != address(0), "Transfer from the zero address");
        require(_recipient != address(0), "Transfer to the zero address");
        require(shares[_sender] >= sharesToTransfer, "Transfer amount exceeds balance");

        shares[_sender] -= sharesToTransfer;
        shares[_recipient] += sharesToTransfer;

        emit Transfer(_sender, _recipient, _amount);
    }

    /**
     * @notice mints new shares to an account
     * @dev takes a stake amount and calculates the amount of shares it corresponds to
     * @param _recipient account to mint shares for
     * @param _amount stake amount
     **/
    function _mint(address _recipient, uint _amount) internal override {
        uint sharesToMint = getSharesByStake(_amount);
        if (sharesToMint == 0) {
            sharesToMint = _amount;
        }

        _mintShares(_recipient, sharesToMint);
    }

    /**
     * @notice mints new shares to an account
     * @param _recipient account to mint shares for
     * @param _amount shares amount
     **/
    function _mintShares(address _recipient, uint _amount) internal {
        require(_recipient != address(0), "Mint to the zero address");

        totalShares += _amount;
        shares[_recipient] += _amount;
    }

    /**
     * @notice burns shares belonging to an account
     * @dev takes a stake amount and calculates the amount of shares it corresponds to
     * @param _account account to burn shares for
     * @param _amount stake amount
     **/
    function _burn(address _account, uint _amount) internal override {
        uint sharesToBurn = getSharesByStake(_amount);

        require(_account != address(0), "Burn from the zero address");
        require(shares[_account] >= sharesToBurn, "Burn amount exceeds balance");

        totalShares -= sharesToBurn;
        shares[_account] -= sharesToBurn;
    }
}
