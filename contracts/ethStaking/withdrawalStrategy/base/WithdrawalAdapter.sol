// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

import "../interfaces/IETHWithdrawalStrategy.sol";
import "../interfaces/IFeeAdapter.sol";

/**
 * @title Withdrawal Adapter
 * @notice Base adapter contract used to handle withdrawals from an ETH staking protocol
 */
abstract contract WithdrawalAdapter is Initializable, UUPSUpgradeable, OwnableUpgradeable, PausableUpgradeable {
    uint256 internal constant BASIS_POINTS = 10000;

    IETHWithdrawalStrategy public controller;
    IFeeAdapter public feeAdapter;

    uint256 public instantAmountBasisPoints;
    uint256 public minWithdrawalAmount;

    event SetInstantAmountBasisPoints(uint256 instantAmountBasisPoints);
    event SetMinWithdrawalAmount(uint256 minWithdrawalAmount);
    event SetFeeAdapter(address feeAdapter);

    error InsufficientFundsForWithdrawal();
    error ETHTransferFailed();
    error InvalidInstantAmount();
    error InvalidFeeAdapter();
    error InvalidMinWithdrawalAmount();

    function __WithdrawalAdapter_init(
        address _controller,
        address _feeAdapter,
        uint256 _instantAmountBasisPoints,
        uint256 _minWithdrawalAmount
    ) public onlyInitializing {
        __Ownable_init();
        __UUPSUpgradeable_init();
        controller = IETHWithdrawalStrategy(_controller);
        setInstantAmountBasisPoints(_instantAmountBasisPoints);
        setFeeAdapter(_feeAdapter);
        setMinWithdrawalAmount(_minWithdrawalAmount);
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
        if (_instantAmountBasisPoints >= BASIS_POINTS) revert InvalidInstantAmount();
        instantAmountBasisPoints = _instantAmountBasisPoints;
        emit SetInstantAmountBasisPoints(_instantAmountBasisPoints);
    }

    /**
     * @notice sets the minimum withdrawal amount
     * @param _minWithdrawalAmount minimum amount
     **/
    function setMinWithdrawalAmount(uint256 _minWithdrawalAmount) public onlyOwner {
        if (_minWithdrawalAmount == 0) revert InvalidMinWithdrawalAmount();
        minWithdrawalAmount = _minWithdrawalAmount;
        emit SetMinWithdrawalAmount(_minWithdrawalAmount);
    }

    /**
     * @notice sets the fee adapter
     * @param _feeAdapter address of fee adapter
     **/
    function setFeeAdapter(address _feeAdapter) public onlyOwner {
        if (_feeAdapter == address(0)) revert InvalidFeeAdapter();
        feeAdapter = IFeeAdapter(_feeAdapter);
        emit SetFeeAdapter(_feeAdapter);
    }

    /**
     * @notice pauses/unpauses the contract
     * @param _isPaused pause status to set
     **/
    function setPaused(bool _isPaused) external onlyOwner {
        if (_isPaused) {
            _pause();
        } else {
            _unpause();
        }
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
