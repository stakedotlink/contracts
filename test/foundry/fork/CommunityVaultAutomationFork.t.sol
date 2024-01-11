// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import {CommunityVaultAutomation} from "../../../contracts/linkStaking/CommunityVaultAutomation.sol";
import {CommunityVCS} from "../../../contracts/linkStaking/CommunityVCS.sol";
import {IVault} from "../../../contracts/linkStaking/CommunityVCS.sol";
import {BaseTest} from "../Base.t.sol";
import {ERC677} from "../../../contracts/core/tokens/base/ERC677.sol";

contract CommunityVaultAutomationForkTest is BaseTest {
    bool internal _fork = true;
    CommunityVaultAutomation internal communityVaultAutomation;

    function setUp() public {
        BaseTest.init(_fork);
        communityVaultAutomation = new CommunityVaultAutomation(getValue("CommunityVCS"), 0);
    }
}
