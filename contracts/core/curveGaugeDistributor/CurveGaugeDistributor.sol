// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/ICurvePoolNG.sol";
import "../interfaces/ILiquidityGaugeV6.sol";

/**
 * @title Curve Gauge Distributor
 * @notice Receives and distributes LST rewards to a Curve Gauge
 */
contract CurveGaugeDistributor is Ownable {
    using SafeERC20 for IERC20;

    // address of LST (wrapped or not)
    address public lst;
    // address of curve NG pool
    ICurvePoolNG public curvePoolNG;
    // address of curve gauge for pool
    ILiquidityGaugeV6 public liquidityGaugeV6;

    // address authorized to distribute gauge rewards
    address public rewardsDistributor;

    // duration of reward epoch in seconds
    uint64 public epochDuration;
    // index of lst in curve pool
    uint64 public poolTokenIndex;

    error SenderNotAuthorized();
    error NoRewards();

    /**
     * @notice Initializes the contract
     * @param _lst address of LST (wrapped or not)
     * @param _curvePoolNG address of curve NG pool
     * @param _liquidityGaugeV6 address of curve gauge for pool
     * @param _rewardsDistributor address authorized to distribute gauge rewards
     * @param _epochDuration duration of reward epoch in seconds
     * @param _poolTokenIndex index of lst in curve pool
     */
    constructor(
        address _lst,
        address _curvePoolNG,
        address _liquidityGaugeV6,
        address _rewardsDistributor,
        uint64 _epochDuration,
        uint64 _poolTokenIndex
    ) {
        lst = _lst;
        curvePoolNG = ICurvePoolNG(_curvePoolNG);
        liquidityGaugeV6 = ILiquidityGaugeV6(_liquidityGaugeV6);
        rewardsDistributor = _rewardsDistributor;
        epochDuration = _epochDuration;
        poolTokenIndex = _poolTokenIndex;

        IERC20(_lst).safeApprove(_curvePoolNG, type(uint256).max);
        IERC20(_curvePoolNG).safeApprove(_liquidityGaugeV6, type(uint256).max);
    }

    /**
     * @notice Reverts if sender is not rewards distributor
     */
    modifier onlyRewardsDistributor() {
        if (msg.sender != rewardsDistributor) revert SenderNotAuthorized();
        _;
    }

    /**
     * @notice Receives transfers of LST rewards from staking pool
     */
    function onTokenTransfer(address, uint256, bytes calldata) external {}

    /**
     * @notice Returns the expected amount of LP tokens to be minted when rewards are distributed
     * @return expected LP tokens to be minted
     */
    function getLPTokenAmount() external view returns (uint256) {
        uint256 balance = IERC20(lst).balanceOf(address(this));
        if (balance == 0) return 0;

        uint256[] memory amounts = new uint256[](2);
        amounts[poolTokenIndex] = balance;

        uint256 minMintAmount = curvePoolNG.calc_token_amount(amounts, true);
        return minMintAmount;
    }

    /**
     * @notice Distributes rewards
     * @param _minMintAmount minimum LP tokens to be minted when rewards are distributed
     */
    function distributeRewards(uint256 _minMintAmount) external onlyRewardsDistributor {
        uint256 balance = IERC20(lst).balanceOf(address(this));
        if (balance == 0) revert NoRewards();

        uint256[] memory amounts = new uint256[](2);
        amounts[poolTokenIndex] = balance;

        uint256 mintAmount = curvePoolNG.add_liquidity(amounts, _minMintAmount, address(this));
        liquidityGaugeV6.deposit_reward_token(address(curvePoolNG), mintAmount, epochDuration);
    }

    /**
     * @notice Sets the reward epoch duration
     * @param _epochDuration reward epoch duration in seconds
     */
    function setEpochDuration(uint64 _epochDuration) external onlyOwner {
        epochDuration = _epochDuration;
    }

    /**
     * @notice Sets the address authorized to distribute rewards
     * @param _rewardsDistributor distributor address
     */
    function setRewardsDistributor(address _rewardsDistributor) external onlyOwner {
        rewardsDistributor = _rewardsDistributor;
    }
}
