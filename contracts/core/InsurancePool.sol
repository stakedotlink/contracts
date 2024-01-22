// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "./base/StakingRewardsPool.sol";
import "./interfaces/IRewardsPool.sol";

/**
 * @title Insurance Pool
 * @notice Allows users to stake LP tokens to earn rewards while insuring the staking pool from significant slashing events
 */
contract InsurancePool is StakingRewardsPool {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    uint256 public totalDeposits;
    IRewardsPool public rewardsPool;

    address public rebaseController;
    uint256 public maxClaimAmountBP;
    bool public claimInProgress;

    event InitiateClaim();
    event ExecuteClaim(uint256 amount);
    event ResolveClaim();

    error SenderNotAuthorized();
    error ClaimInProgress();
    error ExceedsMaxClaimAmount();
    error InvalidClaimAmount();
    error NoClaimInProgress();

    function initialize(
        address _lpToken,
        string memory _liquidTokenName,
        string memory _liquidTokenSymbol,
        address _rebaseController,
        uint256 _maxClaimAmountBP
    ) public initializer {
        __StakingRewardsPool_init(_lpToken, _liquidTokenName, _liquidTokenSymbol);
        rebaseController = _rebaseController;
        if (_maxClaimAmountBP > 9000) revert InvalidClaimAmount();
        maxClaimAmountBP = _maxClaimAmountBP;
    }

    modifier onlyRebaseController() {
        if (msg.sender != rebaseController) revert SenderNotAuthorized();
        _;
    }

    modifier whileNoClaimInProgress() {
        if (claimInProgress) revert ClaimInProgress();
        _;
    }

    /**
     * @notice deposits tokens into the pool
     * @param _amount amount of tokens to deposit
     */
    function deposit(uint256 _amount) external whileNoClaimInProgress {
        rewardsPool.updateReward(msg.sender);
        token.safeTransferFrom(msg.sender, address(this), _amount);
        _mint(msg.sender, _amount);
        totalDeposits += _amount;
    }

    /**
     * @notice withdraws tokens from the pool
     * @param _amount amount of tokens to withdraw
     */
    function withdraw(uint256 _amount) external whileNoClaimInProgress {
        rewardsPool.updateReward(msg.sender);
        _burn(msg.sender, _amount);
        totalDeposits -= _amount;
        token.safeTransfer(msg.sender, _amount);
    }

    /**
     * @notice initiates the claim process
     */
    function initiateClaim() external onlyRebaseController whileNoClaimInProgress {
        claimInProgress = true;
        emit InitiateClaim();
    }

    /**
     * @notice executes a claim by withdrawing tokens from the pool
     * @dev will cause all stakers' balances to decrease by the percentage that is withdrawn
     * @param _amount amount of tokens to withdraw
     */
    function executeClaim(uint256 _amount) external onlyOwner {
        if (!claimInProgress) revert NoClaimInProgress();
        if (_amount > (totalDeposits * maxClaimAmountBP) / 10000) revert ExceedsMaxClaimAmount();

        if (_amount != 0) {
            totalDeposits -= _amount;
            token.safeTransfer(msg.sender, _amount);
        }
        emit ExecuteClaim(_amount);
    }

    function resolveClaim() external onlyRebaseController {
        if (!claimInProgress) revert NoClaimInProgress();

        claimInProgress = false;
        emit ResolveClaim();
    }

    /**
     * @notice returns an account's staked amount for use by the rewards pool
     * controlled by this contract
     * @dev shares are used so this contract can rebase without affecting rewards
     * @param _account account address
     * @return account's staked amount
     */
    function staked(address _account) external view returns (uint256) {
        return sharesOf(_account);
    }

    /**
     * @notice returns the total staked amount for use by the rewards pool
     * controlled by this contract
     * @dev shares are used so this contract can rebase without affecting rewards
     * @return total staked amount
     */
    function totalStaked() external view returns (uint256) {
        return totalShares;
    }

    /**
     * @notice sets the address of the rewards pool
     * @param _rewardsPool address of rewards pool
     */
    function setRewardsPool(address _rewardsPool) external onlyOwner {
        rewardsPool = IRewardsPool(_rewardsPool);
    }

    /**
     * @notice sets the address of the rebase controller
     * @param _rebaseController address of rebase controller
     */
    function setRebaseController(address _rebaseController) external onlyOwner {
        rebaseController = _rebaseController;
    }

    /**
     * @notice sets the maximum size of a single claim in basis points with respect to the size of the pool
     * @param _maxClaimAmountBP max claim amount in basis points
     */
    function setMaxClaimAmountBP(uint256 _maxClaimAmountBP) external onlyOwner {
        if (_maxClaimAmountBP > 9000) revert InvalidClaimAmount();
        maxClaimAmountBP = _maxClaimAmountBP;
    }

    /**
     * @notice returns the total amount of assets staked in the pool
     * @return total staked amount
     */
    function _totalStaked() internal view override returns (uint256) {
        return totalDeposits;
    }
}
