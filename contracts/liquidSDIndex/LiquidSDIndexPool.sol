// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";

import "../core/base/StakingRewardsPool.sol";
import "./interfaces/ILiquidSDAdapter.sol";

/**
 * @title Liquid Staking Derivative Index Pool
 * @notice Issues a liquid staking derivative token that's backed by a basket of individual
 * liquid staking derivative tokens
 */
contract LiquidSDIndexPool is StakingRewardsPool {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct Fee {
        address receiver;
        uint256 basisPoints;
    }

    address[] private lsdTokens;
    mapping(address => ILiquidSDAdapter) public lsdAdapters;

    mapping(address => uint256) private compositionTargets;
    uint256 public compositionTolerance;
    uint256 public compositionEnforcementThreshold;

    Fee[] private fees;
    uint256 public withdrawalFee;

    uint256 private totalDeposits;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory _derivativeTokenName,
        string memory _derivativeTokenSymbol,
        uint256 _compositionTolerance,
        uint256 _compositionEnforcementThreshold,
        Fee[] memory _fees,
        uint256 _withdrawalFee
    ) public initializer {
        __StakingRewardsPool_init(address(0), _derivativeTokenName, _derivativeTokenSymbol);
        compositionTolerance = _compositionTolerance;
        compositionEnforcementThreshold = _compositionEnforcementThreshold;
        for (uint256 i = 0; i < _fees.length; i++) {
            fees.push(_fees[i]);
        }
        require(_totalFeesBasisPoints() <= 5000, "Total fees must be <= 50%");
        require(_withdrawalFee <= 500, "Withdrawal fee must be <= 5%");
        withdrawalFee = _withdrawalFee;
    }

    modifier tokenIsSupported(address _lsdToken) {
        require(address(lsdAdapters[_lsdToken]) != address(0), "Token is not supported");
        _;
    }

    /**
     * @notice returns a list of all supported lsd tokens
     * @return list of strategies
     */
    function getLSDTokens() external view returns (address[] memory) {
        return lsdTokens;
    }

    /**
     * @notice returns a list of all fees
     * @return list of fees
     */
    function getFees() external view returns (Fee[] memory) {
        return fees;
    }

    /**
     * @notice returns a list of basis point composition targets for each lsd
     * @return list of composition targets
     */
    function getCompositionTargets() external view returns (uint256[] memory) {
        uint256[] memory targets = new uint256[](lsdTokens.length);
        for (uint256 i = 0; i < lsdTokens.length; i++) {
            targets[i] = compositionTargets[lsdTokens[i]];
        }
        return targets;
    }

    /**
     * @notice returns the current basis point composition of deposits
     * @return list of compositions for each lsd
     */
    function getComposition() external view returns (uint256[] memory) {
        uint256 depositsTotal = _totalDeposits();

        uint256[] memory composition = new uint256[](lsdTokens.length);

        for (uint256 i = 0; i < composition.length; i++) {
            uint256 deposits = lsdAdapters[lsdTokens[i]].getTotalDeposits();
            composition[i] = (deposits * 10000) / depositsTotal;
        }

        return composition;
    }

    /**
     * @notice returns the deposit room for an lsd token
     * @param _lsdToken address of token
     * @return deposit room for token
     **/
    function getDepositRoom(address _lsdToken) public view tokenIsSupported(_lsdToken) returns (uint256) {
        uint256 depositLimit = type(uint256).max;
        uint256 depositsTotal;

        if (compositionTargets[_lsdToken] == 0) return 0;

        for (uint256 i = 0; i < lsdTokens.length; i++) {
            address lsdToken = lsdTokens[i];

            uint256 deposits = lsdAdapters[lsdToken].getTotalDeposits();
            depositsTotal += deposits;

            if (lsdToken == _lsdToken) continue;

            uint256 compositionTarget = compositionTargets[lsdToken];
            if (compositionTarget == 0) continue;

            // check how much can be deposited before the decrease in composition percentage exceeds the composition tolerance
            uint256 minComposition = compositionTarget - (compositionTarget * compositionTolerance) / 10000;
            depositLimit = MathUpgradeable.min((deposits * 10000) / minComposition, depositLimit);
        }

        uint256 compositionTarget = compositionTargets[_lsdToken];
        uint256 deposits = lsdAdapters[_lsdToken].getTotalDeposits();

        // check how much can be deposited before the increase in composition percentage exceeds the composition tolerance
        uint256 maxComposition = compositionTarget + (compositionTarget * compositionTolerance) / 10000;
        if (maxComposition < 10000) {
            depositLimit = MathUpgradeable.min(
                ((depositsTotal - deposits) * 10000) / (10000 - maxComposition),
                depositLimit
            );
        }

        // check if deposits are below the composition enforcement threshold and if so, use deposit room if it's greater
        // than the amount that could be deposited with enforcement of composition targets
        uint256 minThreshold = (compositionEnforcementThreshold * compositionTarget) / 10000;
        if (deposits < minThreshold) {
            uint256 thresholdDiff = minThreshold - deposits;
            depositLimit = MathUpgradeable.max(depositsTotal + thresholdDiff, depositLimit);
        }

        return depositLimit > depositsTotal ? depositLimit - depositsTotal : 0;
    }

    /**
     * @notice deposits lsd tokens and mints lsd index tokens
     * @param _lsdToken token to deposit
     * @param _amount amount to deposit
     **/
    function deposit(address _lsdToken, uint256 _amount) external tokenIsSupported(_lsdToken) {
        require(getDepositRoom(_lsdToken) >= _amount, "Insufficient deposit room for the selected lsd");

        ILiquidSDAdapter lsdAdapter = lsdAdapters[_lsdToken];
        IERC20Upgradeable(_lsdToken).safeTransferFrom(msg.sender, address(lsdAdapter), _amount);

        uint256 underlyingAmount = lsdAdapter.getUnderlyingByLSD(_amount);
        _mint(msg.sender, underlyingAmount);
        totalDeposits += underlyingAmount;
    }

    /**
     * @notice returns the amount of each lsd a withdrawer will receive for an amount of index tokens
     * @dev sender receives an amount of each lsd proportional to the size of the deposit gap
     * between each lsd's pre-withdrawal composition and its post-withdrawal target composition
     * (as a result, the current composition will move closer to the target after each withdrawal)
     * @param _amount amount to withdraw
     * @return list of lsd amounts
     **/
    function getWithdrawalAmounts(uint256 _amount) public view returns (uint256[] memory) {
        uint256[] memory withdrawalAmounts = new uint256[](lsdTokens.length);
        uint256[] memory targetDepositDiffs = new uint256[](lsdTokens.length);
        uint256 amount = _amount - _getWithdrawalFeeAmount(_amount);
        uint256 newDepositsTotal = _totalDeposits() - _amount;
        uint256 totalTargetDepositDiffs;

        for (uint256 i = 0; i < targetDepositDiffs.length; i++) {
            uint256 newTargetDeposits = (newDepositsTotal * compositionTargets[lsdTokens[i]]) / 10000;
            uint256 currentDeposits = lsdAdapters[lsdTokens[i]].getTotalDeposits();
            int256 targetDepositDiff = int256(currentDeposits) - int256(newTargetDeposits);

            if (targetDepositDiff > 0) {
                targetDepositDiffs[i] = uint256(targetDepositDiff);
                totalTargetDepositDiffs += uint256(targetDepositDiff);
            }
        }

        for (uint256 i = 0; i < targetDepositDiffs.length; i++) {
            uint256 targetDepositDiff = targetDepositDiffs[i];

            if (targetDepositDiff > 0) {
                ILiquidSDAdapter lsdAdapter = lsdAdapters[lsdTokens[i]];
                uint256 withdrawalAmount = lsdAdapter.getLSDByUnderlying(
                    (amount * ((targetDepositDiff * 1e18) / totalTargetDepositDiffs)) / 1e18
                );
                withdrawalAmounts[i] = withdrawalAmount;
            }
        }

        return withdrawalAmounts;
    }

    /**
     * @notice withdraws lsd tokens and burns lsd index tokens
     * @param _amount amount to withdraw
     **/
    function withdraw(uint256 _amount) external {
        _burn(msg.sender, _amount);
        totalDeposits -= _amount - _getWithdrawalFeeAmount(_amount);

        uint256[] memory withdrawalAmounts = getWithdrawalAmounts(_amount);

        for (uint256 i = 0; i < withdrawalAmounts.length; i++) {
            uint256 amount = withdrawalAmounts[i];
            if (amount > 0) {
                IERC20Upgradeable(lsdTokens[i]).safeTransferFrom(address(lsdAdapters[lsdTokens[i]]), msg.sender, amount);
            }
        }
    }

    /**
     * @notice returns the amount of rewards earned since the last update and the amount of fees that
     * will be paid on the rewards
     * @return total rewards
     * @return total fees
     **/
    function getRewards() external view returns (int256, uint256) {
        int256 totalRewards = int256(_totalDeposits()) - int256(totalDeposits);
        uint256 totalFees;

        if (totalRewards > 0) {
            for (uint256 i = 0; i < fees.length; i++) {
                totalFees += (uint256(totalRewards) * fees[i].basisPoints) / 10000;
            }
        }

        return (totalRewards, totalFees);
    }

    /**
     * @notice updates and distributes rewards based on balance changes in adapters
     **/
    function updateRewards() external {
        uint256 currentTotalDeposits;

        for (uint256 i = 0; i < lsdTokens.length; i++) {
            currentTotalDeposits += lsdAdapters[lsdTokens[i]].getTotalDeposits();
        }

        int256 totalRewards = int256(currentTotalDeposits) - int256(totalDeposits);

        if (totalRewards != 0) {
            totalDeposits = uint256(int256(totalDeposits) + totalRewards);
        }

        if (totalRewards > 0) {
            uint256[] memory feeAmounts = new uint256[](fees.length);
            uint256 totalFeeAmounts;

            for (uint256 i = 0; i < fees.length; i++) {
                feeAmounts[i] = (uint256(totalRewards) * fees[i].basisPoints) / 10000;
                totalFeeAmounts += feeAmounts[i];
            }

            if (totalFeeAmounts > 0) {
                uint256 sharesToMint = (totalFeeAmounts * totalShares) / (totalDeposits - totalFeeAmounts);
                _mintShares(address(this), sharesToMint);

                for (uint256 i = 0; i < fees.length; i++) {
                    if (i == fees.length - 1) {
                        transferAndCallFrom(address(this), fees[i].receiver, balanceOf(address(this)), "0x00");
                    } else {
                        transferAndCallFrom(address(this), fees[i].receiver, feeAmounts[i], "0x00");
                    }
                }
            }
        }
    }

    /**
     * @notice adds a new liquid staking derivative token
     * @param _lsdToken address of token
     * @param _lsdAdapter address of token adapter
     * @param _compositionTargets basis point composition targets for each lsd
     **/
    function addLSDToken(
        address _lsdToken,
        address _lsdAdapter,
        uint256[] calldata _compositionTargets
    ) external onlyOwner {
        require(address(lsdAdapters[_lsdToken]) == address(0), "Token is already supported");
        require(_compositionTargets.length == lsdTokens.length + 1, "Invalid composition targets length");

        lsdTokens.push(_lsdToken);
        lsdAdapters[_lsdToken] = ILiquidSDAdapter(_lsdAdapter);

        uint256 totalComposition;
        for (uint256 i = 0; i < _compositionTargets.length; i++) {
            compositionTargets[lsdTokens[i]] = _compositionTargets[i];
            totalComposition += _compositionTargets[i];
        }

        require(totalComposition == 10000, "Composition targets must sum to 100%");
    }

    /**
     * @notice removes a liquid staking derivative token
     * @param _lsdToken address of token
     * @param _compositionTargets basis point composition targets for each remaining lsd
     **/
    function removeLSDToken(address _lsdToken, uint256[] calldata _compositionTargets)
        external
        onlyOwner
        tokenIsSupported(_lsdToken)
    {
        require(_compositionTargets.length == lsdTokens.length - 1, "Invalid composition targets length");
        require(lsdAdapters[_lsdToken].getTotalDeposits() < 1 ether, "Cannot remove adapter that contains deposits");

        uint256 index;
        for (uint256 i = 0; i < lsdTokens.length; i++) {
            if (lsdTokens[i] == _lsdToken) {
                index = i;
                break;
            }
        }

        for (uint256 i = index; i < lsdTokens.length - 1; i++) {
            lsdTokens[i] = lsdTokens[i + 1];
        }

        lsdTokens.pop();
        delete lsdAdapters[_lsdToken];

        uint256 totalComposition;
        for (uint256 i = 0; i < _compositionTargets.length; i++) {
            compositionTargets[lsdTokens[i]] = _compositionTargets[i];
            totalComposition += _compositionTargets[i];
        }

        require(totalComposition == 10000, "Composition targets must sum to 100%");
    }

    /**
     * @notice sets composition targets
     * @param _compositionTargets list of basis point composition targets
     **/
    function setCompositionTargets(uint256[] memory _compositionTargets) external onlyOwner {
        require(_compositionTargets.length == lsdTokens.length, "Invalid composition targets length");

        uint256 totalComposition;
        for (uint256 i = 0; i < _compositionTargets.length; i++) {
            compositionTargets[lsdTokens[i]] = _compositionTargets[i];
            totalComposition += _compositionTargets[i];
        }

        require(totalComposition == 10000, "Composition targets must sum to 100%");
    }

    /**
     * @notice sets composition tolerance
     * @dev the composition tolerance is the percentage swing that any lsd can have from its
     * composition target in either direction (if the composition tolerance was 50% and an lsd had a
     * composition target of 30%, then its minimum composition of the pool is 15% of deposits and its maximum is 45%)
     * @param _compositionTolerance basis point composition tolerance
     **/
    function setCompositionTolerance(uint256 _compositionTolerance) external onlyOwner {
        require(_compositionTolerance < 10000, "Composition tolerance must be < 100%");
        compositionTolerance = _compositionTolerance;
    }

    /**
     * @notice sets composition enforcement threshold
     * @dev the composition enforcement threshold is the total amount of deposits required for composition
     * targets to be enforced (if the threshold was 10000 and the targets for 2 lsds were 70% and 30%, up to
     * 7000 of the first lsd could be deposited even if there were no deposits of the second lsd but after 7000 is
     * reached, enough of the second lsd would have to be deposited to open up more room for the first lsd)
     * @param _compositionEnforcementThreshold threshold total deposit amount
     **/
    function setCompositionEnforcementThreshold(uint256 _compositionEnforcementThreshold) external onlyOwner {
        compositionEnforcementThreshold = _compositionEnforcementThreshold;
    }

    /**
     * @notice sets the withdrawal fee
     * @param _withdrawalFee fee in basis points
     **/
    function setWithdrawalFee(uint256 _withdrawalFee) external onlyOwner {
        require(_withdrawalFee <= 500, "Withdrawal fee must be <= 5%");
        withdrawalFee = _withdrawalFee;
    }

    /**
     * @notice adds a new fee
     * @param _receiver receiver of fee
     * @param _feeBasisPoints fee in basis points
     **/
    function addFee(address _receiver, uint256 _feeBasisPoints) external onlyOwner {
        fees.push(Fee(_receiver, _feeBasisPoints));
        require(_totalFeesBasisPoints() <= 5000, "Total fees must be <= 50%");
    }

    /**
     * @notice updates an existing fee
     * @param _index index of fee
     * @param _receiver receiver of fee
     * @param _feeBasisPoints fee in basis points
     **/
    function updateFee(
        uint256 _index,
        address _receiver,
        uint256 _feeBasisPoints
    ) external onlyOwner {
        require(_index < fees.length, "Fee does not exist");

        if (_feeBasisPoints == 0) {
            fees[_index] = fees[fees.length - 1];
            fees.pop();
        } else {
            fees[_index].receiver = _receiver;
            fees[_index].basisPoints = _feeBasisPoints;
        }

        require(_totalFeesBasisPoints() <= 5000, "Total fees must be <= 50%");
    }

    /**
     * @notice returns the total underlying value of lsd tokens in the pool (excludes newly earned rewards)
     * @return the total underlying value
     */
    function _totalStaked() internal view override returns (uint256) {
        return totalDeposits;
    }

    /**
     * @notice returns the total underlying value of lsd tokens in the pool (includes newly earned rewards)
     * @return the total underlying value
     */
    function _totalDeposits() internal view returns (uint256) {
        uint256 totalDepositAmounts;

        for (uint256 i = 0; i < lsdTokens.length; i++) {
            totalDepositAmounts += lsdAdapters[lsdTokens[i]].getTotalDeposits();
        }

        return totalDepositAmounts;
    }

    /**
     * @notice returns the sum of all fees
     * @return sum of fees in basis points
     **/
    function _totalFeesBasisPoints() internal view returns (uint256) {
        uint256 totalFees;
        for (uint i = 0; i < fees.length; i++) {
            totalFees += fees[i].basisPoints;
        }
        return totalFees;
    }

    /**
     * @notice returns the withdrawal fee to be paid on a withdrawal
     * @param _amount amount to withdraw
     * @return amount of tokens to be paid on withdrawal
     **/
    function _getWithdrawalFeeAmount(uint256 _amount) internal view returns (uint256) {
        return (_amount * withdrawalFee) / 10000;
    }
}
