// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {AddressSet, LibAddressSet} from "../helpers/AddressSet.sol";

contract LinkStakingHandler is Test {
    using LibAddressSet for AddressSet;

    address public admin;
    AddressSet internal _actors;
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

    function callSummary() external view {
        console.log("Call summary:");
        console.log("-------------------");
    }
}
