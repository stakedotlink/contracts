// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;
import {StakingPool} from "../../../../contracts/core/StakingPool.sol";
import {PriorityPool} from "../../../../contracts/core/priorityPool/PriorityPool.sol";
import {CommunityVCS} from "../../../../contracts/linkStaking/CommunityVCS.sol";
import {CommunityVaultAutomation} from "../../../../contracts/linkStaking/CommunityVaultAutomation.sol";
import {BaseTest} from "../../Base.t.sol";

contract Deployment is BaseTest {
    bool internal _fork = true;
    StakingPool internal stakingPool;
    PriorityPool internal priorityPool;
    CommunityVCS internal communityVCS;
    CommunityVaultAutomation internal communityVaultAutomation;
    uint256 internal minRewardsTotal = 650 ether;
    uint256 internal minRewardsPerVault = 65 ether;
    address internal multisig;

    function setUp() public {
        BaseTest.init(_fork);
        communityVCS = CommunityVCS(getValue("CommunityVCS"));
        stakingPool = StakingPool(getValue("StakingPool"));
        priorityPool = PriorityPool(getValue("PriorityPool"));
        multisig = getValue("Multisig");
        vm.startPrank(multisig);
        communityVaultAutomation = new CommunityVaultAutomation(address(communityVCS), minRewardsTotal, minRewardsPerVault);

        // upgrade CommunityVCS
        CommunityVCS impl = new CommunityVCS();
        communityVCS.upgradeTo(address(impl));

        // upgrade StakingPool
        StakingPool stakingPoolImpl = new StakingPool();
        stakingPool.upgradeTo(address(stakingPoolImpl));

        // upgrade PriorityPool
        PriorityPool priorityPoolImpl = new PriorityPool();
        priorityPool.upgradeTo(address(priorityPoolImpl));
        vm.stopPrank();
    }

    function testFork_upgrade_successful() public {
        assertEq(address(communityVCS), address(getValue("CommunityVCS")));
        assertEq(address(stakingPool), getValue("StakingPool"));
        assertEq(address(priorityPool), getValue("PriorityPool"));
    }

    function testFork_CommunityVaultAutomation_success() public {
        assertEq(communityVaultAutomation.minRewardsTotal(), minRewardsTotal);
        assertEq(communityVaultAutomation.minRewardsPerVault(), minRewardsPerVault);
    }

    function testFork_StakingPool_owner() public {
        assertEq(stakingPool.priorityPool(), address(priorityPool));
    }

    function testFork_PriorityPool_owner() public {
        assertEq(address(priorityPool.stakingPool()), address(stakingPool));
    }
}
