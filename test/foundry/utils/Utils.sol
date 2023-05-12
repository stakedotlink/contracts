// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script} from "forge-std/Script.sol";

contract Utils is Script {
    function updateDeployment(address newAddress, string memory key) internal {
        string memory inputDir = "test/foundry/input/";
        string memory chainDir = string.concat(vm.toString(block.chainid), "/config.json");
        string[] memory inputs = new string[](4);
        inputs[0] = "./update-config.sh";
        inputs[1] = string.concat(inputDir, chainDir);
        inputs[2] = key;
        inputs[3] = vm.toString(newAddress);

        vm.ffi(inputs);
    }

    function logger(string memory _log) internal {
        string memory inputDir = "test/logs/";
        string memory logDir = string.concat(vm.toString(block.timestamp), "data.log");
        string[] memory inputs = new string[](3);
        inputs[0] = "./logger.sh";
        inputs[1] = _log;
        inputs[2] = string.concat(inputDir, logDir);

        vm.ffi(inputs);
    }

    function getValue(string memory key) internal returns (address) {
        string memory inputDir = "test/foundry/input/";
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
        string memory inputDir = "test/foundry/input/";
        string memory chainDir = string.concat(vm.toString(block.chainid), "/config.json");
        string[] memory inputs = new string[](3);
        inputs[0] = "./get-value.sh";
        inputs[1] = string.concat(inputDir, chainDir);
        inputs[2] = key;

        bytes memory r = vm.ffi(inputs);

        return string(r);
    }
}
