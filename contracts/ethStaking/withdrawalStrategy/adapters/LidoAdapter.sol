// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "../base/WithdrawalAdapter.sol";
import "../interfaces/ILidoWQERC721.sol";

/**
 * @title Lido Adapter
 * @notice Withdrawal adapter for Lido
 */
contract LidoAdapter is WithdrawalAdapter {
    struct Withdrawal {
        uint256 totalETHAmount;
        uint256 initialETHWithdrawalAmount;
        address owner;
    }

    ILidoWQERC721 public wqERC721;
    mapping(uint256 => Withdrawal) public withdrawals;

    uint256 private totalOutstandingDeposits;

    event InitiateWithdrawal(
        address indexed owner,
        uint256 indexed requestId,
        uint256 withdrawalAmount,
        uint256 totalAmount
    );
    event FinalizeWithdrawal(
        address indexed owner,
        uint256 indexed requestId,
        uint256 withdrawalAmount,
        uint256 totalFinalizedAmount
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _controller,
        address _wqERC721,
        uint256 _instantAmountBasisPoints
    ) public initializer {
        __WithdrawalAdapter_init(_controller, _instantAmountBasisPoints);
        wqERC721 = ILidoWQERC721(_wqERC721);
    }

    function getTotalDeposits() external view override returns (uint256) {
        return totalOutstandingDeposits;
    }

    function getRequestIds() external view returns (uint256[] memory) {
        return wqERC721.getWithdrawalRequests(address(this));
    }

    function getWithdrawableEther() external view returns (uint256[] memory) {
        uint256[] memory requestIds = wqERC721.getWithdrawalRequests(address(this));
        uint256[] memory hints = wqERC721.findCheckpointHintsUnbounded(requestIds);
        return wqERC721.getClaimableEther(requestIds, hints);
    }

    function initiateWithdrawal(uint256 _requestId) external {
        uint256[] memory reqList = new uint256[](1);
        reqList[0] = _requestId;
        ILidoWQERC721.WithdrawalRequestStatus memory requestStatus = wqERC721.getWithdrawalStatus(reqList)[0];

        uint256 totalAmount = requestStatus.amountOfStETH;
        uint256 instantWithdrawalAmount = (totalAmount * instantAmountBasisPoints) / 10000;

        if (instantWithdrawalAmount > controller.availableDeposits()) revert InsufficientFundsForWithdrawal();

        withdrawals[_requestId] = Withdrawal(totalAmount, instantWithdrawalAmount, msg.sender);
        totalOutstandingDeposits += instantWithdrawalAmount;
        wqERC721.transferFrom(msg.sender, address(this), _requestId);
        controller.adapterWithdraw(msg.sender, instantWithdrawalAmount);

        emit InitiateWithdrawal(msg.sender, _requestId, instantWithdrawalAmount, totalAmount);
    }

    function finalizeWithdrawals(uint256[] calldata _requestIds, uint256[] calldata _hints) external {
        uint256 startingBalance = address(this).balance;
        uint256[] memory claimableEther = wqERC721.getClaimableEther(_requestIds, _hints);

        wqERC721.claimWithdrawals(_requestIds, _hints);

        uint256 totalFinalizedDeposits;
        for (uint i = 0; i < _requestIds.length; ++i) {
            uint256 claimableETH = claimableEther[i];
            Withdrawal memory withdrawal = withdrawals[_requestIds[i]];

            uint256 toRemainInPool = (claimableETH * feeBasisPoints) / 10000;
            if (claimableETH < withdrawal.totalETHAmount) {
                toRemainInPool += withdrawal.totalETHAmount - claimableETH;
            }

            uint256 toWithdraw;
            if (toRemainInPool < claimableETH) {
                toWithdraw = claimableETH - toRemainInPool;
                _sendEther(withdrawal.owner, toWithdraw);
            }

            totalFinalizedDeposits += withdrawal.initialETHWithdrawalAmount;
            emit FinalizeWithdrawal(withdrawal.owner, _requestIds[i], toWithdraw, claimableETH);
        }

        totalOutstandingDeposits -= totalFinalizedDeposits;
        controller.adapterDeposit{value: address(this).balance - startingBalance}();
    }
}
