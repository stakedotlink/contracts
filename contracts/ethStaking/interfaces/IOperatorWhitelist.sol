// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

interface IOperatorWhitelist {
    function isWhitelisted(address _ownerAddress) external returns (bool);
}
