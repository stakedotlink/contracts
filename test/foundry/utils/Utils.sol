// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import {Script} from "forge-std/Script.sol";

contract Utils is Script {
    function updateDeployment(address newAddress, string memory key) internal {
        string memory inputDir = "script/input/";
        string memory chainDir = string.concat(vm.toString(block.chainid), "/config.json");
        string[] memory inputs = new string[](4);
        inputs[0] = "./update-config.sh";
        inputs[1] = string.concat(inputDir, chainDir);
        inputs[2] = key;
        inputs[3] = vm.toString(newAddress);

        vm.ffi(inputs);
    }

    function getValue(string memory key) internal returns (address) {
        string memory inputDir = "script/input/";
        string memory chainDir = string.concat(vm.toString(block.chainid), "/config.json");
        string[] memory inputs = new string[](3);
        inputs[0] = "./get-value.sh";
        inputs[1] = string.concat(inputDir, chainDir);
        inputs[2] = key;

        bytes memory r = vm.ffi(inputs);
        address addr;
        assembly {
            addr := mload(add(r, 20))
        }
        return addr;
    }

    function getStringValue(string memory key) internal returns (string memory) {
        string memory inputDir = "script/input/";
        string memory chainDir = string.concat(vm.toString(block.chainid), "/config.json");
        string[] memory inputs = new string[](3);
        inputs[0] = "./get-value.sh";
        inputs[1] = string.concat(inputDir, chainDir);
        inputs[2] = key;

        bytes memory r = vm.ffi(inputs);

        return string(r);
    }
}
