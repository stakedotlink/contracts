// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

interface IOperatorWhitelist {
    function useWhitelist(address _ownerAddress) external;
}
