// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../base/Strategy.sol";
import "../RewardsPool.sol";

/**
 * @title Strategy Mock
 * @notice Mocks contract for testing
 */
contract StrategyMock is Strategy {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    uint private depositMax;
    uint private depositMin;

    uint private totalDeposited;
    uint public feeBasisPoints;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _token,
        address _stakingPool,
        uint _depositMax,
        uint _depositMin
    ) public initializer {
        __Strategy_init(_token, _stakingPool);
        feeBasisPoints = 0;
        depositMax = _depositMax;
        depositMin = _depositMin;
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

    function maxDeposits() public view override returns (uint) {
        return depositMax;
    }

    function minDeposits() public view override returns (uint) {
        return depositMin;
    }

    function setDepositMax(uint256 _depositMax) external onlyOwner {
        depositMax = _depositMax;
    }

    function setDepositMin(uint256 _depositMin) external onlyOwner {
        depositMin = _depositMin;
    }

    function createRewardsPool(address _token) public {
        RewardsPool rewardsPool = new RewardsPool(address(stakingPool), _token);
        IRewardsPoolController rewardsPoolController = IRewardsPoolController(address(stakingPool));
        rewardsPoolController.addToken(_token, address(rewardsPool));
    }
}
