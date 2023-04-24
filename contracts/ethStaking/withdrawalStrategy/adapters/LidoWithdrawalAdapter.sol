// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../base/WithdrawalAdapter.sol";
import "../interfaces/ILidoWQERC721.sol";

/**
 * @title Lido Withdrawal Adapter
 * @notice Withdrawal adapter for Lido
 */
contract LidoWithdrawalAdapter is WithdrawalAdapter {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct Withdrawal {
        uint256 totalETHAmount;
        uint256 initialETHWithdrawalAmount;
        uint256 feeAmount;
        address owner;
    }

    ILidoWQERC721 public wqERC721;
    IERC20Upgradeable public stETH;
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
        address _stETH,
        uint256 _instantAmountBasisPoints,
        uint256 _minWithdrawalAmount
    ) public initializer {
        __WithdrawalAdapter_init(_controller, _feeAdapter, _instantAmountBasisPoints, _minWithdrawalAmount);
        wqERC721 = ILidoWQERC721(_wqERC721);
        stETH = IERC20Upgradeable(_stETH);
        stETH.safeApprove(address(wqERC721), type(uint256).max);
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
     * @dev request ids must be sorted in ascending order, returns the total claimable ETH amount for each withdrawal request
     * @param _requestIds list of request ids
     * @return list of claimable ETH amounts
     */
    function getClaimableEther(uint256[] calldata _requestIds) external view returns (uint256[] memory) {
        for (uint256 i = 0; i < _requestIds.length; ++i) {
            if (withdrawals[_requestIds[i]].owner == address(0)) revert RequestNotFound(_requestIds[i]);
        }
        uint256[] memory hints = wqERC721.findCheckpointHints(_requestIds, 1, wqERC721.getLastCheckpointIndex());
        return wqERC721.getClaimableEther(_requestIds, hints);
    }

    /**
     * @notice returns a list of withdrawable ETH for a list of Lido withdrawal requests owned by this adapter
     * @dev request ids must be sorted in ascending order, returns only the withdrawable ETH amount for each withdrawal request
     * @param _requestIds list of request ids
     * @return list of withdrawable ETH amounts
     */
    function getWithdrawableEther(uint256[] calldata _requestIds) external view returns (uint256[] memory) {
        uint256[] memory hints = wqERC721.findCheckpointHints(_requestIds, 1, wqERC721.getLastCheckpointIndex());
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
     * @notice returns the amount of ETH that will be received and the fee paid for
     * a withdrawal request if a withdrawal is initiated at this time
     * @param _amount amount of stETH to swap
     * @return total total amount, instant amount, and fee amount
     */
    function getReceivedEther(uint256 _amount)
        public
        view
        whenNotPaused
        returns (
            uint256,
            uint256,
            uint256
        )
    {
        uint256 instantWithdrawalAmount = (_amount * instantAmountBasisPoints) / BASIS_POINTS;
        uint256 fee = feeAdapter.getFee(_amount, _amount);

        if (_amount < minWithdrawalAmount) revert WithdrawalAmountTooSmall();
        if (instantWithdrawalAmount > controller.availableDeposits()) revert InsufficientFundsForWithdrawal();
        if (fee > _amount - instantWithdrawalAmount) revert FeeTooLarge();

        return (_amount - fee, instantWithdrawalAmount, fee);
    }

    /**
     * @notice swaps stETH for a percentage of it's value in ETH, the remaining value to be
     * paid out on request finalization
     * @param _amount amount of stETH to swap
     * @param _minimumReceivedAmount the minimum amount of ETH to receive (will revert if condition is not met)
     */
    function initiateWithdrawalStETH(uint256 _amount, uint256 _minimumReceivedAmount) external {
        (uint256 totalWithdrawalAmount, uint256 instantWithdrawalAmount, uint256 fee) = getReceivedEther(_amount);
        if (totalWithdrawalAmount < _minimumReceivedAmount) revert ReceivedAmountBelowMin();

        address sender = msg.sender;
        stETH.safeTransferFrom(sender, address(this), _amount);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = _amount;
        uint256 requestId = wqERC721.requestWithdrawals(amounts, address(this))[0];

        withdrawals[requestId] = Withdrawal(_amount, instantWithdrawalAmount, fee, sender);
        totalOutstandingDeposits += instantWithdrawalAmount;
        ownerRequestIds[sender].push(requestId);
        controller.adapterWithdraw(sender, instantWithdrawalAmount);

        emit InitiateWithdrawal(sender, requestId, instantWithdrawalAmount, _amount, fee);
    }

    /**
     * @notice swaps a Lido withdrawal for a percentage of it's value in ETH, the remaining value to be
     * paid out on request finalization
     * @param _requestId Lido withdrawal request id
     * @param _minimumReceivedAmount the minimum amount of ETH to receive (will revert if condition is not met)
     */
    function initiateWithdrawal(uint256 _requestId, uint256 _minimumReceivedAmount) external {
        if (withdrawals[_requestId].owner != address(0)) revert DuplicateRequestId();

        uint256[] memory reqList = new uint256[](1);
        reqList[0] = _requestId;
        ILidoWQERC721.WithdrawalRequestStatus memory requestStatus = wqERC721.getWithdrawalStatus(reqList)[0];

        uint256 totalAmount = requestStatus.amountOfStETH;
        (uint256 totalWithdrawalAmount, uint256 instantWithdrawalAmount, uint256 fee) = getReceivedEther(totalAmount);
        if (totalWithdrawalAmount < _minimumReceivedAmount) revert ReceivedAmountBelowMin();

        address sender = msg.sender;
        withdrawals[_requestId] = Withdrawal(totalAmount, instantWithdrawalAmount, fee, sender);
        totalOutstandingDeposits += instantWithdrawalAmount;
        ownerRequestIds[sender].push(_requestId);
        wqERC721.transferFrom(sender, address(this), _requestId);
        controller.adapterWithdraw(sender, instantWithdrawalAmount);

        emit InitiateWithdrawal(sender, _requestId, instantWithdrawalAmount, totalAmount, fee);
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
            totalFinalizedDeposits += withdrawals[_requestIds[i]].initialETHWithdrawalAmount;
        }
        totalOutstandingDeposits -= totalFinalizedDeposits;

        for (uint256 i = 0; i < _requestIds.length; ++i) {
            uint256 claimableETH = claimableEther[i];
            Withdrawal memory withdrawal = withdrawals[_requestIds[i]];

            uint256 toRemainInPool = withdrawal.initialETHWithdrawalAmount + withdrawal.feeAmount;

            uint256 toWithdraw;
            if (toRemainInPool < claimableETH) {
                toWithdraw = claimableETH - toRemainInPool;
                _sendEther(withdrawal.owner, toWithdraw);
            }

            emit FinalizeWithdrawal(withdrawal.owner, _requestIds[i], toWithdraw, claimableETH);
        }

        controller.adapterDeposit{value: address(this).balance}();
    }
}
