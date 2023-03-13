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

    uint256 private totalDeposits;
    uint256 private maxDeposits;

    address[] private adapters;
    mapping(address => bool) private adaptersMap;

    event SetMaxDeposits(uint256 max);
    event AdapterAdded(address adapter);
    event AdapterRemoved(address adapter);

    error ETHTransferFailed();
    error OnlyAdapter();
    error InsufficientDepositRoom(uint256 amount, uint256 depositRoom);
    error InsufficientWithdrawalRoom(uint256 amount, uint256 withdrawalRoom);
    error AdapterAlreadyExists();
    error AdapterNotFound();
    error AdapterContainsDeposits();

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

    /**
     * @notice returns a list of all adapters linked to this strategy
     * @return list of adapters
     */
    function getAdapters() external view returns (address[] memory) {
        return adapters;
    }

    /**
     * @notice deposits wETH into this strategy
     * @param _amount amount of wETH to deposit
     */
    function deposit(uint256 _amount) external onlyStakingPool {
        if (_amount > canDeposit()) revert InsufficientDepositRoom(_amount, canDeposit());
        token.safeTransferFrom(address(stakingPool), address(this), _amount);
        totalDeposits += _amount;
    }

    /**
     * @notice withdraws wETH from this strategy
     * @param _amount amount of ETH to withdraw
     */
    function withdraw(uint256 _amount) external onlyStakingPool {
        if (_amount > canWithdraw()) revert InsufficientWithdrawalRoom(_amount, canWithdraw());
        token.safeTransfer(address(stakingPool), _amount);
        totalDeposits -= _amount;
    }

    /**
     * @notice deposits ETH into this strategy from an adapter and wraps it
     */
    function adapterDeposit() external payable onlyAdapter {
        IWrappedETH(address(token)).wrap{value: msg.value}();
    }

    /**
     * @notice unwraps ETH and withdraws it to a receiver
     * @param _receiver account to receive ETH
     * @param _amount amount of ETH to withdraw
     */
    function adapterWithdraw(address _receiver, uint256 _amount) external onlyAdapter {
        IWrappedETH(address(token)).unwrap(_amount);
        _sendEther(_receiver, _amount);
    }

    /**
     * @notice returns the deposit change (positive/negative) since deposits were last updated
     * @return deposit change
     */
    function depositChange() public view override returns (int256) {
        uint256 newTotalDeposits = token.balanceOf(address(this));
        for (uint256 i = 0; i < adapters.length; ++i) {
            newTotalDeposits += IWithdrawalAdapter(adapters[i]).getTotalDeposits();
        }
        return int256(newTotalDeposits) - int256(totalDeposits);
    }

    /**
     * @notice updates deposit accounting
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
     * @notice returns the amount of deposits available for use by adapters
     * @return available deposits
     */
    function availableDeposits() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /**
     * @notice returns the total amount of deposits in this strategy
     * @return total deposits
     */
    function getTotalDeposits() public view override returns (uint256) {
        return totalDeposits;
    }

    /**
     * @notice returns the maximum that can be deposited into this strategy
     * @return max deposits
     */
    function getMaxDeposits() public view override returns (uint256) {
        return maxDeposits;
    }

    /**
     * @notice returns the minimum that must remain in this strategy
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
     * @notice sets the maximum that can be deposited into this strategy
     * @param _maxDeposits maximum deposits
     */
    function setMaxDeposits(uint256 _maxDeposits) external onlyOwner {
        maxDeposits = _maxDeposits;
        emit SetMaxDeposits(_maxDeposits);
    }

    /**
     * @notice adds a new withdrawal adapter
     * @param _adapter address of adapter
     */
    function addAdapter(address _adapter) external onlyOwner {
        if (adaptersMap[_adapter]) revert AdapterAlreadyExists();
        adaptersMap[_adapter] = true;
        adapters.push(_adapter);
        emit AdapterAdded(_adapter);
    }

    /**
     * @notice removes an existing withdrawal adapter
     * @param _adapter address of adapter
     */
    function removeAdapter(address _adapter) external onlyOwner {
        if (!adaptersMap[_adapter]) revert AdapterNotFound();
        for (uint256 i = 0; i < adapters.length; ++i) {
            if (adapters[i] == _adapter) {
                if (IWithdrawalAdapter(adapters[i]).getTotalDeposits() > 0) revert AdapterContainsDeposits();
                adapters[i] = adapters[adapters.length - 1];
                adapters.pop();
                break;
            }
        }
        delete adaptersMap[_adapter];
        emit AdapterRemoved(_adapter);
    }

    /**
     * @notice performs an ETH transfer
     * @param _to account to receive transfer
     * @param _amount amount to transfer
     */
    function _sendEther(address _to, uint256 _amount) internal {
        (bool success, ) = _to.call{value: _amount}("");
        if (!success) revert ETHTransferFailed();
    }
}
