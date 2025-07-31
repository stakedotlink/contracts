// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRouterClient} from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import "../interfaces/IERC677.sol";

/**
 * @title CCIP Curve Gauge Sender
 * @notice Sends LST rewards to a CCIP Curve Gauge Receiver on a destination chain
 */
contract CCIPCurveGaugeSender is Ownable {
    using SafeERC20 for IERC20;

    // address of LST
    IERC677 public lst;
    // address of wrapped LST
    IERC20 public wlst;

    // address of CCIP Router
    IRouterClient public router;
    // address of LINK token
    IERC20 public linkToken;

    // CCIP destination chain selector
    uint64 public destinationChainSelector;
    // address of CCIP Curve Gauge Receiver on destination chain
    address public ccipCurveGaugeReceiver;
    // extra args for CCIP message
    bytes public extraArgs;

    // address authorized to send rewards
    address public rewardsSender;

    event RewardsSent(bytes32 indexed messageId, uint256 amount, uint256 fees);

    error InsufficientFeeBalance(uint256 available, uint256 required);
    error NoRewards();
    error SenderNotAuthorized();

    /**
     * @notice Initializes the contract
     * @param _lst address of LST
     * @param _wlst address of wrapped LST
     * @param _router address of CCIP Router
     * @param _linkToken address of LINK token
     * @param _destinationChainSelector CCIP destination chain selector
     * @param _extraArgs extra args for CCIP message
     * @param _rewardsSender address authorized to send rewards
     */
    constructor(
        address _lst,
        address _wlst,
        address _router,
        address _linkToken,
        uint64 _destinationChainSelector,
        bytes memory _extraArgs,
        address _rewardsSender
    ) {
        lst = IERC677(_lst);
        wlst = IERC20(_wlst);
        router = IRouterClient(_router);
        linkToken = IERC20(_linkToken);
        destinationChainSelector = _destinationChainSelector;
        extraArgs = _extraArgs;
        rewardsSender = _rewardsSender;
        linkToken.approve(address(_router), type(uint256).max);
        IERC20(_wlst).approve(address(_router), type(uint256).max);
    }

    /**
     * @notice Reverts if the sender is not the rewards sender
     */
    modifier onlyRewardsSender() {
        if (msg.sender != rewardsSender) revert SenderNotAuthorized();
        _;
    }

    /**
     * @notice Receives transfers of LST rewards from staking pool
     */
    function onTokenTransfer(address, uint256, bytes calldata) external {}

    /**
     * @notice Sends LST rewards to a CCIP Curve Gauge Receiver on another chain
     * @return ID of the sent message
     */
    function sendRewards() external onlyRewardsSender returns (bytes32) {
        uint256 lstAmount = lst.balanceOf(address(this));
        if (lstAmount == 0) revert NoRewards();

        lst.transferAndCall(address(wlst), lstAmount, "");
        uint256 wlstAmount = IERC20(wlst).balanceOf(address(this));

        Client.EVM2AnyMessage memory evm2AnyMessage = _buildCCIPMessage(
            ccipCurveGaugeReceiver,
            address(wlst),
            wlstAmount,
            address(linkToken),
            extraArgs
        );

        uint256 fees = router.getFee(destinationChainSelector, evm2AnyMessage);
        if (fees > linkToken.balanceOf(address(this)))
            revert InsufficientFeeBalance(linkToken.balanceOf(address(this)), fees);

        bytes32 messageId = router.ccipSend(destinationChainSelector, evm2AnyMessage);

        emit RewardsSent(messageId, wlstAmount, fees);

        return messageId;
    }

    /**
     * @notice Returns the balance of LINK tokens in the contract
     * @return LINK token balance
     */
    function getFeeBalance() external view returns (uint256) {
        return linkToken.balanceOf(address(this));
    }

    /**
     * @notice Withdraws LINK tokens from the contract
     * @param _amount amount of LINK tokens to withdraw
     */
    function withdrawFees(uint256 _amount) external onlyOwner {
        linkToken.safeTransfer(msg.sender, _amount);
    }

    /**
     * @notice Sets the extra args for CCIP message
     * @param _extraArgs extra args for CCIP message
     */
    function setExtraArgs(bytes calldata _extraArgs) external onlyOwner {
        extraArgs = _extraArgs;
    }

    /**
     * @notice Sets the CCIP Curve Gauge Receiver
     * @param _ccipCurveGaugeReceiver address of CCIP Curve Gauge Receiver on destination chain
     */
    function setCCIPCurveGaugeReceiver(address _ccipCurveGaugeReceiver) external onlyOwner {
        ccipCurveGaugeReceiver = _ccipCurveGaugeReceiver;
    }

    /**
     * @notice Sets the address authorized to send rewards
     * @param _rewardsSender address authorized to send rewards
     */
    function setRewardsSender(address _rewardsSender) external onlyOwner {
        rewardsSender = _rewardsSender;
    }

    /**
     * @notice Builds a CCIP message
     * @param _receiver address of receiver on destination chain
     * @param _token address of token to send
     * @param _amount amount of tokens to send
     * @param _feeTokenAddress address of fee token
     * @param _extraArgs extra args for CCIP message
     */
    function _buildCCIPMessage(
        address _receiver,
        address _token,
        uint256 _amount,
        address _feeTokenAddress,
        bytes memory _extraArgs
    ) private pure returns (Client.EVM2AnyMessage memory) {
        Client.EVMTokenAmount[] memory tokenAmounts = new Client.EVMTokenAmount[](1);
        tokenAmounts[0] = Client.EVMTokenAmount({token: _token, amount: _amount});

        return
            Client.EVM2AnyMessage({
                receiver: abi.encode(_receiver),
                data: "",
                tokenAmounts: tokenAmounts,
                extraArgs: _extraArgs,
                feeToken: _feeTokenAddress
            });
    }
}
