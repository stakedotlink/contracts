// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./base/ERC677.sol";

/**
 * @title Allowance token for staking fair-access
 * @notice Allows for an elastic supply where allowance is calculated by balance & supply
 */
contract StakingAllowance is ERC677, Ownable {
    constructor(string memory _name, string memory _symbol) ERC677(_name, _symbol, 0) {}

    /**
     * @dev Mints a given amount of tokens to an account
     * @param _account address to mint to
     * @param _amount amount of tokens to mint
     * @param _calldata the call data to send on `transferAndCall`
     **/
    function mint(
        address _account,
        uint256 _amount,
        bytes calldata _calldata
    ) public onlyOwner {
        _mint(msg.sender, _amount);
        transferAndCall(_account, _amount, _calldata);
    }

    /**
     * @dev Burns a given amount of tokens from the sender
     * @param _amount amount of tokens to burn
     **/
    function burn(uint256 _amount) public {
        _burn(msg.sender, _amount);
    }

    /**
     * @dev Destroys `amount` tokens from `account`, deducting from the caller's
     * allowance.
     *
     * See {ERC20-_burn} and {ERC20-allowance}.
     *
     * Requirements:
     *
     * - the caller must have allowance for ``accounts``'s tokens of at least
     * `amount`.
     */
    function burnFrom(address account, uint256 amount) public {
        _spendAllowance(account, msg.sender, amount);
        _burn(account, amount);
    }
}
