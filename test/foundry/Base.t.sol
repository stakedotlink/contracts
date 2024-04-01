// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import {Test, console2} from "forge-std/Test.sol";
import {Users} from "./utils/Types.sol";
import {Utils} from "./utils/Utils.sol";

abstract contract BaseTest is Test, Utils {
    Users internal users;
    uint256 internal network;

    function init(bool _fork) public {
        if (_fork) {
            network = vm.createSelectFork(vm.rpcUrl("ethereum"));
        } else {
            //merkleDistributor = new MerkleDistributor();
        }
    }
}
