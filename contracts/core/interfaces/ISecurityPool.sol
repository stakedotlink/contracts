// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

interface ISecurityPool {
    function initiateClaim() external;

    function resolveClaim() external;
}
