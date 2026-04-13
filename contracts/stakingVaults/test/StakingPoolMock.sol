// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

/**
 * @dev Minimal StakingPool mock for VaultHub tests.
 *      Implements share price functions, mint/burn for vaults, and ERC20 balance tracking.
 *      Uses 1:1 share price by default (shares == tokens).
 */
contract StakingPoolMock {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    IERC20Upgradeable public token;
    uint256 public sharePrice = 1e18; // 1:1 by default

    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;

    constructor(address _token) {
        token = IERC20Upgradeable(_token);
    }

    function getSharesByStake(uint256 _amount) external view returns (uint256) {
        return (_amount * 1e18) / sharePrice;
    }

    function getStakeByShares(uint256 _shares) external view returns (uint256) {
        return (_shares * sharePrice) / 1e18;
    }

    function mintForVault(address _vault, uint256 _amount) external {
        uint256 shares = (_amount * 1e18) / sharePrice;
        balanceOf[_vault] += shares;
        totalSupply += shares;
    }

    function burnForVault(address _vault, uint256 _amount) external {
        uint256 shares = (_amount * 1e18) / sharePrice;
        balanceOf[_vault] -= shares;
        totalSupply -= shares;
    }

    function mintWithDeposit(address _to, uint256 _amount) external {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        uint256 shares = (_amount * 1e18) / sharePrice;
        balanceOf[_to] += shares;
        totalSupply += shares;
    }

    function donateTokens(uint256 _amount) external {
        token.safeTransferFrom(msg.sender, address(this), _amount);
    }

    uint256 public lastWriteDownAmount;

    function writeDown(uint256 _amount) external {
        lastWriteDownAmount = _amount;
    }

    function transferAndCall(address _to, uint256 _value, bytes calldata) external returns (bool) {
        balanceOf[msg.sender] -= _value;
        balanceOf[_to] += _value;
        return true;
    }

    // --- Test setters ---

    function setSharePrice(uint256 _sharePrice) external {
        sharePrice = _sharePrice;
    }
}
