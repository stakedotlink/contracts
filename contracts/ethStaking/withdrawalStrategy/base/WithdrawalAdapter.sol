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
    bool public isPaused;

    event SetInstantAmountBasisPoints(uint256 instantAmountBasisPoints);
    event SetFeeBasisPoints(uint256 feeBasisPoints);
    event SetPaused(bool isPaused);

    error InsufficientFundsForWithdrawal();
    error ETHTransferFailed();
    error CannotSetSamePauseStatus();
    error ContractIsPaused();
    error InvalidInstantAmount();
    error InvalidFee();

    function __WithdrawalAdapter_init(
        address _controller,
        uint256 _instantAmountBasisPoints,
        uint256 _feeBasisPoints
    ) public onlyInitializing {
        __Ownable_init();
        __UUPSUpgradeable_init();
        controller = IETHWithdrawalStrategy(_controller);
        setInstantAmountBasisPoints(_instantAmountBasisPoints);
        setFeeBasisPoints(_feeBasisPoints);
    }

    modifier notPaused() {
        if (isPaused) revert ContractIsPaused();
        _;
    }

    receive() external payable {}

    /**
     * @notice returns the total deposits held by this adapter
     * @dev deposits are equal to the amount of ETH backing unfinalized withdrawals
     * held by this adapter minus the ETH owed to withdrawers on finalization
     * @return total deposits amount
     */
    function getTotalDeposits() external view virtual returns (uint256);

    /**
     * @notice sets the basis point amount of ETH instantly received when initiating a withdrawal
     * @param _instantAmountBasisPoints basis point amount
     **/
    function setInstantAmountBasisPoints(uint256 _instantAmountBasisPoints) public onlyOwner {
        if (_instantAmountBasisPoints >= 10000) revert InvalidInstantAmount();
        instantAmountBasisPoints = _instantAmountBasisPoints;
        emit SetInstantAmountBasisPoints(_instantAmountBasisPoints);
    }

    /**
     * @notice sets the basis point fee paid on withdrawals
     * @param _feeBasisPoints basis point fee
     **/
    function setFeeBasisPoints(uint256 _feeBasisPoints) public onlyOwner {
        if (_feeBasisPoints > 500) revert InvalidFee();
        feeBasisPoints = _feeBasisPoints;
        emit SetFeeBasisPoints(_feeBasisPoints);
    }

    /**
     * @notice pauses/unpauses the contract
     * @param _isPaused pause status of the contract
     **/
    function setPaused(bool _isPaused) external onlyOwner {
        if (_isPaused == isPaused) revert CannotSetSamePauseStatus();
        isPaused = _isPaused;
        emit SetPaused(_isPaused);
    }

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
