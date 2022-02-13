// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.11;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./base/ERC677.sol";

/**
 * @title Allowance
 * @dev Staking allowance token
 */
contract Allowance is ERC677, Ownable {
    address public poolOwners;

    constructor(string memory _name, string memory _symbol) ERC677(_name, _symbol, 0) {}

    modifier onlyPoolOwners() {
        require(poolOwners == msg.sender, "PoolOwners only");
        _;
    }

    /**
     * @dev mints tokens
     * @param _account address to mint tokens for
     * @param _amount amount to mint
     **/
    function mint(address _account, uint256 _amount) external onlyPoolOwners {
        _mint(_account, _amount);
    }

    /**
     * @dev burns tokens
     * @param _account address to burn tokens from
     * @param _amount amount to burn
     **/
    function burn(address _account, uint256 _amount) external onlyPoolOwners {
        _burn(_account, _amount);
    }

    /**
     * @dev sets pool owners address if not already set
     * @param _poolOwners address to set
     **/
    function setPoolOwners(address _poolOwners) external onlyOwner {
        require(_poolOwners == address(0), "PoolOwners is already set");
        poolOwners = _poolOwners;
    }
}
