// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

contract StakingAdapterMock {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    address public vault;
    IERC20Upgradeable public token;
    uint256 public totalDeposits;
    uint256 public rewardsAvailable;
    uint256 public unstakeableAmount;
    bool public unbonded;
    bool public exitInitiated;
    bool public exitFinalized;

    constructor(address _vault, address _token) {
        vault = _vault;
        token = IERC20Upgradeable(_token);
    }

    function stake(uint256 _amount) external {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        totalDeposits += _amount;
    }

    function unstake(uint256 _amount) external {
        totalDeposits -= _amount;
        token.safeTransfer(vault, _amount);
    }

    function unbond() external {
        unbonded = true;
    }

    function claimRewards() external returns (uint256) {
        uint256 rewards = rewardsAvailable;
        if (rewards > 0) {
            rewardsAvailable = 0;
            token.safeTransfer(vault, rewards);
        }
        return rewards;
    }

    function initiateExit() external {
        exitInitiated = true;
    }

    function finalizeExit() external returns (uint256) {
        uint256 recovered = totalDeposits + rewardsAvailable;
        totalDeposits = 0;
        rewardsAvailable = 0;
        exitFinalized = true;
        if (recovered > 0) {
            token.safeTransfer(vault, recovered);
        }
        return recovered;
    }

    function getTotalDeposits() external view returns (uint256) {
        return totalDeposits;
    }

    function canStake() external pure returns (uint256) {
        return type(uint256).max;
    }

    function canUnstake() external view returns (uint256) {
        return unstakeableAmount;
    }

    // --- Test setters ---

    function setRewards(uint256 _rewards) external {
        rewardsAvailable = _rewards;
    }

    function setUnstakeableAmount(uint256 _amount) external {
        unstakeableAmount = _amount;
    }

    function setTotalDeposits(uint256 _amount) external {
        totalDeposits = _amount;
    }
}
