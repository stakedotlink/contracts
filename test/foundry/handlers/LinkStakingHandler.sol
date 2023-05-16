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

    address[] public ghost_userAddresses;
    uint256 public ghost_zeroWithdrawals;
    uint256 public ghost_withdrawSum;

    mapping(bytes32 => uint256) public calls;

    modifier createActor() {
        currentActor = msg.sender;
        _actors.add(msg.sender);
        _;
    }

    modifier useActor(uint256 actorIndexSeed) {
        currentActor = _actors.rand(actorIndexSeed);
        _;
    }

    modifier countCall(bytes32 key) {
        calls[key]++;
        _;
    }

    constructor(address _admin, DelegatorPool _delegatorPool, StakingAllowance _sdlToken) {
        admin = _admin;
        delegatorPool = _delegatorPool;
        sdlToken = _sdlToken;
    }

    function stakeSDL(uint256 seed, uint256 _amount) public createActor countCall("stakeSDL") {
        _amount = bound(_amount, 1, 100_000_000_000);
        address caller = _actors.rand(seed);

        if (caller != address(0)) {
            vm.prank(admin);
            sdlToken.mint(caller, _amount * 1e18);
            vm.prank(caller);
            sdlToken.transferAndCall(address(delegatorPool), _amount * 1e18, "");
            ghost_userAddresses.push(caller);
        }
    }

    function withdrawAllowance(uint256 actorSeed, uint256 _amount)
        public
        useActor(actorSeed)
        countCall("withdrawAllowance")
    {
        if (currentActor == address(0)) return;
        _amount = bound(_amount, 0, delegatorPool.balanceOf(currentActor));
        if (_amount == 0) ghost_zeroWithdrawals++;

        vm.prank(currentActor);
        delegatorPool.withdrawAllowance(_amount);

        ghost_withdrawSum += _amount;
    }

    function getUserAddresses() external view returns (address[] memory) {
        return ghost_userAddresses;
    }

    function forEachActor(function(address) external func) public {
        return _actors.forEach(func);
    }

    function callSummary() external view {
        console.log("Call summary:");
        console.log("-------------------");
        console.log("stakeSDL", calls["stakeSDL"]);
        console.log("withdrawAllowance", calls["withdrawAllowance"]);
        console.log("ghostWithdrawals", ghost_zeroWithdrawals);
    }
}
