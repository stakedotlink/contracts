// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.11;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract ExampleStrategy {
    using SafeERC20 for IERC20;

    IERC20 public token;
    address public stakingPool;

    uint256 public totalDeposits;
    uint256 public depositMax;
    uint256 public depositMin;

    address public governance;

    constructor(
        address _token,
        address _stakingPool,
        address _governance,
        uint256 _depositMax,
        uint256 _depositMin
    ) {
        token = IERC20(_token);
        stakingPool = _stakingPool;
        depositMax = _depositMax;
        depositMin = _depositMin;
        governance = _governance;
    }

    modifier onlyStakingPool() {
        require(stakingPool == msg.sender, "StakingPool only");
        _;
    }

    modifier onlyGovernance() {
        require(governance == msg.sender, "Governance only");
        _;
    }

    function canDeposit() public view returns (uint256) {
        if (totalDeposits < depositMax) {
            return depositMax - totalDeposits;
        }
        return 0;
    }

    function canWithdraw() public view returns (uint256) {
        if (totalDeposits < depositMin) {
            return 0;
        }
        return totalDeposits - depositMin;
    }

    function depositDeficit() public view returns (uint256) {
        if (totalDeposits > depositMin) {
            return 0;
        }
        return depositMin - totalDeposits;
    }

    function rewards() public view returns (uint256) {
        return token.balanceOf(address(this)) - totalDeposits;
    }

    function deposit(uint256 _amount) external onlyStakingPool {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        totalDeposits = totalDeposits + _amount;
        // Deposit into earning protocol/node
    }

    function withdraw(uint256 _amount) external onlyStakingPool {
        require(_amount <= canWithdraw(), "Total deposits must remain >= minimum");
        totalDeposits = totalDeposits - _amount;
        //Withdraw from earning protocol/node
        token.safeTransfer(msg.sender, _amount);
    }

    function claimRewards() external onlyStakingPool {
        uint256 claimable = rewards();
        if (claimable > 0) {
            totalDeposits = totalDeposits + claimable;
        }
    }

    function setDepositMax(uint256 _depositMax) external onlyGovernance {
        depositMax = _depositMax;
    }

    function setDepositMin(uint256 _depositMin) external onlyGovernance {
        depositMin = _depositMin;
    }

    function setGovernance(address _governance) external onlyGovernance {
        governance = _governance;
    }
}
