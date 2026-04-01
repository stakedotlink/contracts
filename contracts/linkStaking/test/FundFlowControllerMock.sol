// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

import "../interfaces/IFundFlowController.sol";
import "../interfaces/IVaultControllerStrategy.sol";

contract FundFlowControllerMock is IFundFlowController {
    bool public claimPeriodIsActive;

    function setClaimPeriodActive(bool _active) external {
        claimPeriodIsActive = _active;
    }

    function claimPeriodActive() external view override returns (bool) {
        return claimPeriodIsActive;
    }

    function getDepositData(uint256) external pure override returns (bytes[] memory) {
        return new bytes[](0);
    }

    function updateOperatorVaultGroupAccounting(uint256[] calldata) external override {}

    function setTotalUnbonded(address _strategy, uint256 _totalUnbonded) external {
        IVaultControllerStrategy(_strategy).updateVaultGroups(
            new uint256[](0),
            0,
            0,
            _totalUnbonded
        );
    }
}
