// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "../interfaces/IETHWithdrawalStrategy.sol";

/**
 * @title Withdrawal Adapter
 * @notice Base adapter contract used to handle ETH withdrawals from an LSD protocol
 */
abstract contract WithdrawalAdapter is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    IETHWithdrawalStrategy public controller;

    uint256 public instantAmountBasisPoints;
    uint256 public feeBasisPoints;

    error InsufficientFundsForWithdrawal();
    error InsufficientETHBalance();
    error ETHTransferFailed();

    function __WithdrawalAdapter_init(address _controller, uint256 _instantAmountBasisPoints) public onlyInitializing {
        controller = IETHWithdrawalStrategy(_controller);
        instantAmountBasisPoints = _instantAmountBasisPoints;
        __Ownable_init();
        __UUPSUpgradeable_init();
    }

    function getTotalDeposits() external view virtual returns (uint256);

    function _sendEther(address _to, uint256 _amount) internal {
        if (address(this).balance < _amount) revert InsufficientETHBalance();

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
