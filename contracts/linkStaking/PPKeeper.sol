// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "../core/interfaces/IPriorityPool.sol";
import "./interfaces/IFundFlowController.sol";

/**
 * @title Priority Pool Keeper
 * @notice Proxies keeper calls to the priority pool so deposit data can be fetched beforehand
 */
contract PPKeeper {
    IPriorityPool public priorityPool;
    IFundFlowController public fundFlowController;

    constructor(address _priorityPool, address _fundFlowController) {
        priorityPool = IPriorityPool(_priorityPool);
        fundFlowController = IFundFlowController(_fundFlowController);
    }

    function checkUpkeep(bytes calldata) external view returns (bool, bytes memory) {
        (bool upkeepNeeded, bytes memory data) = priorityPool.checkUpkeep("");

        if (!upkeepNeeded) return (false, "");

        uint256 amountToDeposit = abi.decode(data, (uint256));
        bytes[] memory depositData = fundFlowController.getDepositData(amountToDeposit);

        return (true, abi.encode(depositData));
    }

    function performUpkeep(bytes calldata _performData) external {
        priorityPool.performUpkeep(_performData);
    }
}
