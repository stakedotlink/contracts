// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import {Test, console2} from "forge-std/Test.sol";
import {AddressSet, LibAddressSet} from "../helpers/AddressSet.sol";

contract Handler is Test {
    using LibAddressSet for AddressSet;

    AddressSet internal _actors;
    address internal admin;
    address internal currentActor;

    mapping(bytes32 => uint256) public calls;


    modifier createActor() {
        currentActor = msg.sender;
        _actors.add(msg.sender);
        _;
    }

    modifier countCall(bytes32 key) {
        calls[key]++;
        _;
    }

    constructor() {
    }

    

    function callSummary() external view {
        console2.log("Call summary:");
        console2.log("-------------------");

    }
}
