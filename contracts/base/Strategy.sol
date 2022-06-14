// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../interfaces/IStrategy.sol";

/**
 * @title Strategy
 * @notice Base strategy contract to inherit from
 */
abstract contract Strategy is IStrategy {
    IERC20 public token;
    address public stakingPool;

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
