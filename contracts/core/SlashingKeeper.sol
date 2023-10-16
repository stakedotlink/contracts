// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "./interfaces/IStakingPool.sol";
import "./interfaces/IStrategy.sol";

/**
 * @title Slashing Keeper
 * @notice Updates strategy rewards if any losses have been incurred
 */
contract SlashingKeeper {
    IStakingPool public stakingPool;

    constructor(address _stakingPool) {
        stakingPool = IStakingPool(_stakingPool);
    }

    /**
     * @notice returns whether or not rewards should be updated and the strategies to update
     * @return upkeepNeeded whether or not rewards should be updated
     * @return performData abi encoded list of strategy indexes to update
     **/
    function checkUpkeep(bytes calldata) external view returns (bool, bytes memory) {
        address[] memory strategies = stakingPool.getStrategies();
        bool[] memory strategiesToUpdate = new bool[](strategies.length);
        uint256 totalStrategiesToUpdate;

        for (uint256 i = 0; i < strategies.length; i++) {
            IStrategy strategy = IStrategy(strategies[i]);
            if (strategy.getDepositChange() < 0) {
                strategiesToUpdate[i] = true;
                totalStrategiesToUpdate++;
            }
        }

        if (totalStrategiesToUpdate > 0) {
            uint256[] memory strategyIdxs = new uint256[](totalStrategiesToUpdate);
            uint256 strategiesAdded;

            for (uint256 i = 0; i < strategiesToUpdate.length; i++) {
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
     * @notice Updates rewards
     * @param _performData abi encoded list of strategy indexes to update
     */
    function performUpkeep(bytes calldata _performData) external {
        address[] memory strategies = stakingPool.getStrategies();
        uint256[] memory strategiesToUpdate = abi.decode(_performData, (uint256[]));
        require(strategiesToUpdate.length > 0, "No strategies to update");

        for (uint256 i = 0; i < strategiesToUpdate.length; i++) {
            require(IStrategy(strategies[strategiesToUpdate[i]]).getDepositChange() < 0, "Deposit change is >= 0");
        }
        stakingPool.updateStrategyRewards(strategiesToUpdate, "");
    }
}
