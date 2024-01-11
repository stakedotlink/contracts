// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import {CommunityVaultAutomation} from "../../../contracts/linkStaking/CommunityVaultAutomation.sol";
import {CommunityVCS} from "../../../contracts/linkStaking/CommunityVCS.sol";
import {IVault} from "../../../contracts/linkStaking/CommunityVCS.sol";
import {BaseTest} from "../Base.t.sol";
import {ERC677} from "../../../contracts/core/tokens/base/ERC677.sol";
import {CommunityVCSMock} from "../mock/CommunityVCSMock.sol";

contract CommunityVaultAutomationTest is BaseTest {
    bool internal _fork = false;
    CommunityVaultAutomation internal communityVaultAutomation;
    CommunityVCSMock internal communityVCSMock;

    function setUp() public {
        BaseTest.init(_fork);
        communityVCSMock = new CommunityVCSMock(5);
        communityVaultAutomation = new CommunityVaultAutomation(address(communityVCSMock), 0);
    }

    function test_performUpkeep_success() public {
        (bool upkeepNeeded, bytes memory performData) = communityVaultAutomation.checkUpkeep("");
        assertEq(upkeepNeeded, true);
        (uint256 _totalRewards, uint256 _lastIndex) = abi.decode(performData, (uint256, uint256));
        assertTrue(_totalRewards > 0);
        assertTrue(_lastIndex == 2);
        communityVaultAutomation.performUpkeep(performData);
    }
}
