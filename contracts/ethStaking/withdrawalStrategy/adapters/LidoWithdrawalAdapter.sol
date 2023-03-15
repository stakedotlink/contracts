// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "../base/WithdrawalAdapter.sol";
import "../interfaces/ILidoWQERC721.sol";

/**
 * @title Lido Withdrawal Adapter
 * @notice Withdrawal adapter for Lido
 */
contract LidoWithdrawalAdapter is WithdrawalAdapter {
    struct Withdrawal {
        uint256 totalETHAmount;
        uint256 initialETHWithdrawalAmount;
        uint256 feeAmount;
        address owner;
    }

    ILidoWQERC721 public wqERC721;
    mapping(uint256 => Withdrawal) public withdrawals;
    mapping(address => uint256[]) private ownerRequestIds;

    uint256 private totalOutstandingDeposits;

    event InitiateWithdrawal(
        address indexed owner,
        uint256 indexed requestId,
        uint256 withdrawalAmount,
        uint256 totalAmount,
        uint256 feeAmount
    );
    event FinalizeWithdrawal(
        address indexed owner,
        uint256 indexed requestId,
        uint256 withdrawalAmount,
        uint256 totalFinalizedAmount
    );

    error DuplicateRequestId();
    error InsufficientETHClaimed();
    error RequestNotFound(uint256 requestId);
    error WithdrawalAmountTooSmall();
    error FeeTooLarge();
    error ReceivedAmountBelowMin();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _controller,
        address _feeAdapter,
        address _wqERC721,
        uint256 _instantAmountBasisPoints,
        uint256 _minWithdrawalAmount
    ) public initializer {
        __WithdrawalAdapter_init(_controller, _feeAdapter, _instantAmountBasisPoints, _minWithdrawalAmount);
        wqERC721 = ILidoWQERC721(_wqERC721);
    }

    /**
     * @notice returns the total deposits held by this adapter
     * @dev deposits are equal to the amount of ETH backing unfinalized withdrawals
     * held by this adapter minus the ETH owed to withdrawers on finalization
     * @return total deposits amount
     */
    function getTotalDeposits() external view override returns (uint256) {
        return totalOutstandingDeposits;
    }

    /**
     * @notice returns a list of all Lido withdrawal request ids owned by this adapter
     * @return list of request ids
     */
    function getRequestIds() external view returns (uint256[] memory) {
        return wqERC721.getWithdrawalRequests(address(this));
    }

    /**
     * @notice returns a list of all Lido request ids associated with an owner
     * @param _owner owner address
     * @return list of request ids
     */
    function getRequestIdsByOwner(address _owner) external view returns (uint256[] memory) {
        return ownerRequestIds[_owner];
    }

    /**
     * @notice returns a list of claimable ETH for a list of Lido withdrawal requests owned by this adapter
     * @dev returns the total claimable ETH amount for each withdrawal request
     * @param _requestIds list of request ids
     * @return list of claimable ETH amounts
     */
    function getClaimableEther(uint256[] calldata _requestIds) external view returns (uint256[] memory) {
        for (uint256 i = 0; i < _requestIds.length; i++) {
            if (withdrawals[_requestIds[i]].owner == address(0)) revert RequestNotFound(_requestIds[i]);
        }
        uint256[] memory hints = wqERC721.findCheckpointHintsUnbounded(_requestIds);
        return wqERC721.getClaimableEther(_requestIds, hints);
    }

    /**
     * @notice returns a list of withdrawable ETH for a list of Lido withdrawal requests owned by this adapter
     * @dev returns only the withdrawable ETH amount for each withdrawal request
     * @param _requestIds list of request ids
     * @return list of withdrawable ETH amounts
     */
    function getWithdrawableEther(uint256[] calldata _requestIds) external view returns (uint256[] memory) {
        uint256[] memory hints = wqERC721.findCheckpointHintsUnbounded(_requestIds);
        uint256[] memory claimable = wqERC721.getClaimableEther(_requestIds, hints);
        uint256[] memory withdrawable = new uint256[](claimable.length);

        for (uint256 i = 0; i < _requestIds.length; ++i) {
            uint256 claimableETH = claimable[i];
            Withdrawal memory withdrawal = withdrawals[_requestIds[i]];

            if (withdrawal.owner == address(0)) revert RequestNotFound(_requestIds[i]);

            uint256 toRemainInPool = withdrawal.initialETHWithdrawalAmount + withdrawal.feeAmount;

            if (toRemainInPool < claimableETH) {
                withdrawable[i] = claimableETH - toRemainInPool;
            }
        }

        return withdrawable;
    }

    /**
     * @notice returns the approximate amount of ETH that will be received for a withdrawal request
     * if a withdrawal is initiated at this time
     * @dev returns both the total amount and the instant amount
     * @param _requestId Lido withdrawal request id
     * @return total amount and instant amount
     */
    function getReceivedEther(uint256 _requestId) external view returns (uint256, uint256) {
        if (withdrawals[_requestId].owner != address(0)) revert DuplicateRequestId();

        uint256[] memory reqList = new uint256[](1);
        reqList[0] = _requestId;
        ILidoWQERC721.WithdrawalRequestStatus memory requestStatus = wqERC721.getWithdrawalStatus(reqList)[0];

        uint256 totalAmount = requestStatus.amountOfStETH;
        uint256 instantWithdrawalAmount = (totalAmount * instantAmountBasisPoints) / 10000;
        uint256 fee = feeAdapter.getFee(totalAmount, totalAmount);

        if (totalAmount < minWithdrawalAmount) revert WithdrawalAmountTooSmall();
        if (instantWithdrawalAmount > controller.availableDeposits()) revert InsufficientFundsForWithdrawal();
        if (fee > totalAmount - instantWithdrawalAmount) revert FeeTooLarge();

        return (totalAmount - fee, instantWithdrawalAmount);
    }

    /**
     * @notice swaps a Lido withdrawal for a percentage of it's value in ETH, the remaining value to be
     * paid out on request finalization
     * @param _requestId Lido withdrawal request id
     * @param _minimumReceivedAmount the minimum amount of ETH to receive (will revert if condition is not met)
     */
    function initiateWithdrawal(uint256 _requestId, uint256 _minimumReceivedAmount) external notPaused {
        if (withdrawals[_requestId].owner != address(0)) revert DuplicateRequestId();

        uint256[] memory reqList = new uint256[](1);
        reqList[0] = _requestId;
        ILidoWQERC721.WithdrawalRequestStatus memory requestStatus = wqERC721.getWithdrawalStatus(reqList)[0];

        uint256 totalAmount = requestStatus.amountOfStETH;
        uint256 instantWithdrawalAmount = (totalAmount * instantAmountBasisPoints) / 10000;
        uint256 fee = feeAdapter.getFee(totalAmount, totalAmount);

        if (totalAmount < minWithdrawalAmount) revert WithdrawalAmountTooSmall();
        if (instantWithdrawalAmount > controller.availableDeposits()) revert InsufficientFundsForWithdrawal();
        if (fee > totalAmount - instantWithdrawalAmount) revert FeeTooLarge();
        if (totalAmount - fee < _minimumReceivedAmount) revert ReceivedAmountBelowMin();

        withdrawals[_requestId] = Withdrawal(totalAmount, instantWithdrawalAmount, fee, msg.sender);
        totalOutstandingDeposits += instantWithdrawalAmount;
        ownerRequestIds[msg.sender].push(_requestId);
        wqERC721.transferFrom(msg.sender, address(this), _requestId);
        controller.adapterWithdraw(msg.sender, instantWithdrawalAmount);

        emit InitiateWithdrawal(msg.sender, _requestId, instantWithdrawalAmount, totalAmount, fee);
    }

    /**
     * @notice finalizes a list of withdrawal requests and pays out the remaining ETH owed to withdrawers
     * minus any applicable fees
     * @param _requestIds list of Lido withdrawal request ids
     * @param _hints list of hints, see Lido's WithdrawalQueue.sol
     */
    function finalizeWithdrawals(uint256[] calldata _requestIds, uint256[] calldata _hints) external {
        uint256[] memory claimableEther = wqERC721.getClaimableEther(_requestIds, _hints);

        uint256 totalClaimableETH;
        for (uint256 i = 0; i < claimableEther.length; ++i) {
            totalClaimableETH += claimableEther[i];
        }

        wqERC721.claimWithdrawals(_requestIds, _hints);

        if (address(this).balance < totalClaimableETH) revert InsufficientETHClaimed();

        uint256 totalFinalizedDeposits;
        for (uint256 i = 0; i < _requestIds.length; ++i) {
            uint256 claimableETH = claimableEther[i];
            Withdrawal memory withdrawal = withdrawals[_requestIds[i]];

            uint256 toRemainInPool = withdrawal.initialETHWithdrawalAmount + withdrawal.feeAmount;

            uint256 toWithdraw;
            if (toRemainInPool < claimableETH) {
                toWithdraw = claimableETH - toRemainInPool;
                _sendEther(withdrawal.owner, toWithdraw);
            }

            totalFinalizedDeposits += withdrawal.initialETHWithdrawalAmount;
            emit FinalizeWithdrawal(withdrawal.owner, _requestIds[i], toWithdraw, claimableETH);
        }

        totalOutstandingDeposits -= totalFinalizedDeposits;
        controller.adapterDeposit{value: address(this).balance}();
    }
}
