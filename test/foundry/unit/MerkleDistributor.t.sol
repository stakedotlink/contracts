// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import {MerkleDistributor} from "../../../contracts/airdrop/MerkleDistributor.sol";
import {BaseTest} from "../Base.t.sol";
import {ERC677} from "../../../contracts/core/tokens/base/ERC677.sol";

contract MerkleDistributorTest is BaseTest {
    bool internal _fork = false;

    function setUp() public {
        BaseTest.init(_fork);
    }

    function test_claimDistribution_EmptyProof() public {
        ERC677 _testToken = new ERC677("Token", "TKN", 1000000);
        merkleDistributor.addDistribution(address(_testToken), bytes32(""), 0, 0);
        bytes32[] memory _proof = new bytes32[](0);
        vm.expectRevert("MerkleDistributor: Invalid proof.");
        merkleDistributor.claimDistribution(address(_testToken), 0, users.user1, 10, _proof);
    }
}
