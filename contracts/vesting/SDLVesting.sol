// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../core/interfaces/IERC677.sol";
import "../core/interfaces/ISDLPool.sol";

/**
 * @title SDL Vesting
 * @notice Releases SDL to a beneficiary on a defined vesting schedule and stakes it into
 * the SDL pool periodically. The beneficiary must select a lock time between 0 and 4 years
 * for their staked SDL.
 */
contract SDLVesting is Ownable {
    using SafeERC20 for IERC677;
    using SafeERC20 for IERC20;

    // maximum lock time in years
    uint256 public constant MAX_LOCK_TIME = 4;

    // address of SDL token
    IERC677 public immutable sdlToken;
    // address of SDL pool
    ISDLPool public immutable sdlPool;

    // whether vesting has been terminated
    bool public vestingTerminated;

    // amount of tokens claimed by the beneficiary
    uint256 public released;
    // address to receive vested SDL
    address public immutable beneficiary;
    // start time of vesting in seconds
    uint64 public immutable start;
    // duration of vesting in seconds
    uint64 public immutable duration;

    // lock time in years to use for staking vested SDL
    uint64 public lockTime;
    // list of reSDL token ids for each lock time
    uint256[] private reSDLTokenIds;

    // address authorized to stake releasable tokens
    address public staker;

    event VestingTerminated();
    event Released(uint256 amount);
    event Staked(uint256 amount);
    event SetLockTime(uint64 lockTime);

    error SenderNotAuthorized();
    error VestingAlreadyTerminated();
    error NoTokensReleasable();
    error InvalidLockTime();

    /**
     * @notice Initializes contract
     * @param _sdlToken address of SDL token
     * @param _sdlPool address of SDL pool
     * @param _owner address authorized to terminate vesting
     * @param _beneficiary address to receive vested SDL
     * @param _start start time of vesting in seconds
     * @param _duration duration of vesting in seconds
     * @param _lockTime lock time in years to use for staking vested SDL
     * @param _staker address authorized to stake releasable tokens
     */
    constructor(
        address _sdlToken,
        address _sdlPool,
        address _owner,
        address _beneficiary,
        uint64 _start,
        uint64 _duration,
        uint64 _lockTime,
        address _staker
    ) {
        _transferOwnership(_owner);

        sdlToken = IERC677(_sdlToken);
        sdlPool = ISDLPool(_sdlPool);

        beneficiary = _beneficiary;

        start = _start;
        duration = _duration;

        if (_lockTime > MAX_LOCK_TIME) revert InvalidLockTime();
        lockTime = _lockTime;

        staker = _staker;

        for (uint256 i = 0; i <= MAX_LOCK_TIME; ++i) {
            reSDLTokenIds.push(0);
        }
    }

    /**
     * @notice Reverts if sender is not beneficiary
     */
    modifier onlyBeneficiary() {
        if (msg.sender != beneficiary) revert SenderNotAuthorized();
        _;
    }

    /**
     * @notice Reverts if sender is not beneficiary and not staker
     */
    modifier onlyBeneficiaryOrStaker() {
        if (msg.sender != beneficiary && msg.sender != staker) revert SenderNotAuthorized();
        _;
    }

    /**
     * @notice Returns how many tokens are vested but unclaimed
     * @return number of releasable tokens
     */
    function releasable() public view returns (uint256) {
        return vestedAmount(uint64(block.timestamp)) - released;
    }

    /**
     * @notice Stakes all releasable tokens into the SDL pool using the current stored lock time
     */
    function stakeReleasableTokens() external onlyBeneficiaryOrStaker {
        uint256 amount = releasable();
        if (amount == 0) revert NoTokensReleasable();

        released += amount;
        sdlToken.transferAndCall(
            address(sdlPool),
            amount,
            abi.encode(reSDLTokenIds[lockTime], lockTime * (365 days))
        );

        if (reSDLTokenIds[lockTime] == 0) {
            reSDLTokenIds[lockTime] = sdlPool.lastLockId();
        }

        emit Staked(amount);
    }

    /**
     * @notice Withdraws all releasable tokens
     */
    function release() external onlyBeneficiary {
        uint256 amount = releasable();
        if (amount == 0) revert NoTokensReleasable();

        released += amount;
        sdlToken.safeTransfer(beneficiary, amount);

        emit Released(amount);
    }

    /**
     * @notice Claims rewards from the SDL pool
     * @param _tokens list of tokens to claim rewards for
     */
    function claimRESDLRewards(address[] calldata _tokens) external onlyBeneficiary {
        sdlPool.withdrawRewards(_tokens);

        for (uint256 i = 0; i < _tokens.length; ++i) {
            if (_tokens[i] == address(sdlToken)) continue; // Skip SDL token

            IERC20 token = IERC20(_tokens[i]);
            uint256 balance = token.balanceOf(address(this));
            if (balance != 0) {
                token.safeTransfer(beneficiary, balance);
            }
        }
    }

    /**
     * @notice Returns a list of all reSDL positions held by this contract
     * @return list of reSDL positions
     */
    function getRESDLPositions() external view returns (ISDLPool.RESDLToken[] memory) {
        ISDLPool.RESDLToken[] memory positions = new ISDLPool.RESDLToken[](MAX_LOCK_TIME + 1);

        for (uint256 i = 0; i < positions.length; ++i) {
            if (reSDLTokenIds[i] != 0) {
                uint256[] memory id = new uint256[](1);
                id[0] = reSDLTokenIds[i];
                ISDLPool.RESDLToken[] memory token = sdlPool.getLocks(id);
                positions[i] = token[0];
            }
        }

        return positions;
    }

    /**
     * @notice Transfers reSDL positions to beneficiary
     * @param _lockTimes list of lock times representing reSDL positions
     */
    function withdrawRESDLPositions(uint256[] calldata _lockTimes) external onlyBeneficiary {
        for (uint256 i = 0; i < _lockTimes.length; ++i) {
            if (_lockTimes[i] > MAX_LOCK_TIME) revert InvalidLockTime();

            uint256 tokenId = reSDLTokenIds[_lockTimes[i]];
            delete reSDLTokenIds[_lockTimes[i]];

            sdlPool.safeTransferFrom(address(this), beneficiary, tokenId);
        }
    }

    /**
     * @notice Sets the lock time for staking releasable tokens
     * @param _lockTime lock time in years
     */
    function setLockTime(uint64 _lockTime) external onlyBeneficiary {
        if (_lockTime > MAX_LOCK_TIME) revert InvalidLockTime();
        lockTime = _lockTime;
        emit SetLockTime(_lockTime);
    }

    /**
     * @notice Returns the total number of vested tokens at a certain timestamp
     * @param _timestamp timestamp in seconds
     * @return amount of tokens vested at the given timestamp (returns full allocation if terminated)
     */
    function vestedAmount(uint64 _timestamp) public view returns (uint256) {
        uint256 totalAllocation = sdlToken.balanceOf(address(this)) + released;

        if (_timestamp < start) {
            return 0;
        } else if (_timestamp >= start + duration) {
            return totalAllocation;
        } else if (vestingTerminated) {
            return totalAllocation;
        } else {
            return (totalAllocation * (_timestamp - start)) / duration;
        }
    }

    /**
     * @notice Terminates the vesting contract and withdraws unvested tokens
     */
    function terminateVesting() external onlyOwner {
        if (vestingTerminated) revert VestingAlreadyTerminated();

        uint256 toWithdraw = sdlToken.balanceOf(address(this)) - releasable();
        sdlToken.safeTransfer(msg.sender, toWithdraw);

        vestingTerminated = true;
        emit VestingTerminated();
    }

    /**
     * @notice Sets the address authorized to stake releasable tokens
     * @param _staker address authorized to stake
     */
    function setStaker(address _staker) external onlyOwner {
        staker = _staker;
    }
}
