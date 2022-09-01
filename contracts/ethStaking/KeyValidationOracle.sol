// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@chainlink/contracts/src/v0.8/ChainlinkClient.sol";

import "./interfaces/IOperatorController.sol";

/**
 * @title Key Validation Oracle
 * @notice Handles validator key/signature pair validation
 */
contract KeyValidationOracle is Ownable, ChainlinkClient {
    using Chainlink for Chainlink.Request;

    IOperatorController public nwlOperatorController;
    IOperatorController public wlOperatorController;

    uint public fee;
    bytes32 private jobId;

    constructor(
        address _nwlOperatorController,
        address _wlOperatorController,
        address _chainlinkToken,
        address _chainlinkOracle,
        bytes32 _jobId,
        uint _fee
    ) {
        nwlOperatorController = IOperatorController(_nwlOperatorController);
        wlOperatorController = IOperatorController(_wlOperatorController);
        setChainlinkToken(_chainlinkToken);
        setChainlinkOracle(_chainlinkOracle);
        jobId = _jobId;
        fee = _fee;
    }

    function onTokenTransfer(
        address _sender,
        uint _value,
        bytes calldata _calldata
    ) external {
        require(msg.sender == chainlinkTokenAddress(), "Sender is not chainlink token");
        require(_value == fee, "Value is not equal to fee");

        (uint operatorId, bool isWhitelisted) = abi.decode(_calldata, (uint, bool));

        _initiateKeyPairValidation(_sender, operatorId, isWhitelisted);
    }

    function reportKeyPairValidation(
        bytes32 _requestId,
        uint _operatorId,
        bool _isWhitelisted,
        bool _success
    ) external recordChainlinkFulfillment(_requestId) {
        if (_isWhitelisted) {
            wlOperatorController.reportKeyPairValidation(_operatorId, _success);
        } else {
            nwlOperatorController.reportKeyPairValidation(_operatorId, _success);
        }
    }

    function setOracleConfig(
        address _chainlinkOracle,
        bytes32 _jobId,
        uint _fee
    ) external onlyOwner {
        setChainlinkOracle(_chainlinkOracle);
        jobId = _jobId;
        fee = _fee;
    }

    function _initiateKeyPairValidation(
        address _sender,
        uint _operatorId,
        bool _isWhitelisted
    ) private {
        if (_isWhitelisted) {
            wlOperatorController.initiateKeyPairValidation(_sender, _operatorId);
        } else {
            nwlOperatorController.initiateKeyPairValidation(_sender, _operatorId);
        }

        Chainlink.Request memory req = buildChainlinkRequest(jobId, address(this), this.reportKeyPairValidation.selector);

        req.add("operatorId", Strings.toString(_operatorId));
        req.add("isWhitelisted", _isWhitelisted ? "true" : "false");

        sendChainlinkRequest(req, fee);
    }
}
