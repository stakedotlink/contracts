// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

interface IEthStakingStrategy {
    function nwlWithdraw(address _receiver, uint _amount) external;
}
