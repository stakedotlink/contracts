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

    uint public stakedTotal;
    mapping(address => uint) public stakeBalances;

    constructor(
        address _token,
        string memory _derivativeTokenName,
        string memory _derivativeTokenSymbol
    ) RewardsPoolController(_derivativeTokenName, _derivativeTokenSymbol) {
        token = IERC20(_token);
    }

    function staked(address _account) external view override returns (uint) {
        return stakeBalances[_account];
    }

    function totalStaked() external view override returns (uint) {
        return stakedTotal;
    }

    function stake(uint _amount) external updateRewards(msg.sender) {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        stakeBalances[msg.sender] += _amount;
        stakedTotal += _amount;
    }

    function withdraw(uint _amount) external updateRewards(msg.sender) {
        stakeBalances[msg.sender] -= _amount;
        stakedTotal -= _amount;
        token.safeTransfer(msg.sender, _amount);
    }
}
