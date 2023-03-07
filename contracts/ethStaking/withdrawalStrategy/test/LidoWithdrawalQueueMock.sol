// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * @title Lido Withdrawal Queue Mock
 * @notice Mocks contract for testing
 */
contract LidoWithdrawalQueueMock {
    struct WithdrawalRequest {
        uint256 amount;
        address owner;
        bool isFinalized;
        bool isClaimed;
    }

    WithdrawalRequest[] private requests;
    mapping(address => uint256[]) private ownerRequests;

    constructor(WithdrawalRequest[] memory _requests) {
        for (uint256 i = 0; i < _requests.length; i++) {
            requests.push(_requests[i]);
        }
    }

    receive() external payable {}

    function getWithdrawalRequests(address _owner) external view returns (uint256[] memory) {
        return ownerRequests[_owner];
    }

    function findCheckpointHintsUnbounded(uint256[] calldata _requestIds) external view returns (uint256[] memory) {
        return _requestIds;
    }

    function getClaimableEther(uint256[] calldata _requestIds, uint256[] calldata _hints) external view {
        uint256[] memory claimable = new uint256[](_requestIds.length);
        for (uint256 i = 0; i < _requestIds.length; i++) {
            WithdrawalRequest memory request = requests[_requestIds[i]];
            if (!request.isFinalized || !request.isClaimed) {
                claimable[i] = request.amount;
            }
        }
    }

    function getWithdrawalStatus(uint256[] calldata _requestIds) external view returns (WithdrawalRequest[] memory) {
        WithdrawalRequest[] memory returnRequets = new WithdrawalRequest[](_requestIds.length);
        for (uint256 i = 0; i < _requestIds.length; i++) {
            returnRequets[i] = requests[i];
        }
        return returnRequets;
    }

    function claimWithdrawals(uint256[] calldata _requestIds, uint256[] calldata _hints) external {
        for (uint256 i = 0; i < _requestIds.length; i++) {
            WithdrawalRequest storage request = requests[_requestIds[i]];

            require(request.isFinalized && !request.isClaimed, "ETH not claimable");
            request.isClaimed = true;
            (bool success, ) = payable(request.owner).call{value: request.amount}("");
            require(success, "Transfer failed");
        }
    }

    function finalizeRequest(uint256 _requestId, uint256 _finalAmount) external {
        WithdrawalRequest storage request = requests[_requestId];

        require(!request.isFinalized, "Already finalized");
        request.isFinalized = true;
        request.amount = _finalAmount;
    }
}
