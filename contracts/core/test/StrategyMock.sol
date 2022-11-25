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

    uint private maxDeposits;
    uint private minDeposits;

    uint private totalDeposits;
    uint public feeBasisPoints;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _token,
        address _stakingPool,
        uint _maxDeposits,
        uint _minDeposits
    ) public initializer {
        __Strategy_init(_token, _stakingPool);
        feeBasisPoints = 0;
        maxDeposits = _maxDeposits;
        minDeposits = _minDeposits;
    }

    // should return the change in deposits since updateRewards was last called (can be positive or negative)
    function depositChange() public view returns (int) {
        return int(token.balanceOf(address(this))) - int(totalDeposits);
    }

    function deposit(uint256 _amount) external onlyStakingPool {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        totalDeposits += _amount;
        // Deposit into earning protocol/node
    }

    function withdraw(uint256 _amount) external onlyStakingPool {
        require(_amount <= canWithdraw(), "Total deposits must remain >= minimum");
        totalDeposits -= _amount;
        //Withdraw from earning protocol/node
        token.safeTransfer(msg.sender, _amount);
    }

    function updateDeposits() external onlyStakingPool returns (address[] memory receivers, uint[] memory amounts) {
        int256 balanceChange = depositChange();
        if (balanceChange > 0) {
            totalDeposits += uint(balanceChange);
            if (feeBasisPoints > 0) {
                receivers = new address[](1);
                amounts = new uint[](1);
                receivers[0] = owner();
                amounts[0] = (feeBasisPoints * uint(balanceChange)) / 10000;
            }
        } else if (balanceChange < 0) {
            totalDeposits -= uint(balanceChange * -1);
        }
    }

    function setFeeBasisPoints(uint _feeBasisPoints) external {
        feeBasisPoints = _feeBasisPoints;
    }

    function simulateSlash(uint _amount) external {
        token.safeTransfer(msg.sender, _amount);
    }

    function getTotalDeposits() public view override returns (uint) {
        return totalDeposits;
    }

    function getMaxDeposits() public view override returns (uint) {
        return maxDeposits;
    }

    function getMinDeposits() public view override returns (uint) {
        return minDeposits;
    }

    function setMaxDeposits(uint256 _maxDeposits) external onlyOwner {
        maxDeposits = _maxDeposits;
    }

    function setMinDeposits(uint256 _minDeposits) external onlyOwner {
        minDeposits = _minDeposits;
    }

    function createRewardsPool(address _token) public {
        RewardsPool rewardsPool = new RewardsPool(address(stakingPool), _token);
        IRewardsPoolController rewardsPoolController = IRewardsPoolController(address(stakingPool));
        rewardsPoolController.addToken(_token, address(rewardsPool));
    }
}
