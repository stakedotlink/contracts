// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Operator Whitelist
 * @notice Tracks which accounts are able to add new whitelisted operators
 */
contract OperatorWhitelist is Ownable {
    struct WhitelistEntry {
        bool isWhitelisted;
        bool isUsed;
    }

    address public wlOperatorController;
    mapping(address => WhitelistEntry) private whitelist;

    error OnlyWLOperatorController();
    error AccountAlreadyWhitelisted(address account);
    error AccountNotWhitelisted(address _account);
    error WhitelistSpotAlreadyUsed(address _account);

    constructor(address _wlOperatorController, address[] memory _whitelist) {
        wlOperatorController = _wlOperatorController;

        for (uint256 i = 0; i < _whitelist.length; i++) {
            whitelist[_whitelist[i]] = WhitelistEntry(true, false);
        }
    }

    /**
     * @notice Returns a whitelist entry
     * @param _account account to return entry for
     * @return entry whitelist entry
     */
    function getWhitelistEntry(address _account) external view returns (WhitelistEntry memory) {
        return whitelist[_account];
    }

    /**
     * @notice Checks whether or not an account is whitelisted and marks the respective whitelist
     * entry as used
     * @param _account account to check whitelist for
     */
    function useWhitelist(address _account) external {
        if (msg.sender != wlOperatorController) revert OnlyWLOperatorController();
        if (!whitelist[_account].isWhitelisted) revert AccountNotWhitelisted(_account);
        if (whitelist[_account].isUsed) revert WhitelistSpotAlreadyUsed(_account);
        whitelist[_account].isUsed = true;
    }

    /**
     * @notice Adds a list of whitelist entries
     * @param _accounts list of accounts to add to whitelist
     */
    function addWhitelistEntries(address[] calldata _accounts) external onlyOwner {
        for (uint256 i = 0; i < _accounts.length; i++) {
            address account = _accounts[i];
            if (whitelist[account].isWhitelisted) revert AccountAlreadyWhitelisted(account);
            whitelist[account] = WhitelistEntry(true, false);
        }
    }

    /**
     * @notice Removes a list of whitelist entries
     * @param _accounts list of accounts to remove from whitelist
     */
    function removeWhitelistEntries(address[] calldata _accounts) external onlyOwner {
        for (uint256 i = 0; i < _accounts.length; i++) {
            address account = _accounts[i];
            if (!whitelist[account].isWhitelisted) revert AccountNotWhitelisted(account);
            whitelist[account].isWhitelisted = false;
        }
    }

    /**
     * @notice Sets the whitelisted operator controller
     * @param _wlOperatorController controller address
     */
    function setWLOperatorController(address _wlOperatorController) external onlyOwner {
        wlOperatorController = _wlOperatorController;
    }
}
