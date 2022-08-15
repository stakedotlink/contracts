// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./base/StakingRewardsPool.sol";
import "./interfaces/ILendingPool.sol";
import "./interfaces/IStakingRewardsPool.sol";
import "./interfaces/IWrappedSDToken.sol";

/**
 * @title Borrowing Pool
 * @dev Allows users to borrow allowance tokens to stake in the defined StakingPool
 */
contract BorrowingPool is StakingRewardsPool, Ownable {
    using SafeERC20 for IERC20;

    ILendingPool public lendingPool;
    IStakingRewardsPool public stakingPool;
    IWrappedSDToken public wsdToken;

    address public baseToken;
    uint16 public poolIndex;
    uint public totalStaked;

    constructor(
        address _baseToken,
        uint16 _poolIndex,
        address _lendingPool,
        address _stakingPool,
        string memory _dTokenName,
        string memory _dTokenSymbol
    ) StakingRewardsPool(_stakingPool, _dTokenName, _dTokenSymbol) {
        baseToken = _baseToken;
        poolIndex = _poolIndex;
        lendingPool = ILendingPool(_lendingPool);
        stakingPool = IStakingRewardsPool(_stakingPool);
    }

    /**
     * @dev Initialises the contract, sets the wrapped derivative and transfers ownership to the lending pool.
     * This is needed to circumvent a circular dependency between LendingPool & BorrowingPool.
     */
    function init(address _wsdToken) external onlyOwner {
        require(address(wsdToken) == address(0), "Contract already initialised");
        wsdToken = IWrappedSDToken(_wsdToken);
        _approve(address(this), _wsdToken, type(uint256).max);
        transferOwnership(address(lendingPool));
    }

    /**
     * @dev Manually trigger a reward update. Reward update will query for the rewards earned in the
     * staking pool and distribute them between borrowers and lenders.
     */
    function updateRewards() external {
        int totalRewards = int(stakingPool.balanceOf(address(lendingPool))) - int(totalStaked);
        if (totalRewards != 0) {
            totalStaked = uint(int(totalStaked) + totalRewards);
        }
        if (totalRewards > 0) {
            uint currentRate = lendingPool.currentRate(baseToken, poolIndex);
            if (currentRate > 0) {
                uint lenderFee = (uint(totalRewards) * lendingPool.currentRate(baseToken, poolIndex)) / 10000;
                uint sharesToMint = (lenderFee * totalShares) / (totalStaked - lenderFee);
                _mintShares(address(this), sharesToMint);
                wsdToken.wrap(balanceOf(address(this)));
                wsdToken.transferAndCall(address(lendingPool), wsdToken.balanceOf(address(this)), "0x0");
            }
        }
    }

    /**
     * @notice registers the borrowed stake, minting the derivative token
     * @param _account the account to register the stake for
     * @param _amount the stake amount
     */
    function stake(address _account, uint _amount) external onlyOwner {
        _mint(_account, _amount);
        totalStaked += _amount;
    }

    /**
     * @notice unregisters the borrowed stake, burning the derivative token
     * @param _account the account to unregister the stake for
     * @param _amount the withdrawal amount
     */
    function withdraw(address _account, uint _amount) external onlyOwner {
        _burn(_account, _amount);
        totalStaked -= _amount;
    }

    /**
     * @notice returns the total amount of assets borrowed
     * @return total total stake borrowed
     */
    function _totalStaked() internal view override returns (uint) {
        return totalStaked;
    }
}
