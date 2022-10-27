// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "../interfaces/INWLOperatorController.sol";

contract EthStakingStrategyMock {
    address public nwlOperatorController;

    receive() external payable {}

    function depositEther(uint _totalValidatorCount) external {
        INWLOperatorController(nwlOperatorController).assignNextValidators(_totalValidatorCount);
    }

    function nwlWithdraw(address _receiver, uint _amount) external {
        require(msg.sender == address(nwlOperatorController), "Sender is not non-whitelisted operator controller");
    }

    function setNWLOperatorController(address _nwlOperatorController) external {
        nwlOperatorController = _nwlOperatorController;
    }
}
