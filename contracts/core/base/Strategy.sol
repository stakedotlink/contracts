// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "../interfaces/IStrategy.sol";
import "../interfaces/IStakingPool.sol";

/**
 * @title Strategy
 * @notice Base strategy contract to inherit from
 */
abstract contract Strategy is IStrategy, Initializable, UUPSUpgradeable, OwnableUpgradeable {
    IERC20Upgradeable public token;
    IStakingPool public stakingPool;

    uint public depositsMin;
    uint public depositsMax;

    function __Strategy_init(
        address _token,
        address _stakingPool,
        uint _depositsMax,
        uint _depositsMin
    ) public onlyInitializing {
        token = IERC20Upgradeable(_token);
        stakingPool = IStakingPool(_stakingPool);
        depositsMax = _depositsMax;
        depositsMin = _depositsMin;
        __Ownable_init();
        __UUPSUpgradeable_init();
    }

    modifier onlyStakingPool() {
        require(address(stakingPool) == msg.sender, "StakingPool only");
        _;
    }

    function setDepositsMax(uint256 _depositsMax) external onlyOwner {
        depositsMax = _depositsMax;
    }

    function setDepositsMin(uint256 _depositsMin) external onlyOwner {
        depositsMin = _depositsMin;
    }

    /**
     * @notice returns the available deposit room for this strategy
     * @return available deposit room
     */
    function canDeposit() public view virtual returns (uint) {
        uint deposits = totalDeposits();
        if (deposits >= depositsMax) {
            return 0;
        } else {
            return depositsMax - deposits;
        }
    }

    /**
     * @notice returns the available withdrawal room for this strategy
     * @return available withdrawal room
     */
    function canWithdraw() public view virtual returns (uint) {
        uint deposits = totalDeposits();
        if (deposits <= depositsMin) {
            return 0;
        } else {
            return deposits - depositsMin;
        }
    }

    /**
     * @notice returns the total amount of deposits in this strategy
     * @return total deposits
     */
    function totalDeposits() public view virtual returns (uint);

    /**
     * @notice returns the maximum that can be deposited into the strategy
     * @return max deposit
     */
    function maxDeposits() public view virtual returns (uint) {
        return depositsMax;
    }

    /**
     * @notice returns the minimum that can be deposited into the strategy
     * @return min deposit
     */
    function minDeposits() public view virtual returns (uint) {
        return depositsMin;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
