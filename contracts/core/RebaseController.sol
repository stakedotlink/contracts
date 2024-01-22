// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/IStakingPool.sol";
import "./interfaces/IPriorityPool.sol";
import "./interfaces/IStrategy.sol";
import "./interfaces/ISDLPoolCCIPControllerPrimary.sol";
import "./interfaces/IInsurancePool.sol";

/**
 * @title Rebase Controller
 * @notice Updates and distributes rewards across the staking pool and cross-chain SDL Pools
 * @dev Chainlink automation should call updateRewards periodically under normal circumstances and call performUpkeep
 * in the case of a negative rebase in the staking pool
 */
contract RebaseController is Ownable {
    IStakingPool public stakingPool;
    IPriorityPool public priorityPool;
    ISDLPoolCCIPControllerPrimary public sdlPoolCCIPController;
    IInsurancePool public insurancePool;

    uint256 public maxRebaseLossBP;

    mapping(address => bool) public whitelistedCallers;

    event WhitelistCaller(address indexed caller, bool shouldWhitelist);

    error NoStrategiesToUpdate();
    error PositiveDepositChange();
    error SenderNotAuthorized();
    error InvalidMaxRebaseLoss();

    constructor(
        address _stakingPool,
        address _priorityPool,
        address _sdlPoolCCIPController,
        address _insurancePool,
        uint256 _maxRebaseLossBP
    ) {
        stakingPool = IStakingPool(_stakingPool);
        priorityPool = IPriorityPool(_priorityPool);
        sdlPoolCCIPController = ISDLPoolCCIPControllerPrimary(_sdlPoolCCIPController);
        insurancePool = IInsurancePool(_insurancePool);
        if (_maxRebaseLossBP > 9000) revert InvalidMaxRebaseLoss();
        maxRebaseLossBP = _maxRebaseLossBP;
    }

    /**
     * @notice updates strategy rewards in the staking pool and distributes rewards to cross-chain SDL pools
     * @param _strategyIdxs indexes of strategies to update rewards for
     * @param _data encoded data to be passed to each strategy
     * @param _gasLimits list of gas limits to use for CCIP messages on secondary chains
     **/
    function updateRewards(
        uint256[] calldata _strategyIdxs,
        bytes calldata _data,
        uint256[] calldata _gasLimits
    ) external {
        if (!whitelistedCallers[msg.sender]) revert SenderNotAuthorized();
        stakingPool.updateStrategyRewards(_strategyIdxs, _data);
        sdlPoolCCIPController.distributeRewards(_gasLimits);
    }

    /**
     * @notice returns whether or not rewards should be updated due to a negative rebase and the strategies to update
     * @return upkeepNeeded whether or not rewards should be updated
     * @return performData abi encoded list of strategy indexes to update
     **/
    function checkUpkeep(bytes calldata) external view returns (bool, bytes memory) {
        address[] memory strategies = stakingPool.getStrategies();
        bool[] memory strategiesToUpdate = new bool[](strategies.length);
        uint256 totalStrategiesToUpdate;

        for (uint256 i = 0; i < strategies.length; ++i) {
            IStrategy strategy = IStrategy(strategies[i]);
            if (strategy.getDepositChange() < 0) {
                strategiesToUpdate[i] = true;
                totalStrategiesToUpdate++;
            }
        }

        if (totalStrategiesToUpdate != 0) {
            uint256[] memory strategyIdxs = new uint256[](totalStrategiesToUpdate);
            uint256 strategiesAdded;

            for (uint256 i = 0; i < strategiesToUpdate.length; ++i) {
                if (strategiesToUpdate[i]) {
                    strategyIdxs[strategiesAdded] = i;
                    strategiesAdded++;
                }
            }

            return (true, abi.encode(strategyIdxs));
        }

        return (false, "0x");
    }

    /**
     * @notice Updates rewards in the case of a negative rebase and pauses the priority
     * pool if losses exceed the maximum
     * @param _performData abi encoded list of strategy indexes to update
     */
    function performUpkeep(bytes calldata _performData) external {
        address[] memory strategies = stakingPool.getStrategies();
        uint256[] memory strategiesToUpdate = abi.decode(_performData, (uint256[]));

        if (strategiesToUpdate.length == 0) revert NoStrategiesToUpdate();

        int256 totalDepositChange;

        for (uint256 i = 0; i < strategiesToUpdate.length; ++i) {
            int256 depositChange = IStrategy(strategies[strategiesToUpdate[i]]).getDepositChange();
            if (depositChange >= 0) revert PositiveDepositChange();
            totalDepositChange += depositChange;
        }

        if (uint256(-10000 * totalDepositChange) / stakingPool.totalSupply() > maxRebaseLossBP) {
            priorityPool.setPoolStatus(IPriorityPool.PoolStatus(2));
            insurancePool.initiateClaim();
        }

        stakingPool.updateStrategyRewards(strategiesToUpdate, "");
    }

    /**
     * @notice sets the maximum basis point amount of the total amount staked in the staking pool that can be
     * lost in a single rebase without pausing the pool
     * @param _maxRebaseLossBP max basis point loss
     */
    function setMaxRebaseLossBP(uint256 _maxRebaseLossBP) external onlyOwner {
        if (_maxRebaseLossBP > 9000) revert InvalidMaxRebaseLoss();
        maxRebaseLossBP = _maxRebaseLossBP;
    }
}
