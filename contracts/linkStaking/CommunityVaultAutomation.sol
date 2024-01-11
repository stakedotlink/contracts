// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import {CommunityVCS} from "./CommunityVCS.sol";
import {IVault} from "./interfaces/IVault.sol";
import {AutomationCompatibleInterface} from "@chainlink/contracts/src/v0.8/interfaces/AutomationCompatibleInterface.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract CommunityVaultAutomation is AutomationCompatibleInterface, Ownable {
    CommunityVCS internal communityVCS;
    uint256 public minRewards;

    constructor(address _communityVCS, uint256 _minRewards) {
        communityVCS = CommunityVCS(_communityVCS);
        minRewards = _minRewards;
    }

    /**
     * @notice returns whether or not rewards is equal to or greater than the minimum rewards set
     * @return upkeepNeeded whether or not rewards should be claimed
     * @return performData abi encoded total claimable rewards and last index of vaults
     *
     */
    function checkUpkeep(bytes calldata) external returns (bool upkeepNeeded, bytes memory performData) {
        (uint256 _totalRewards, uint256 _lastIndex) = checkRewards();
        if (_totalRewards >= minRewards) {
            return (true, abi.encode(_totalRewards, _lastIndex));
        }
        return (false, abi.encode(_totalRewards, _lastIndex));
    }

    /**
     * @notice Claims rewards from vaults
     * @param performData abi encoded total claimable rewards and last index of vaults
     */
    function performUpkeep(bytes calldata performData) external {
        (uint256 _totalRewards, uint256 _lastIndex) = abi.decode(performData, (uint256, uint256));
        if (_totalRewards >= minRewards) {
            communityVCS.claimRewards(0, _lastIndex + 1, _totalRewards);
        }
    }

    /**
     * @notice Calculates total rewards from vaults and last index of vaults with rewards
     * @dev The last index is used to avoid iterating over all vaults when claiming rewards to save gas
     * @return (uint256, uint256) total rewards from vaults and last index of vaults with rewards
     */
    function checkRewards() public view returns (uint256, uint256) {
        IVault[] memory vaults = communityVCS.getVaults();
        uint256 _totalRewards = 0;
        uint256 _lastIndex = 0;
        for (uint256 i = 0; i < vaults.length; i++) {
            IVault vault = IVault(vaults[i]);
            uint256 _rewards = vault.getRewards();
            if (_rewards > 0) {
                _totalRewards += _rewards;
                _lastIndex = i;
            }
        }
        return (_totalRewards, _lastIndex);
    }

    function setCommunityVCS(address _communityVCS) external onlyOwner {
        communityVCS = CommunityVCS(_communityVCS);
    }

    function setMinRewards(uint256 _minRewards) external onlyOwner {
        minRewards = _minRewards;
    }
}
