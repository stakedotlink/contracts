// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import {MerkleDistributor} from "../../../contracts/airdrop/MerkleDistributor.sol";
import {BaseTest} from "../Base.t.sol";
import {ERC677} from "../../../contracts/core/tokens/base/ERC677.sol";

contract MerkleDistributorForkTest is BaseTest {
    bool internal _fork = true;

    function setUp() public {
        BaseTest.init(_fork);
    }
}
