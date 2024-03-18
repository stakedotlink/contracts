// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/ISequencerVault.sol";

/**
 * @title Sequencer VCS Mock
 * @notice Mocks contract for testing
 */
contract SequencerVCSMock {
    using SafeERC20 for IERC20;

    IERC20 public token;

    uint256 public operatorRewardPercentage;
    uint256 public withdrawalPercentage;

    ISequencerVault public vault;

    address public rewardRecipient;

    constructor(
        address _token,
        uint256 _operatorRewardPercentage,
        uint256 _withdrawalPercentage
    ) {
        token = IERC20(_token);
        operatorRewardPercentage = _operatorRewardPercentage;
        withdrawalPercentage = _withdrawalPercentage;
        rewardRecipient = address(9);
    }

    function deposit(uint256 _amount) external {
        token.transferFrom(msg.sender, address(this), _amount);
        vault.deposit(_amount);
    }

    function withdrawOperatorRewards(address _receiver, uint256 _amount) external returns (uint256) {
        uint256 withdrawalAmount = (_amount * withdrawalPercentage) / 10000;
        return withdrawalAmount;
    }

    function updateDeposits(uint256 _minRewards)
        external
        returns (
            uint256,
            uint256,
            uint256
        )
    {
        return vault.updateDeposits(_minRewards, 0);
    }

    function addVault(address _vault) external {
        vault = ISequencerVault(_vault);
        token.approve(_vault, type(uint256).max);
    }

    function setWithdrawalPercentage(uint256 _withdrawalPercentage) external {
        withdrawalPercentage = _withdrawalPercentage;
    }
}
