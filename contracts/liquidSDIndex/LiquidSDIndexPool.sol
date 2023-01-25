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

    uint256 private totalDeposits;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory _derivativeTokenName,
        string memory _derivativeTokenSymbol,
        uint256 _compositionTolerance,
        uint256 _compositionEnforcementThreshold
    ) public initializer {
        __StakingRewardsPool_init(address(0), _derivativeTokenName, _derivativeTokenSymbol);
        compositionTolerance = _compositionTolerance;
        compositionEnforcementThreshold = _compositionEnforcementThreshold;
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
    function getComposition() public view returns (uint256[] memory) {
        uint256[] memory depositAmounts = getDepositAmounts();
        uint256 totalDepositAmounts;

        for (uint256 i = 0; i < depositAmounts.length; i++) {
            totalDepositAmounts += depositAmounts[i];
        }

        uint256[] memory composition = new uint256[](lsdTokens.length);

        for (uint256 i = 0; i < lsdTokens.length; i++) {
            composition[i] = (depositAmounts[i] * 10000) / totalDepositAmounts;
        }

        return composition;
    }

    /**
     * @notice returns the amount of deposits for each lsd
     * @return list of deposit amounts
     */
    function getDepositAmounts() public view returns (uint256[] memory) {
        uint256[] memory depositAmounts = new uint256[](lsdTokens.length);

        for (uint256 i = 0; i < lsdTokens.length; i++) {
            depositAmounts[i] = lsdAdapters[lsdTokens[i]].getTotalDeposits();
        }

        return depositAmounts;
    }

    /**
     * @notice returns the deposit room for an lsd token
     * @param _lsdToken address of token
     **/
    function getDepositRoom(address _lsdToken) public view tokenIsSupported(_lsdToken) returns (uint256) {
        uint256 depositLimit = type(uint256).max;

        for (uint256 i = 0; i < lsdTokens.length; i++) {
            address lsdToken = lsdTokens[i];

            if (lsdToken == _lsdToken) {
                continue;
            }

            uint256 compositionTarget = compositionTargets[lsdToken];
            uint256 deposits = lsdAdapters[lsdToken].getTotalDeposits();

            uint256 minComposition = (compositionTarget * compositionTolerance) / 10000;
            depositLimit = MathUpgradeable.min(deposits / minComposition, depositLimit);
        }

        uint256 compositionTarget = compositionTargets[_lsdToken];
        uint256 deposits = lsdAdapters[_lsdToken].getTotalDeposits();
        uint256 minThreshold = (compositionEnforcementThreshold * compositionTarget) / 10000;

        if (deposits < minThreshold) {
            uint256 thresholdDiff = minThreshold - deposits;
            depositLimit = MathUpgradeable.max(thresholdDiff, depositLimit);
        }

        return depositLimit;
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
     * @notice withdraws lsd tokens and burns lsd index tokens
     * @param _amount amount to withdraw
     **/
    function withdraw(uint256 _amount) external {
        uint256[] memory composition = getComposition();

        _burn(msg.sender, _amount);
        totalDeposits -= _amount;

        for (uint256 i = 0; i < lsdTokens.length; i++) {
            address lsdToken = lsdTokens[i];
            ILiquidSDAdapter lsdAdapter = lsdAdapters[lsdToken];
            uint256 lsdAmount = lsdAdapter.getLSDByUnderlying((_amount * composition[i]) / 10000);
            IERC20Upgradeable(lsdToken).safeTransferFrom(address(lsdAdapter), msg.sender, lsdAmount);
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

        require(totalComposition == 10000, "Composition target must sum to 100%");
    }

    /**
     * @notice updates and distributes rewards based on balance changes in adapters
     **/
    function updateRewards() public {
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
     * @notice returns the total underlying value of lsd tokens in the pool
     * @return the total underlying value
     */
    function _totalStaked() internal view override returns (uint256) {
        return totalDeposits;
    }

    /**
     * @notice returns the sum of all fees
     * @return sum of fees in basis points
     **/
    function _totalFeesBasisPoints() private view returns (uint256) {
        uint256 totalFees;
        for (uint i = 0; i < fees.length; i++) {
            totalFees += fees[i].basisPoints;
        }
        return totalFees;
    }
}
