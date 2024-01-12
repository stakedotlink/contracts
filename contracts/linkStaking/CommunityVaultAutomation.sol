// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import {CommunityVCS} from "./CommunityVCS.sol";
import {IVault} from "./interfaces/IVault.sol";
import {AutomationCompatibleInterface} from "@chainlink/contracts/src/v0.8/interfaces/AutomationCompatibleInterface.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract CommunityVaultAutomation is AutomationCompatibleInterface, Ownable {
    CommunityVCS internal communityVCS;
    uint256 public minRewardsTotal;
    uint256 public minRewardsPerVault;

    constructor(address _communityVCS, uint256 _minRewardsTotal, uint256 _minRewardsPerVault) {
        communityVCS = CommunityVCS(_communityVCS);
        minRewardsTotal = _minRewardsTotal;
        minRewardsPerVault = _minRewardsPerVault;
    }

    /**
     * @notice returns whether or not rewards is equal to or greater than the minimum rewards set
     * @return upkeepNeeded whether or not rewards should be claimed
     * @return performData abi encoded total claimable rewards and list of vault indexes to claim from
     *
     */
    function checkUpkeep(bytes calldata) external returns (bool upkeepNeeded, bytes memory performData) {
        (uint256 _totalRewards, uint256[] memory _vaults) = checkRewards();
        if (_totalRewards >= minRewardsTotal) {
            return (true, abi.encode(_totalRewards, _vaults));
        }
        return (false, abi.encode(_totalRewards, _vaults));
    }

    /**
     * @notice Claims rewards from vaults
     * @param performData abi encoded total claimable rewards and list of vault indexes to claim from
     */
    function performUpkeep(bytes calldata performData) external {
        (uint256 _totalRewards, uint256[] memory _vaults) = abi.decode(performData, (uint256, uint256[]));
        if (_totalRewards >= minRewardsTotal) {
            communityVCS.claimRewards(_vaults, minRewardsPerVault);
        }
    }

    /**
     * @notice Calculates total rewards from vaults and last index of vaults with rewards
     * @dev The last index is used to avoid iterating over all vaults when claiming rewards to save gas
     * @return (uint256, uint256[]) total rewards from vaults and list of vault indexes that meet the minimum rewards
     */
    function checkRewards() public view returns (uint256, uint256[] memory) {
        IVault[] memory vaults = communityVCS.getVaults();
        uint256 _totalRewards = 0;

        uint256 maxVaults = vaults.length;
        uint256[] memory _vaultsToClaim = new uint256[](maxVaults);
        uint256 count = 0;

        for (uint256 i = 0; i < vaults.length; i++) {
            IVault vault = IVault(vaults[i]);
            uint256 _rewards = vault.getRewards();
            if (_rewards > minRewardsPerVault) {
                _totalRewards += _rewards;
                if (count < maxVaults) {
                    _vaultsToClaim[count] = i;
                    count++;
                }
            }
        }
        uint256[] memory _finalVaultsToClaim = new uint256[](count);
        for (uint256 j = 0; j < count; j++) {
            _finalVaultsToClaim[j] = _vaultsToClaim[j];
        }

        return (_totalRewards, _finalVaultsToClaim);
    }

    function setCommunityVCS(address _communityVCS) external onlyOwner {
        communityVCS = CommunityVCS(_communityVCS);
    }

    function setMinRewardsTotal(uint256 _minRewards) external onlyOwner {
        minRewardsTotal = _minRewards;
    }

    function setMinRewardsPerVault(uint256 _minRewards) external onlyOwner {
        minRewardsPerVault = _minRewards;
    }
}
