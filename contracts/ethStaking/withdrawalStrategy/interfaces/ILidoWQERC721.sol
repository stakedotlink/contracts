// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

interface ILidoWQERC721 {
    struct WithdrawalRequestStatus {
        /// @notice stETH token amount that was locked on withdrawal queue for this request
        uint256 amountOfStETH;
        /// @notice amount of stETH shares locked on withdrawal queue for this request
        uint256 amountOfShares;
        /// @notice address that can claim or transfer this request
        address owner;
        /// @notice timestamp of when the request was created, in seconds
        uint256 timestamp;
        /// @notice true, if request is finalized
        bool isFinalized;
        /// @notice true, if request is claimed. Request is claimable if (isFinalized && !isClaimed)
        bool isClaimed;
    }

    // @notice Returns statuses for the array of request ids
    /// @param _requestIds array of withdrawal request ids
    function getWithdrawalStatus(uint256[] calldata _requestIds)
        external
        view
        returns (WithdrawalRequestStatus[] memory statuses);

    /// @notice Returns all withdrawal requests that belongs to the `_owner` address
    function getWithdrawalRequests(address _owner) external view returns (uint256[] memory requestsIds);

    /// @notice Returns array of claimable eth amounts that is locked for each request
    /// @param _requestIds array of request ids to find claimable ether for
    /// @param _hints checkpoint hint for each id.
    ///   Can be retrieved with `findCheckpointHints()` or `findCheckpointHintsUnbounded()`
    function getClaimableEther(uint256[] calldata _requestIds, uint256[] calldata _hints)
        external
        view
        returns (uint256[] memory claimableEthValues);

    /// @notice Claim a batch of withdrawal requests once finalized (claimable) sending locked ether to the owner
    /// @param _requestIds array of request ids to claim
    /// @param _hints checkpoint hint for each id.
    ///   Can be retrieved with `findCheckpointHints()` or `findCheckpointHintsUnbounded()`
    /// @dev
    ///  Reverts if any requestId or hint in arguments are not valid
    ///  Reverts if any request is not finalized or already claimed
    ///  Reverts if msg sender is not an owner of the requests
    function claimWithdrawals(uint256[] calldata _requestIds, uint256[] calldata _hints) external;

    /// @notice Finds the list of hints for the given `_requestIds` searching among the checkpoints with indices
    ///  in the range `[1, lastCheckpointIndex]`. NB! Array of request ids should be sorted
    /// @dev WARNING! OOG is possible if used onchain.
    /// @param _requestIds ids of the requests sorted in the ascending order to get hints for
    function findCheckpointHintsUnbounded(uint256[] calldata _requestIds) external view returns (uint256[] memory hintIds);

    /// @dev See {IERC721-transferFrom}.
    function transferFrom(
        address _from,
        address _to,
        uint256 _requestId
    ) external;

    /// @notice Request the sequence of stETH withdrawals according to passed `withdrawalRequestInputs` data
    /// @param amounts an array of stETH amount values. The standalone withdrawal request will
    ///  be created for each item in the passed list.
    /// @param _owner address that will be able to transfer or claim the request.
    ///  If `owner` is set to `address(0)`, `msg.sender` will be used as owner.
    /// @return requestIds an array of the created withdrawal requests
    function requestWithdrawals(uint256[] calldata amounts, address _owner) external returns (uint256[] memory requestIds);
}
