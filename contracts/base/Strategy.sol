// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../interfaces/IStrategy.sol";
import "../interfaces/IStakingPool.sol";

/**
 * @title Strategy
 * @notice Base strategy contract to inherit from
 */
abstract contract Strategy is IStrategy {
    IERC20 public token;
    IStakingPool public stakingPool;

    uint256 public depositsMin;
    uint256 public depositsMax;

    address public governance;

    constructor(
        address _token,
        address _stakingPool,
        address _governance,
        uint256 _depositsMax,
        uint256 _depositsMin
    ) {
        token = IERC20(_token);
        stakingPool = IStakingPool(_stakingPool);
        depositsMax = _depositsMax;
        depositsMin = _depositsMin;
        governance = _governance;
    }

    modifier onlyStakingPool() {
        require(address(stakingPool) == msg.sender, "StakingPool only");
        _;
    }

    modifier onlyGovernance() {
        require(governance == msg.sender, "Governance only");
        _;
    }

    function setDepositsMax(uint256 _depositsMax) external onlyGovernance {
        depositsMax = _depositsMax;
    }

    function setDepositsMin(uint256 _depositsMin) external onlyGovernance {
        depositsMin = _depositsMin;
    }

    function setGovernance(address _governance) external onlyGovernance {
        governance = _governance;
    }
}
