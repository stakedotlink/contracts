// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

////////////////////////////////////////////////////////
//////////////////////// ERRORS ////////////////////////
////////////////////////////////////////////////////////
///@notice error emitted when the caller is not authorized
error ConceroPool_Unauthorized();
///@notice error emitted when the balance is not sufficient
error ConceroPool_InsufficientBalance();
///@notice error emitted when the transfer revert
error ConceroPool_TransferFailed();
///@notice error emitted when the user input an unsupported token
error ConceroPool_TokenNotSupported();
///@notice error emitted when the caller is not an Orchestrator
error ConceroPool_ItsNotAnOrchestrator(address caller);
///@notice error emitted when the receiver is the address(0)
error ConceroPool_InvalidAddress();
///@notice error emitted when the CCIP message sender is not allowed.
error ConceroPool_SenderNotAllowed(address _sender);
///@notice error emitted when an attempt to create a new request is made while other is still active.
error ConceroPool_ActivRequestNotFulfilledYet();
///@notice error emitted when an attempt to send value to a not allowed receiver is made
error ConceroPool_DestinationNotAllowed();
///@notice error emitted when the contract doesn't have enought link balance
error ConceroPool_NotEnoughLinkBalance(uint256 linkBalance, uint256 fees);

contract ConceroPoolMock is  Ownable {
  using SafeERC20 for IERC20;

  struct WithdrawRequests {
    uint256 condition;
    uint256 amount;
    bool isActiv;
    bool isFulfilled;
  }

  address public s_conceroOrchestrator;
  address public s_messengerAddress;

  ///@notice removing magic-numbers
  uint256 private constant APPROVED = 1;
  ///@notice the maximum percentage a direct withdraw can take.
  uint256 private constant WITHDRAW_THRESHOLD = 10;

  //1 == True
  ///@notice Mapping to keep track of allowed tokens
  mapping(address token => uint256 isApproved) public s_isTokenSupported;
  ///@notice Mapping to keep track of allowed senders on a given token
  mapping(address token => address senderAllowed) public s_approvedSenders;
  ///@notice Mapping to keep track of balances of user on a given token
  mapping(address token => mapping(address user => uint256 balance)) public s_userBalances;
  ///@notice Mapping to keep track of allowed pool senders
  mapping(uint64 chainId => mapping(address poolAddress => uint256)) public s_allowedPool;
  ///@notice Mapping to keep track of allowed pool receiver
  mapping(uint64 chainId => address pool) public s_poolReceiver;
  ///@notice Mapping to keep track of withdraw requests
  mapping(address token => WithdrawRequests) private s_withdrawWaitlist;

  ////////////////////////////////////////////////////////
  //////////////////////// EVENTS ////////////////////////
  ////////////////////////////////////////////////////////

  ///@notice event emitted when an Orchestrator is updated
  event ConceroPool_OrchestratorUpdated(address previousOrchestrator, address orchestrator);
  ///@notice event emitted when a Messenger is updated
  event ConceroPool_MessengerAddressUpdated(address previousMessenger, address messengerAddress);
  ///@notice event emitted when a supported token is added
  event ConceroPool_TokenSupportedUpdated(address token, uint256 isSupported);
  ///@notice event emitted when an approved sender is updated
  event ConceroPool_ApprovedSenderUpdated(address token, address indexed newSender);
  ///@notice event emitted when a Concero contract is added
  event ConceroPool_ConceroContractUpdated(uint64 chainSelector, address conceroContract, uint256 isAllowed);
  ///@notice event emitted when a Concero pool is added
  event ConceroPool_PoolReceiverUpdated(uint64 chainSelector, address pool);
  ///@notice event emitted when value is deposited into the contract
  event ConceroPool_Deposited(address indexed token, address indexed from, uint256 amount);
  ///@notice event emitted when a new withdraw request is made
  event ConceroPool_WithdrawRequest(address caller, address token, uint256 condition, uint256 amount);
  ///@notice event emitted when a value is withdraw from the contract
  event ConceroPool_Withdrawn(address to, address token, uint256 amount);
  ///@notice event emitted when a Cross-chain tx is received.
  event ConceroPool_CCIPReceived(bytes32 indexed ccipMessageId, uint64 srcChainSelector, address sender, address token, uint256 amount);
  ///@notice event emitted when a Cross-chain message is sent.
  event ConceroPool_MessageSent(bytes32 messageId, uint64 destinationChainSelector, address receiver, address linkToken, uint256 fees);

  receive() external payable {}

  /**
   * @notice function to deposit Ether
   * @dev The address(0) is hardcode as ether
   * @dev only approved address can call this function
  */
  function depositEther() external payable {
    uint256 valueToBeTransfered = msg.value;
    
    s_userBalances[address(0)][msg.sender] = s_userBalances[address(0)][msg.sender]+ valueToBeTransfered;

    emit ConceroPool_Deposited(address(0), msg.sender, valueToBeTransfered);
  }

  /**
   * @notice function to deposit ERC20 tokens
   * @param _token the address of the token to be deposited
   * @param _amount the amount to be deposited
   * @dev only approved address can call this function
  */
  function depositToken(address _token, uint256 _amount) external  {

    s_userBalances[_token][msg.sender] = s_userBalances[_token][msg.sender] + _amount;
    
    emit ConceroPool_Deposited(_token, msg.sender, _amount);

    IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
  }

  /**
   * @notice this function will manage LP's withdraw requests
   * @param _token the address of the token being withdraw
   * @param _amount the amount to be withdraw
   * @dev if the value is bigger than the threshold, a request will be created
   * @dev if the value is less than the threshold, the withdraw will procced right away.
   */
  function withdrawLiquidityRequest(address _token, uint256 _amount) external {
    if(_amount > s_userBalances[_token][msg.sender]) revert ConceroPool_InsufficientBalance();

    WithdrawRequests memory request = s_withdrawWaitlist[_token];

      if(_token == address(0)){

        uint256 etherBalance = address(this).balance;

        if(request.isActiv){
          if(etherBalance >= request.condition){

            s_withdrawWaitlist[_token].isActiv = false;
            s_withdrawWaitlist[_token].isFulfilled = true;

            _withdrawEther(request.amount);
          } else {
            revert ConceroPool_ActivRequestNotFulfilledYet();
          }
        }else{
          if(_amount > (etherBalance * WITHDRAW_THRESHOLD)/100){

            uint256 condition = _amount;

            s_withdrawWaitlist[_token] = WithdrawRequests({
              condition: condition,
              amount: _amount,
              isActiv: true,
              isFulfilled: false
            });
            emit ConceroPool_WithdrawRequest(msg.sender, _token, condition, _amount); //CLF will listen to this.
          } else{
            _withdrawEther(_amount);
          }
        }
      } else {
        uint256 erc20Balance = IERC20(_token).balanceOf(address(this));
        if(request.isActiv){
          if(erc20Balance >= request.condition){

            s_withdrawWaitlist[_token].isActiv = false;
            s_withdrawWaitlist[_token].isFulfilled = true;

            _withdrawToken(_token, request.amount);
          } else {
            revert ConceroPool_ActivRequestNotFulfilledYet();
          }
        } else {
          if(_amount > (erc20Balance * WITHDRAW_THRESHOLD)/100){

            uint256 condition = _amount;

            s_withdrawWaitlist[_token] = WithdrawRequests({
              condition: condition,
              amount: _amount,
              isActiv: true,
              isFulfilled: false
            });
            emit ConceroPool_WithdrawRequest(msg.sender, _token, condition, _amount); //CLF will listen to this.
          } else{
            _withdrawToken(_token, _amount);
          }
        }
    }
  }


  /**
   * @notice function to the Concero Orchestrator contract take loans
   * @param _token address of the token being loaned
   * @param _amount being loaned
   * @param _receiver address of the user that will receive the amount
   * @dev only the Orchestrator contract should be able to call this function
   * @dev for ether transfer, the _receiver need to be known and trusted
  */
  function orchestratorLoan(address _token, uint256 _amount, address _receiver) external {
    if(_receiver == address(0)) revert ConceroPool_InvalidAddress();

    if(_token == address(0)){
      if(_amount > address(this).balance) revert ConceroPool_InsufficientBalance();

      (bool sent, ) = _receiver.call{value: _amount}("");
      if(!sent) revert ConceroPool_TransferFailed();

    }else {
      if(_amount > IERC20(_token).balanceOf(address(this))) revert ConceroPool_InsufficientBalance();

      IERC20(_token).safeTransfer(_receiver, _amount);
    }
  }

  function addReward(address _account, address _token, uint256 _amount) external {
    s_userBalances[_token][_account] += _amount;
  }

 

  ///////////////
  /// PRIVATE ///
  ///////////////
  /**
   * @notice function to withdraw Ether
   * @param _amount the ether amout to withdraw
   * @dev The address(0) is hardcode as ether
   * @dev this is a private function that can only be called throught `withdrawLiquidityRequest`
  */
  function _withdrawEther(uint256 _amount) private  {
    if (_amount > s_userBalances[address(0)][msg.sender] || _amount > address(this).balance) revert ConceroPool_InsufficientBalance();

    s_userBalances[address(0)][msg.sender] = s_userBalances[address(0)][msg.sender] - _amount;

    emit ConceroPool_Withdrawn(msg.sender, address(0), _amount);

    (bool sent, ) = msg.sender.call{value: _amount}("");
    if(!sent) revert ConceroPool_TransferFailed();
  }

  /**
   * @notice function to withdraw ERC20 tokens from the pool
   * @param _token address of the token to be withdraw
   * @param _amount the total amount to be withdraw
   * @dev this is a private function that can only be called throught `withdrawLiquidityRequest`
  */
  function _withdrawToken(address _token, uint256 _amount) private {
    if(_amount > IERC20(_token).balanceOf(address(this))) revert ConceroPool_InsufficientBalance();

    s_userBalances[_token][msg.sender] = s_userBalances[_token][msg.sender] - _amount;

    emit ConceroPool_Withdrawn(msg.sender, _token,  _amount);

    IERC20(_token).safeTransfer(msg.sender, _amount);
  }

  ///////////////////////////
  ///VIEW & PURE FUNCTIONS///
  ///////////////////////////
  /**
   * @notice getter function to keep track of the contract balances
   * @param _token the address of the token
   * @return _contractBalance in the momento of the call.
   * @dev to access ether, _token must be address(0).
  */
  function availableBalanceNow(address _token) external view returns(uint256 _contractBalance){
    if(_token == address(0)){
      _contractBalance = address(this).balance;
    }else {
      _contractBalance = IERC20(_token).balanceOf(address(this));
    }    
  }

    /**
   * @notice getter function to keep track of the contract balances
   * @param _token the address of the token
   * @return _availableBalance in the momento of the call.
   * @dev to access ether, _token must be address(0).
   * @dev if the last request is still pending, the return value will be 0.
  */
  function availableToWithdraw(address _token) external view returns(uint256 _availableBalance){
    WithdrawRequests memory request = s_withdrawWaitlist[_token];
    uint256 balanceNow;

    if(_token == address(0)){
      balanceNow = address(this).balance;
      if(request.isActiv == true){
        _availableBalance = balanceNow > request.condition ? request.amount : 0 ;
      } else {
        _availableBalance = ((balanceNow * WITHDRAW_THRESHOLD)/100);
      }
    }else {
      balanceNow = IERC20(_token).balanceOf(address(this));
      if(request.isActiv == true){
        _availableBalance = balanceNow > request.condition ? request.amount : 0 ;
      } else {
        _availableBalance = ((balanceNow * WITHDRAW_THRESHOLD)/100);
      }
    }   
  }
  
  //@audit can remove this later
  function getRequestInfo(address _token) external view returns(WithdrawRequests memory request){
    request = s_withdrawWaitlist[_token];
  }

}