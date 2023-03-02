// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "../interfaces/IETHWithdrawalStrategy.sol";

/**
 * @title Withdrawal Adapter
 * @notice Base adapter contract used to handle withdrawals from an ETH staking protocol
 */
abstract contract WithdrawalAdapter is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    IETHWithdrawalStrategy public controller;

    uint256 public instantAmountBasisPoints;
    uint256 public feeBasisPoints;

    error InsufficientFundsForWithdrawal();
    error ETHTransferFailed();

    function __WithdrawalAdapter_init(address _controller, uint256 _instantAmountBasisPoints) public onlyInitializing {
        controller = IETHWithdrawalStrategy(_controller);
        instantAmountBasisPoints = _instantAmountBasisPoints;
        __Ownable_init();
        __UUPSUpgradeable_init();
    }

    /**
     * @notice returns the total deposits held by this adapter
     * @dev deposits are equal to the amount of ETH backing unfinalized withdrawals
     * held by this adapter minus the ETH owed to withdrawers on finalization
     * @return total deposits amount
     */
    function getTotalDeposits() external view virtual returns (uint256);

    /**
     * @notice performs an ETH transfer
     * @param _to account to receive transfer
     * @param _amount amount to transfer
     */
    function _sendEther(address _to, uint256 _amount) internal {
        (bool success, ) = _to.call{value: _amount}("");
        if (!success) revert ETHTransferFailed();
    }

    /**
     * @dev Checks authorization for contract upgrades
     */
    function _authorizeUpgrade(address) internal override onlyOwner {}

    /**
     * @dev Allows future contract versions to add new variables without shifting
     * down storage in the inheritance chain
     */
    uint256[10] private __gap;
}
