// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "./base/VaultControllerStrategy.sol";
import "./interfaces/IOperatorVault.sol";

/**
 * @title Operator Vault Controller Strategy
 * @notice Implemented strategy for managing multiple Chainlink operator staking vaults
 */
contract OperatorVCS is VaultControllerStrategy {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    uint256 private totalPrincipalDeposits;
    uint256 public operatorRewardPercentage;

    mapping(address => bool) private vaultMapping;

    event VaultAdded(address indexed operator);
    event DepositBufferedTokens(uint256 depositedAmount);
    event WithdrawExtraRewards(address indexed receiver, uint256 amount);
    event SetOperatorRewardPercentage(uint256 rewardPercentage);

    error InvalidPercentage();
    error SenderNotAuthorized();
    error UnauthorizedToken();
    error NoExtraRewards();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice initializes contract
     * @param _token address of LINK token
     * @param _stakingPool address of the staking pool that controls this strategy
     * @param _stakeController address of Chainlink staking contract
     * @param _vaultImplementation address of the implementation contract to use when deploying new vaults
     * @param _minDepositThreshold min amount of LINK deposits needed to initiate a deposit into vaults
     * @param _fees list of fees to be paid on rewards
     * @param _operatorRewardPercentage basis point amount of an operator's earned rewards that they receive
     **/
    function initialize(
        address _token,
        address _stakingPool,
        address _stakeController,
        address _vaultImplementation,
        uint256 _minDepositThreshold,
        Fee[] memory _fees,
        uint256 _operatorRewardPercentage
    ) public reinitializer(2) {
        if (address(token) == address(0)) {
            __VaultControllerStrategy_init(
                _token,
                _stakingPool,
                _stakeController,
                _vaultImplementation,
                _minDepositThreshold,
                _fees
            );
        }

        if (_operatorRewardPercentage > 10000) revert InvalidPercentage();
        operatorRewardPercentage = _operatorRewardPercentage;
        for (uint256 i = 0; i < vaults.length; ++i) {
            vaultMapping[address(vaults[i])] = true;
        }
    }

    /**
     * @notice returns the maximum that can be deposited into this strategy
     * @return maximum deposits
     */
    function getMaxDeposits() public view override returns (uint256) {
        (, uint256 vaultMaxDeposits) = getVaultDepositLimits();
        return totalDeposits + vaultMaxDeposits * vaults.length - (totalPrincipalDeposits + bufferedDeposits);
    }

    /**
     * @notice returns the minimum that must remain this strategy
     * @return minimum deposits
     */
    function getMinDeposits() public view override returns (uint256) {
        return totalDeposits;
    }

    /**
     * @notice returns the vault deposit limits for vaults controlled by this strategy
     * @return minimum amount of deposits that a vault can hold
     * @return maximum amount of deposits that a vault can hold
     */
    function getVaultDepositLimits() public view override returns (uint256, uint256) {
        return stakeController.getOperatorLimits();
    }

    /**
     * @notice ERC677 implementation to receive operator rewards
     * @dev
     * - rewards are paid in the stakingPool LSD token
     * - reverts if transferred token is not stakingPool LSD
     **/
    function onTokenTransfer(
        address,
        uint256,
        bytes calldata
    ) external {
        if (msg.sender != address(stakingPool)) revert UnauthorizedToken();
    }

    /**
     * @notice used by vaults to withdraw operator rewards
     * @dev reverts if sender is not an authorized vault
     * @param _receiver address to receive rewards
     * @param _amount amount to withdraw
     */
    function withdrawVaultRewards(address _receiver, uint256 _amount) external returns (uint256) {
        if (!vaultMapping[msg.sender]) revert SenderNotAuthorized();

        IERC20Upgradeable lsdToken = IERC20Upgradeable(address(stakingPool));
        uint256 withdrawableRewards = lsdToken.balanceOf(address(this));
        uint256 amountToWithdraw = _amount > withdrawableRewards ? withdrawableRewards : _amount;

        lsdToken.safeTransfer(_receiver, amountToWithdraw);
        return amountToWithdraw;
    }

    /**
     * @notice returns the total amount of fees that will be paid on the next call to updateDeposits()
     * @dev fees are only paid when the depositChange since the last update is positive
     * @return total fees
     */
    function pendingFees() external view override returns (uint256) {
        int256 balanceChange = depositChange();
        uint256 totalFees;

        if (balanceChange > 0) {
            totalFees = (uint256(balanceChange) * operatorRewardPercentage) / 10000;
            for (uint256 i = 0; i < fees.length; ++i) {
                totalFees += (uint256(balanceChange) * fees[i].basisPoints) / 10000;
            }
        }
        return totalFees;
    }

    /**
     * @notice updates deposit accounting and calculates fees on newly earned rewards
     * @dev reverts if sender is not stakingPool
     * @return receivers list of fee receivers
     * @return amounts list of fee amounts
     */
    function updateDeposits()
        external
        override
        onlyStakingPool
        returns (address[] memory receivers, uint256[] memory amounts)
    {
        int256 balanceChange = depositChange();

        if (balanceChange > 0) {
            totalDeposits += uint256(balanceChange);

            receivers = new address[](fees.length + 1);
            amounts = new uint256[](fees.length + 1);

            receivers[0] = address(this);
            amounts[0] = (uint256(balanceChange) * operatorRewardPercentage) / 10000;

            for (uint256 i = 1; i < receivers.length; ++i) {
                receivers[i] = fees[i - 1].receiver;
                amounts[i] = (uint256(balanceChange) * fees[i - 1].basisPoints) / 10000;
            }
        } else if (balanceChange < 0) {
            totalDeposits -= uint256(balanceChange * -1);
        }
    }

    /**
     * @notice deploys a new vault and adds it this strategy
     * @dev reverts if sender is not owner
     * @param _operator address of operator that the vault represents
     * @param _rewardsReceiver address authorized to claim rewards for the vault
     */
    function addVault(address _operator, address _rewardsReceiver) external onlyOwner {
        bytes memory data = abi.encodeWithSignature(
            "initialize(address,address,address,address,address)",
            address(token),
            address(this),
            address(stakeController),
            _operator,
            _rewardsReceiver
        );
        _deployVault(data);
        vaultMapping[address(vaults[vaults.length - 1])] = true;
        emit VaultAdded(_operator);
    }

    /**
     * @notice returns the total amount of unclaimed operator rewards across all vaults
     * @return operator rewards
     */
    function getOperatorRewards() public view returns (uint256) {
        uint256 vaultCount = vaults.length;
        uint256 operatorRewards;
        for (uint256 i = 0; i < vaultCount; ++i) {
            operatorRewards += IOperatorVault(address(vaults[i])).getRewards();
        }

        return operatorRewards;
    }

    /**
     * @notice returns the amount of extra rewards held by this contract
     * @dev extra rewards consist of the yield earned on unclaimed operator rewards
     * @return extra rewards
     */
    function getExtraRewards() public view returns (uint256) {
        uint256 operatorRewards = getOperatorRewards();
        uint256 totalRewards = IERC20Upgradeable(address(stakingPool)).balanceOf(address(this));

        if (totalRewards > operatorRewards) {
            uint256 extraRewards = totalRewards - operatorRewards;
            if (extraRewards >= 100) {
                return extraRewards;
            }
        }

        return 0;
    }

    /**
     * @notice withdraws all extra rewards held by this contract
     * @dev reverts if sender is not owner
     * @param _receiver address to receive rewards
     */
    function withdrawExtraRewards(address _receiver) external onlyOwner {
        uint256 extraRewards = getExtraRewards();

        if (extraRewards == 0) {
            revert NoExtraRewards();
        }

        IERC20Upgradeable(address(stakingPool)).safeTransfer(_receiver, extraRewards);
        emit WithdrawExtraRewards(_receiver, extraRewards);
    }

    /**
     * @notice sets a vault's operator address
     * @dev reverts if sender is not owner
     * @param _index index of vault
     * @param _operator address of operator that the vault represents
     */
    function setOperator(uint256 _index, address _operator) external onlyOwner {
        IOperatorVault(address(vaults[_index])).setOperator(_operator);
    }

    /**
     * @notice sets the address authorized to claim rewards for a vault
     * @dev reverts if sender is not owner
     * @param _index index of vault
     * @param _rewardsReceiver address of rewards receiver for the vault
     */
    function setRewardsReceiver(uint256 _index, address _rewardsReceiver) external onlyOwner {
        IOperatorVault(address(vaults[_index])).setRewardsReceiver(_rewardsReceiver);
    }

    /**
     * @notice sets the basis point amount of an operator's earned rewards that they receive
     * @dev
     * - stakingPool.updateStrategyRewards and vault.updateRewards are called to credit
     *   all past operator rewards at the old rate before the reward percentage changes
     * - reverts if sender is not owner
     * - reverts if `_operatorRewardPercentage` is > 10000
     * @param _operatorRewardPercentage basis point amount
     */
    function setOperatorRewardPercentage(uint256 _operatorRewardPercentage) public onlyOwner {
        if (_operatorRewardPercentage > 10000) revert InvalidPercentage();

        _updateStrategyRewards();

        uint256 vaultCount = vaults.length;
        for (uint256 i = 0; i < vaultCount; ++i) {
            IOperatorVault(address(vaults[i])).updateRewards();
        }

        operatorRewardPercentage = _operatorRewardPercentage;
        emit SetOperatorRewardPercentage(_operatorRewardPercentage);
    }

    /**
     * @notice deposits buffered tokens into vaults
     * @param _startIndex index of first vault to deposit into
     * @param _toDeposit amount to deposit
     * @param _vaultMinDeposits minimum amount of deposits that a vault can hold
     * @param _vaultMaxDeposits minimum amount of deposits that a vault can hold
     */
    function _depositBufferedTokens(
        uint256 _startIndex,
        uint256 _toDeposit,
        uint256 _vaultMinDeposits,
        uint256 _vaultMaxDeposits
    ) internal override {
        uint256 deposited = _depositToVaults(_startIndex, _toDeposit, _vaultMinDeposits, _vaultMaxDeposits);
        totalPrincipalDeposits += deposited;
        bufferedDeposits -= deposited;
        emit DepositBufferedTokens(deposited);
    }

    /**
     * @notice updates rewards for all strategies controlled by the staking pool
     * @dev called before operatorRewardPercentage is changed to
     * credit any past rewards at the old rate
     */
    function _updateStrategyRewards() private {
        address[] memory strategies = stakingPool.getStrategies();
        uint256[] memory strategyIdxs = new uint256[](strategies.length);
        for (uint256 i = 0; i < strategies.length; ++i) {
            strategyIdxs[i] = i;
        }
        stakingPool.updateStrategyRewards(strategyIdxs);
    }
}
