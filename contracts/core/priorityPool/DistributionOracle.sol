// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@chainlink/contracts/src/v0.8/ChainlinkClient.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "../interfaces/IPriorityPool.sol";

contract DistributionOracle is ChainlinkClient, Ownable {
    using Chainlink for Chainlink.Request;

    IPriorityPool public priorityPool;

    bytes32 public jobId;
    uint256 public fee;

    uint256 public minBlockConfirmations;
    uint256 public pausedAtBlockNumber;

    error NotPaused();
    error InsufficientBlockConfirmations();
    error InsufficientBalance();

    /**
     * @notice Initialize the contract
     * @param _chainlinkToken address of LINK token
     * @param _chainlinkOracle address of operator contract
     * @param _jobId id of job
     * @param _fee fee charged for each request paid in LINK
     * @param _minBlockConfirmations min # of blocks to wait to request update after pausing priority pool
     * @param _priorityPool address of priority pool
     */
    constructor(
        address _chainlinkToken,
        address _chainlinkOracle,
        bytes32 _jobId,
        uint256 _fee,
        uint256 _minBlockConfirmations,
        address _priorityPool
    ) {
        setChainlinkToken(_chainlinkToken);
        setChainlinkOracle(_chainlinkOracle);
        jobId = _jobId;
        fee = _fee;
        minBlockConfirmations = _minBlockConfirmations;
        priorityPool = IPriorityPool(_priorityPool);
    }

    /**
     * @notice Pauses the priority pool so a new merkle tree can be calculated
     * @dev must always be called before requestUpdate()
     */
    function pauseForUpdate() external onlyOwner {
        priorityPool.pauseForUpdate();
        pausedAtBlockNumber = block.number;
    }

    /**
     * @notice Requests a new update which will calculate a new merkle tree, post the data to IPFS, and update
     * the priority pool
     * @dev pauseForUpdate() must be called before calling this function
     */
    function requestUpdate() external onlyOwner {
        if (!priorityPool.paused()) revert NotPaused();
        if (block.number < pausedAtBlockNumber + minBlockConfirmations) revert InsufficientBlockConfirmations();
        Chainlink.Request memory req = buildChainlinkRequest(jobId, address(this), this.fulfillRequest.selector);
        req.addUint("blockNumber", pausedAtBlockNumber);
        sendChainlinkRequest(req, fee);
    }

    /**
     * @notice Fulfills an update request
     * @param _requestId id of the request to fulfill
     * @param _merkleRoot new merkle root for the distribution tree
     * @param _ipfsHash new ipfs hash for the distribution tree (CIDv0, no prefix - only hash)
     * @param _amountDistributed amount of LSD tokens distributed in this distribution
     * @param _sharesAmountDistributed amount of LSD shares distributed in this distribution
     */
    function fulfillRequest(
        bytes32 _requestId,
        bytes32 _merkleRoot,
        bytes32 _ipfsHash,
        uint256 _amountDistributed,
        uint256 _sharesAmountDistributed
    ) public recordChainlinkFulfillment(_requestId) {
        priorityPool.updateDistribution(_merkleRoot, _ipfsHash, _amountDistributed, _sharesAmountDistributed);
    }

    /**
     * @notice Withdraws LINK tokens
     * @param _amount amount to withdraw
     */
    function withdrawLink(uint256 _amount) public onlyOwner {
        LinkTokenInterface link = LinkTokenInterface(chainlinkTokenAddress());
        if (link.transfer(msg.sender, _amount) != true) revert InsufficientBalance();
    }
}
