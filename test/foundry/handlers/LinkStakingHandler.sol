// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {AddressSet, LibAddressSet} from "../helpers/AddressSet.sol";
import {DelegatorPool} from "../../../contracts/core/DelegatorPool.sol";
import {StakingAllowance} from "../../../contracts/core/tokens/StakingAllowance.sol";

contract LinkStakingHandler is Test {
    using LibAddressSet for AddressSet;

    address public admin;
    AddressSet internal _actors;
    address internal currentActor;
    DelegatorPool public delegatorPool;
    StakingAllowance public sdlToken;

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

    constructor(address, _admin, DelegatorPool _delegatorPool, StakingAllowance _sdlToken) {
        admin = _admin;
        delegatorPool = _delegatorPool;
        sdlToken = _sdlToken;
    }

    function stakeSDL(uint256 seed, uint256 _amount) public createActor countCall("stakeSDL") {
        _amount = bound(_amount, 1, 1000);
        address caller = _actors.rand(seed);

        if (caller != address(0) && !_swappers.contains(caller)) {
            vm.prank(admin);

            vm.prank(caller);
            sdlToken.transferAndCall(address(delegatorPool), _amount * 1e18, "");
            _swappers.add(caller);
        }
    }

    function callSummary() external view {
        console.log("Call summary:");
        console.log("-------------------");
        console.log("stakeSDL", calls["stakeSDL"]);
    }
}
