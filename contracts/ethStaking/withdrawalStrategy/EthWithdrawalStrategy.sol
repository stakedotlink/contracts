// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../../core/base/Strategy.sol";
import "../../core/interfaces/IWrappedETH.sol";
import "./interfaces/IWithdrawalAdapter.sol";

/**
 * @title ETH Withdrawal Strategy
 * @notice Enables holders of ETH withdrawal NFTs to instantly swap them for ETH
 */
contract EthWithdrawalStrategy is Strategy {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    uint256 public totalDeposits;
    uint256 private maxDeposits;

    address[] private adapters;
    mapping(address => bool) private adaptersMap;

    event SetMaxDeposits(uint256 max);

    error ETHTransferFailed();
    error OnlyAdapter();
    error InsufficientDepositRoom(uint256 amount, uint256 depositRoom);
    error InsufficientWithdrawalRoom(uint256 amount, uint256 withdrawalRoom);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _wETH,
        address _stakingPool,
        uint256 _maxDeposits
    ) public initializer {
        __Strategy_init(_wETH, _stakingPool);
        maxDeposits = _maxDeposits;
    }

    modifier onlyAdapter() {
        if (!adaptersMap[msg.sender]) revert OnlyAdapter();
        _;
    }

    receive() external payable {}

    function getAdapters() external view returns (address[] memory) {
        return adapters;
    }

    /**
     * @notice deposits wETH from StakingPool into this strategy
     * @param _amount amount of wETH to deposit
     */
    function deposit(uint256 _amount) external onlyStakingPool {
        if (_amount > canDeposit()) revert InsufficientDepositRoom(_amount, canDeposit());
        token.safeTransferFrom(address(stakingPool), address(this), _amount);
        totalDeposits += _amount;
    }

    /**
     * @notice withdraws wETH into StakingPool
     * @param _amount amount of ETH to withdraw
     */
    function withdraw(uint256 _amount) external onlyStakingPool {
        if (_amount > canWithdraw()) revert InsufficientWithdrawalRoom(_amount, canWithdraw());
        token.safeTransfer(address(stakingPool), _amount);
        totalDeposits += _amount;
    }

    function adapterDeposit() external payable onlyAdapter {
        IWrappedETH(address(token)).wrap{value: msg.value}();
    }

    function adapterWithdraw(address _receiver, uint256 _amount) external onlyAdapter {
        IWrappedETH(address(token)).unwrap(_amount);
        (bool success, ) = payable(_receiver).call{value: _amount}("");
        if (!success) revert ETHTransferFailed();
    }

    function depositChange() public view override returns (int256) {
        uint256 newTotalDeposits = token.balanceOf(address(this));
        for (uint256 i = 0; i < adapters.length; ++i) {
            newTotalDeposits += IWithdrawalAdapter(adapters[i]).getTotalDeposits();
        }
        return int256(newTotalDeposits) - int256(totalDeposits);
    }

    /**
     * @notice updates deposit accounting and calculates reward distribution
     */
    function updateDeposits() external onlyStakingPool returns (address[] memory, uint256[] memory) {
        int balanceChange = depositChange();

        if (balanceChange > 0) {
            totalDeposits += uint256(balanceChange);
        } else if (balanceChange < 0) {
            totalDeposits -= uint256(balanceChange * -1);
        }
    }

    /**
     * @notice returns the total amount of deposits in this strategy
     * @return total deposits
     */
    function getTotalDeposits() public view override returns (uint256) {
        return totalDeposits;
    }

    /**
     * @notice returns the maximum that can be deposited into the strategy
     * @return max deposits
     */
    function getMaxDeposits() public view override returns (uint256) {
        return maxDeposits;
    }

    /**
     * @notice returns the minimum that must remain in the strategy
     * @return min deposits
     */
    function getMinDeposits() public view override returns (uint256) {
        uint256 minDeposits;
        for (uint256 i = 0; i < adapters.length; ++i) {
            minDeposits += IWithdrawalAdapter(adapters[i]).getTotalDeposits();
        }
        return minDeposits;
    }

    /**
     * @notice sets the maximum that can be deposited into the strategy
     * @param _maxDeposits maximum deposits
     */
    function setMaxDeposits(uint256 _maxDeposits) external onlyOwner {
        maxDeposits = _maxDeposits;
        emit SetMaxDeposits(_maxDeposits);
    }
}
