// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

interface IEthStakingStrategy {
    function nwlWithdraw(address _receiver, uint _amount) external;

    function depositEther(
        uint _nwlTotalValidatorCount,
        uint _wlTotalValidatorCount,
        uint[] calldata _wlOperatorIds,
        uint[] calldata _wlValidatorCounts
    ) external;
}
