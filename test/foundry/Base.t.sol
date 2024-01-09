// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import {Test, console2} from "forge-std/Test.sol";
import {Users} from "./utils/Types.sol";
import {Utils} from "./utils/Utils.sol";
import {MerkleDistributor} from "../../contracts/airdrop/MerkleDistributor.sol";

abstract contract BaseTest is Test, Utils {
    Users internal users;
    uint256 internal network;
    MerkleDistributor public merkleDistributor;

    function init(bool _fork) public {
        if (_fork) {
            // commented out until github keys are setup
            // network = vm.createSelectFork(vm.rpcUrl("ethereum"));
            // merkleDistributor = MerkleDistributor(getValue("MerkleDistributor"));
        } else {
            merkleDistributor = new MerkleDistributor();
        }
    }
}
