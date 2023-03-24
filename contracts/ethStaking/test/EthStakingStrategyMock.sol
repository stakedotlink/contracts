// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "../interfaces/IOperatorController.sol";

contract EthStakingStrategyMock {
    address public operatorController;

    receive() external payable {}

    function depositEther(uint256 _totalValidatorCount) external {
        uint256[] memory operatorIds;
        uint256[] memory validatorCounts;
        IOperatorController(operatorController).assignNextValidators(_totalValidatorCount, operatorIds, validatorCounts);
    }

    function operatorControllerWithdraw(address, uint256) external {
        require(msg.sender == address(operatorController), "Sender is not operator controller");
    }

    function setOperatorController(address _operatorController) external {
        operatorController = _operatorController;
    }
}
