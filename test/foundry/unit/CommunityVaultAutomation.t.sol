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
        communityVaultAutomation = new CommunityVaultAutomation(address(communityVCSMock), 0, 1);
    }

    function test_performUpkeep_success() public {
        uint256[4] memory _vaultsReference = [uint256(0), 1, 2, 4];
        (bool upkeepNeeded, bytes memory performData) = communityVaultAutomation.checkUpkeep("");
        assertEq(upkeepNeeded, true);
        uint256[] memory _vaults = abi.decode(performData, (uint256[]));
        assertTrue(_vaults.length == 4);
        for (uint256 i = 0; i < _vaultsReference.length; i++) {
            assertTrue(_vaults[i] == _vaultsReference[i]);
        }
        communityVaultAutomation.performUpkeep(performData);
    }
}
