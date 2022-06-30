// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../base/Strategy.sol";

/**
 * @title Strategy Mock
 * @notice Mocks contract for testing
 */
contract StrategyMock is Strategy {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    uint private totalDeposited;
    uint public feeBasisPoints;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _token,
        address _stakingPool,
        uint _depositsMax,
        uint _depositsMin
    ) public initializer {
        __Strategy_init(_token, _stakingPool, _depositsMax, _depositsMin);
        feeBasisPoints = 0;
    }

    // should return the change in deposits since updateRewards was last called (can be positive or negative)
    function depositChange() public view returns (int) {
        return int(token.balanceOf(address(this))) - int(totalDeposited);
    }

    function deposit(uint256 _amount) external onlyStakingPool {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        totalDeposited += _amount;
        // Deposit into earning protocol/node
    }

    function withdraw(uint256 _amount) external onlyStakingPool {
        require(_amount <= canWithdraw(), "Total deposits must remain >= minimum");
        totalDeposited -= _amount;
        //Withdraw from earning protocol/node
        token.safeTransfer(msg.sender, _amount);
    }

    function updateDeposits() external onlyStakingPool returns (address[] memory receivers, uint[] memory amounts) {
        int256 balanceChange = depositChange();
        if (balanceChange > 0) {
            totalDeposited += uint(balanceChange);
            if (feeBasisPoints > 0) {
                receivers = new address[](1);
                amounts = new uint[](1);
                receivers[0] = owner();
                amounts[0] = (feeBasisPoints * uint(balanceChange)) / 10000;
            }
        } else if (balanceChange < 0) {
            totalDeposited -= uint(balanceChange * -1);
        }
    }

    function setFeeBasisPoints(uint _feeBasisPoints) external {
        feeBasisPoints = _feeBasisPoints;
    }

    function simulateSlash(uint _amount) external {
        token.safeTransfer(msg.sender, _amount);
    }

    function totalDeposits() public view override returns (uint) {
        return totalDeposited;
    }
}
