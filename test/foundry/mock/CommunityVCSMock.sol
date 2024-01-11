// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

contract CommunityVCSMock {
    VaultMock[] public vaults;

    constructor(uint256 _totalVaults) {
        for (uint256 i = 0; i < _totalVaults; i++) {
            uint256 _total = (i + 1) * 1 ether;
            if (i > 2) {
                _total = 0;
            }
            vaults.push(new VaultMock(_total));
        }
    }

    function getVaults() external view returns (address[] memory) {
        address[] memory _vaults = new address[](vaults.length);
        for (uint256 i = 0; i < vaults.length; i++) {
            _vaults[i] = address(vaults[i]);
        }

        return _vaults;
    }

    function claimRewards(uint256 _startIndex, uint256 _numVaults, uint256 _minRewards) external {
        return;
    }
}

contract VaultMock {
    uint256 public holdings;

    constructor(uint256 _holdings) {
        holdings = _holdings;
    }

    function getRewards() external view returns (uint256) {
        return holdings;
    }
}
