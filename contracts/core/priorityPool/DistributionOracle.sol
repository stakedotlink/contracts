// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@chainlink/contracts/src/v0.8/ChainlinkClient.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "../interfaces/IPriorityPool.sol";

contract DistributionOracle is ChainlinkClient, Ownable {
    using Chainlink for Chainlink.Request;

    enum UpkeepType {
        PAUSE,
        REQUEST
    }

    IPriorityPool public priorityPool;

    bytes32 public jobId;
    uint256 public fee;

    uint256 public minTimeBetweenUpdates;
    uint256 public minDepositsSinceLastUpdate;
    uint256 public minBlockConfirmations;

    uint256 public timeOfLastUpdate;
    uint256 public pausedAtBlockNumber;

    error NotPaused();
    error InsufficientBlockConfirmations();
    error InsufficientBalance();
    error UpdateConditionsNotMet();
    error InvalidUpkeepType();

    /**
     * @notice Initialize the contract
     * @param _chainlinkToken address of LINK token
     * @param _chainlinkOracle address of operator contract
     * @param _jobId id of job
     * @param _fee fee charged for each request paid in LINK
     * @param _minTimeBetweenUpdates min amount of seconds between updates
     * @param _minDepositsSinceLastUpdate min amount of deposits from the priority pool to the
     *         staking pool needed to request update
     * @param _minBlockConfirmations min # of blocks to wait to request update after pausing priority pool
     * @param _priorityPool address of priority pool
     */
    constructor(
        address _chainlinkToken,
        address _chainlinkOracle,
        bytes32 _jobId,
        uint256 _fee,
        uint256 _minTimeBetweenUpdates,
        uint256 _minDepositsSinceLastUpdate,
        uint256 _minBlockConfirmations,
        address _priorityPool
    ) {
        setChainlinkToken(_chainlinkToken);
        setChainlinkOracle(_chainlinkOracle);
        jobId = _jobId;
        fee = _fee;
        minTimeBetweenUpdates = _minTimeBetweenUpdates;
        minDepositsSinceLastUpdate = _minDepositsSinceLastUpdate;
        minBlockConfirmations = _minBlockConfirmations;
        priorityPool = IPriorityPool(_priorityPool);
    }

    /**
     * @notice returns whether a call should be made to performUpkeep to pause or request an update
     * into the staking pool
     * @dev used by chainlink keepers
     * @return upkeepNeeded whether or not to pause or request update
     * @return performData abi encoded upkeep type to perform
     */
    function checkUpkeep(bytes calldata) external view returns (bool, bytes memory) {
        bool shouldPauseForUpdate = (!priorityPool.paused() &&
            block.timestamp >= timeOfLastUpdate + minTimeBetweenUpdates) &&
            priorityPool.depositsSinceLastUpdate() >= minDepositsSinceLastUpdate;

        if (shouldPauseForUpdate) {
            return (true, abi.encode(UpkeepType.PAUSE));
        }

        bool shouldRequestUpdate = priorityPool.paused() && block.number >= pausedAtBlockNumber + minBlockConfirmations;

        if (shouldRequestUpdate) {
            return (true, abi.encode(UpkeepType.REQUEST));
        }

        return (false, bytes(""));
    }

    /**
     * @notice deposits queued tokens into the staking pool
     * @dev used by chainlink keepers
     * @param _performData abi encoded upkeep type to perform
     */
    function performUpkeep(bytes calldata _performData) external {
        UpkeepType upkeepType = abi.decode(_performData, (UpkeepType));

        if (upkeepType == UpkeepType.PAUSE) {
            if (
                (block.timestamp < timeOfLastUpdate + minTimeBetweenUpdates) ||
                (priorityPool.depositsSinceLastUpdate() < minDepositsSinceLastUpdate)
            ) {
                revert UpdateConditionsNotMet();
            }
            _pauseForUpdate();
        } else if (upkeepType == UpkeepType.REQUEST) {
            _requestUpdate();
        } else {
            revert InvalidUpkeepType();
        }
    }

    /**
     * @notice Pauses the priority pool so a new merkle tree can be calculated
     * @dev must always be called before requestUpdate()
     */
    function pauseForUpdate() external onlyOwner {
        _pauseForUpdate();
    }

    /**
     * @notice Requests a new update which will calculate a new merkle tree, post the data to IPFS, and update
     * the priority pool
     * @dev pauseForUpdate() must be called before calling this function
     */
    function requestUpdate() external onlyOwner {
        _requestUpdate();
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

    /**
     * @notice Sets the params used to determine update frequency
     * @param _minTimeBetweenUpdates min amount of seconds between updates
     * @param _minDepositsSinceLastUpdate min amount of deposits from the priority pool to the
     *         staking pool needed to request update
     * @param _minBlockConfirmations min # of blocks to wait to request update after pausing priority pool
     * */
    function setUpdateParams(
        uint256 _minTimeBetweenUpdates,
        uint256 _minDepositsSinceLastUpdate,
        uint256 _minBlockConfirmations
    ) external onlyOwner {
        minTimeBetweenUpdates = _minTimeBetweenUpdates;
        minDepositsSinceLastUpdate = _minDepositsSinceLastUpdate;
        minBlockConfirmations = _minBlockConfirmations;
    }

    /**
     * @notice Sets the params related to Chainlink requests
     * @param _jobId id of job
     * @param _fee fee charged for each request paid in LINK
     * */
    function setChainlinkParams(bytes32 _jobId, uint256 _fee) external onlyOwner {
        jobId = _jobId;
        fee = _fee;
    }

    /**
     * @notice Pauses the priority pool so a new merkle tree can be calculated
     * @dev must always be called before requestUpdate()
     */
    function _pauseForUpdate() private {
        priorityPool.pauseForUpdate();
        pausedAtBlockNumber = block.number;
        timeOfLastUpdate = block.timestamp;
    }

    /**
     * @notice Requests a new update which will calculate a new merkle tree, post the data to IPFS, and update
     * the priority pool
     * @dev pauseForUpdate() must be called before calling this function
     */
    function _requestUpdate() private {
        if (!priorityPool.paused()) revert NotPaused();
        if (block.number < pausedAtBlockNumber + minBlockConfirmations) revert InsufficientBlockConfirmations();
        Chainlink.Request memory req = buildChainlinkRequest(jobId, address(this), this.fulfillRequest.selector);
        req.addUint("blockNumber", pausedAtBlockNumber);
        sendChainlinkRequest(req, fee);
    }
}
