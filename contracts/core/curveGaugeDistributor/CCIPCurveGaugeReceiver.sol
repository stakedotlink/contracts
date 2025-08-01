// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {CCIPReceiver} from "@chainlink/contracts-ccip/contracts/applications/CCIPReceiver.sol";
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import "../interfaces/ICurveGaugeDistributor.sol";

/**
 * @title CCIP Curve Gauge Receiver
 * @notice Receives LST rewards from a CCIP Curve Gauge Sender on source chain
 */
contract CCIPCurveGaugeReceiver is CCIPReceiver {
    using SafeERC20 for IERC20;

    // address of wrapped LST
    IERC20 public wlst;
    // address of Curve Gauge Distributor
    ICurveGaugeDistributor public curveGaugeDistributor;

    // CCIP source chain selector
    uint64 public sourceChainSelector;
    // address of CCIP Curve Gauge Sender on source chain
    address public ccipCurveGaugeSender;

    event RewardsReceived(bytes32 indexed messageId, uint256 amount);

    error InvalidSourceChain();
    error InvalidSender();
    error NoRewards();

    /**
     * @notice Initializes the contract
     * @param _wlst address of wrapped LST
     * @param _curveGaugeDistributor address of Curve Gauge Distributor
     * @param _router address of CCIP Router
     * @param _sourceChainSelector CCIP source chain selector
     * @param _ccipCurveGaugeSender address of CCIP Curve Gauge Sender on source chain
     */
    constructor(
        address _wlst,
        address _curveGaugeDistributor,
        address _router,
        uint64 _sourceChainSelector,
        address _ccipCurveGaugeSender
    ) CCIPReceiver(_router) {
        wlst = IERC20(_wlst);
        curveGaugeDistributor = ICurveGaugeDistributor(_curveGaugeDistributor);
        sourceChainSelector = _sourceChainSelector;
        ccipCurveGaugeSender = _ccipCurveGaugeSender;
    }

    /**
     * @notice Handles incoming CCIP messages by accepting LST rewards and sending them to the Curve Gauge Distributor to be distributed
     * @param _any2EvmMessage the CCIP message
     */
    function _ccipReceive(Client.Any2EVMMessage memory _any2EvmMessage) internal override {
        if (_any2EvmMessage.sourceChainSelector != sourceChainSelector) revert InvalidSourceChain();
        if (abi.decode(_any2EvmMessage.sender, (address)) != address(ccipCurveGaugeSender))
            revert InvalidSender();

        uint256 amount = wlst.balanceOf(address(this));
        if (amount == 0) revert NoRewards();

        wlst.safeTransfer(address(curveGaugeDistributor), amount);
        curveGaugeDistributor.distributeRewards(0);

        emit RewardsReceived(_any2EvmMessage.messageId, _any2EvmMessage.destTokenAmounts[0].amount);
    }
}
