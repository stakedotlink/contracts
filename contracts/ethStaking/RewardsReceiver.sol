// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RewardsReceiver
 * @notice Receives rewards to be distributed to the ETH staking strategy
 */
contract RewardsReceiver is Ownable {
    address payable public immutable ethStakingStrategy;
    uint public minWithdrawalAmount;
    uint public maxWithdrawalAmount;

    event RewardsReceived(uint amount);
    event RewardsWithdrawn(uint amount);
    event SetWithdrawalLimits(uint min, uint max);

    constructor(
        address _ethStakingStrategy,
        uint _minWithdrawalAmount,
        uint _maxWithdrawalAmount
    ) {
        ethStakingStrategy = payable(_ethStakingStrategy);
        minWithdrawalAmount = _minWithdrawalAmount;
        maxWithdrawalAmount = _maxWithdrawalAmount;
    }

    receive() external payable {
        emit RewardsReceived(msg.value);
    }

    /**
     * @notice Withdraws rewards to the ETH staking strategy
     */
    function withdraw() external returns (uint) {
        require(msg.sender == ethStakingStrategy, "Sender is not ETH staking strategy");

        uint balance = address(this).balance;
        uint value;

        if (balance < minWithdrawalAmount) {
            value = 0;
        } else if (balance > maxWithdrawalAmount) {
            value = maxWithdrawalAmount;
        } else {
            value = balance;
        }

        if (value > 0) {
            (bool success, ) = ethStakingStrategy.call{value: value}("");
            require(success, "ETH transfer failed");
            emit RewardsWithdrawn(value);
        }

        return value;
    }

    /**
     * @notice Sets the minimum and maximum amount that can be withdrawn per transaction
     * @param _minWithdrawalAmount minimum amount
     * @param _maxWithdrawalAmount maximum amount
     */
    function setWithdrawalLimits(uint _minWithdrawalAmount, uint _maxWithdrawalAmount) external onlyOwner {
        require(_minWithdrawalAmount <= _maxWithdrawalAmount, "min must be less than or equal to max");
        minWithdrawalAmount = _minWithdrawalAmount;
        maxWithdrawalAmount = _maxWithdrawalAmount;
        emit SetWithdrawalLimits(_minWithdrawalAmount, _maxWithdrawalAmount);
    }
}
