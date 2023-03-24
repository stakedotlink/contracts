// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

interface IEthStakingStrategy {
    function operatorControllerWithdraw(address _receiver, uint256 _amount) external;

    function depositEther(
        uint256[] calldata _depositAmounts,
        uint256[] calldata _totalValidatorCounts,
        uint256[][] calldata _operatorIds,
        uint256[][] calldata _validatorCounts
    ) external;

    function getOperatorControllers() external view returns (address[] memory);
}
