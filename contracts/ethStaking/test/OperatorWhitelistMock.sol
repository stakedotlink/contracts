// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

contract OperatorWhitelistMock {
    function isWhitelisted(address _operator) external view returns (bool) {
        return true;
    }
}
