// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Lido Withdrawal Queue Mock
 * @notice Mocks contract for testing
 */
contract LidoWQERC721Mock is ERC721 {
    using SafeERC20 for IERC20;

    struct WithdrawalRequest {
        uint256 amountOfStETH;
        uint256 amountOfShares;
        address owner;
        uint256 timestamp;
        bool isFinalized;
        bool isClaimed;
    }

    WithdrawalRequest[] private requests;
    mapping(address => uint256[]) private ownerRequests;

    IERC20 public stETH;

    constructor(WithdrawalRequest[] memory _requests, address _stETH) ERC721("Lido Withdrawal", "LW") {
        for (uint256 i = 0; i < _requests.length; ++i) {
            requests.push(_requests[i]);
            _mint(_requests[i].owner, i);
        }
        stETH = IERC20(_stETH);
    }

    receive() external payable {}

    function getWithdrawalRequests(address _owner) external view returns (uint256[] memory) {
        return ownerRequests[_owner];
    }

    function findCheckpointHints(
        uint256[] calldata _requestIds,
        uint256 _firstIndex,
        uint256 _lastIndex
    ) external view returns (uint256[] memory) {
        return _requestIds;
    }

    function getLastCheckpointIndex() external view returns (uint256) {
        return 1;
    }

    function getClaimableEther(uint256[] calldata _requestIds, uint256[] calldata _hints)
        external
        view
        returns (uint256[] memory)
    {
        uint256[] memory claimable = new uint256[](_requestIds.length);
        for (uint256 i = 0; i < _requestIds.length; ++i) {
            WithdrawalRequest memory request = requests[_requestIds[i]];
            if (request.isFinalized && !request.isClaimed) {
                claimable[i] = request.amountOfStETH;
            }
        }
        return claimable;
    }

    function getWithdrawalStatus(uint256[] calldata _requestIds) external view returns (WithdrawalRequest[] memory) {
        WithdrawalRequest[] memory returnRequests = new WithdrawalRequest[](_requestIds.length);
        for (uint256 i = 0; i < _requestIds.length; ++i) {
            returnRequests[i] = requests[_requestIds[i]];
        }
        return returnRequests;
    }

    function claimWithdrawals(uint256[] calldata _requestIds, uint256[] calldata _hints) external {
        for (uint256 i = 0; i < _requestIds.length; ++i) {
            WithdrawalRequest storage request = requests[_requestIds[i]];

            require(request.isFinalized && !request.isClaimed, "ETH not claimable");
            request.isClaimed = true;
            (bool success, ) = payable(request.owner).call{value: request.amountOfStETH}("");
            require(success, "Transfer failed");
        }
    }

    function finalizeRequest(uint256 _requestId, uint256 _finalAmount) external {
        WithdrawalRequest storage request = requests[_requestId];

        require(!request.isFinalized, "Already finalized");
        request.isFinalized = true;
        request.amountOfStETH = _finalAmount;
    }

    function requestWithdrawals(uint256[] calldata _amounts, address _owner) external returns (uint256[] memory requestIds) {
        requestIds = new uint256[](_amounts.length);
        for (uint256 i = 0; i < _amounts.length; i++) {
            requests.push(WithdrawalRequest(_amounts[i], 0, _owner, 0, false, false));
            requestIds[i] = requests.length - 1;
            _mint(_owner, requests.length - 1);
            stETH.safeTransferFrom(msg.sender, address(this), _amounts[i]);
        }
    }

    function _beforeTokenTransfer(
        address _from,
        address _to,
        uint256 _tokenId
    ) internal override {
        uint256[] storage fromRequests = ownerRequests[_from];
        for (uint256 i = 0; i < fromRequests.length; ++i) {
            if (fromRequests[i] == _tokenId) {
                fromRequests[i] = fromRequests[fromRequests.length - 1];
                fromRequests.pop();
                break;
            }
        }
        ownerRequests[_to].push(_tokenId);
        requests[_tokenId].owner = _to;
    }
}
