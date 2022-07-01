// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../base/RewardsPoolController.sol";

/**
 * @title Rewards Pool Controler Mock
 * @notice Mocks contract for testing
 */
contract RewardsPoolControllerMock is RewardsPoolController {
    using SafeERC20 for IERC20;

    IERC20 public token;

    uint public totalStaked;
    mapping(address => uint) public stakeBalances;

    constructor(address _token) {
        token = IERC20(_token);
    }

    function rpcStaked(address _account) external view returns (uint) {
        return stakeBalances[_account];
    }

    function rpcTotalStaked() external view returns (uint) {
        return totalStaked;
    }

    function rewardPoolCreators() public pure override returns (address[] memory) {
        address[] memory addresses;
        return addresses;
    }

    function stake(uint _amount) external updateRewards(msg.sender) {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        stakeBalances[msg.sender] += _amount;
        totalStaked += _amount;
    }

    function withdraw(uint _amount) external updateRewards(msg.sender) {
        stakeBalances[msg.sender] -= _amount;
        totalStaked -= _amount;
        token.safeTransfer(msg.sender, _amount);
    }
}
