// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../base/Strategy.sol";

/**
 * @title Strategy Mock
 * @notice Mocks contract for testing
 */
contract StrategyMock is Strategy {
    using SafeERC20 for IERC20;

    uint public totalDeposits;

    function initialize(
        address _token,
        address _stakingPool,
        uint _depositsMax,
        uint _depositsMin
    ) public override initializer {
        Strategy.initialize(_token, _stakingPool, _depositsMax, _depositsMin);
    }

    function canDeposit() public view returns (uint) {
        if (totalDeposits < depositsMax) {
            return depositsMax - totalDeposits;
        }
        return 0;
    }

    function canWithdraw() public view returns (uint) {
        if (totalDeposits <= depositsMin) {
            return 0;
        }
        return totalDeposits - depositsMin;
    }

    // should return the change in deposits since updateRewards was last called (can be positive or negative)
    function depositChange() public view returns (int) {
        return int(token.balanceOf(address(this))) - int(totalDeposits);
    }

    function deposit(uint256 _amount) external onlyStakingPool {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        totalDeposits += _amount;
        // Deposit into earning protocol/node
    }

    function withdraw(uint256 _amount) external onlyStakingPool {
        require(_amount <= canWithdraw(), "Total deposits must remain >= minimum");
        totalDeposits -= _amount;
        //Withdraw from earning protocol/node
        token.safeTransfer(msg.sender, _amount);
    }

    function updateDeposits() external onlyStakingPool {
        int256 balanceChange = depositChange();
        if (balanceChange > 0) {
            totalDeposits += uint(balanceChange);
        } else if (balanceChange < 0) {
            totalDeposits -= uint(balanceChange * -1);
        }
    }

    function simulateSlash(uint _amount) external {
        token.safeTransfer(msg.sender, _amount);
    }
}
