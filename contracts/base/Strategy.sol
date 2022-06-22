// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;

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

    function initialize(
        address _token,
        address _stakingPool,
        uint _depositsMax,
        uint _depositsMin
    ) public virtual initializer {
        token = IERC20Upgradeable(_token);
        stakingPool = IStakingPool(_stakingPool);
        depositsMax = _depositsMax;
        depositsMin = _depositsMin;
        __Ownable_init();
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

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
