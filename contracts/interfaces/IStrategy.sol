// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.11;

interface IStrategy {
    function deposit(uint256 _amount) external;

    function withdraw(uint256 _amount) external;

    function claimRewards() external;

    function setDepositMin(uint256 _depositMin) external;

    function setDepositMax(uint256 _depositMax) external;

    function setGovernance(address _governance) external;

    function totalDeposits() external view returns (uint256);

    function canDeposit() external view returns (uint256);

    function canWithdraw() external view returns (uint256);

    function depositDeficit() external view returns (uint256);

    function rewards() external view returns (uint256);
}
