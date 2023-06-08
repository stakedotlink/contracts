// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "./base/VaultControllerStrategy.sol";

/**
 * @title Operator Vault Controller Strategy
 * @notice Implemented strategy for managing multiple Chainlink operator staking vaults
 */
contract OperatorVCS is VaultControllerStrategy {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    uint256 private totalPrincipalDeposits;

    uint256 public operatorRewardPercentage;
    uint256 public unclaimedOperatorRewards;

    mapping(address => bool) private vaultMapping;

    event VaultAdded(address indexed operator);
    event DepositBufferedTokens(uint256 depositedAmount);

    error InvalidPercentage();
    error SenderNotAuthorized();
    error UnauthorizedToken();
    error NoExtraRewards();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

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
        for (uint256 i = 0; i < vaults.length; i++) {
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
     * @notice returns the vault deposit limits
     * @return minimum amount of deposits that a vault can hold
     * @return maximum amount of deposits that a vault can hold
     */
    function getVaultDepositLimits() public view override returns (uint256, uint256) {
        return stakeController.getOperatorLimits();
    }

    /**
     * @notice ERC677 implementation to receive operator rewards
     **/
    function onTokenTransfer(
        address,
        uint256,
        bytes calldata
    ) external {
        if (msg.sender != address(stakingPool)) revert UnauthorizedToken();
    }

    function withdrawVaultRewards(address _receiver, uint256 _amount) external returns (uint256) {
        if (!vaultMapping[msg.sender]) revert SenderNotAuthorized();

        uint256 amountToWithdraw = _amount > unclaimedOperatorRewards ? unclaimedOperatorRewards : _amount;
        IERC20Upgradeable(address(stakingPool)).safeTransfer(_receiver, amountToWithdraw);
        unclaimedOperatorRewards -= amountToWithdraw;
        return amountToWithdraw;
    }

    /**
     * @notice returns the  total amount of fees that will be paid on the next update
     * @return total fees
     */
    function pendingFees() external view override returns (uint256) {
        int256 balanceChange = depositChange();
        uint256 totalFees;

        if (balanceChange > 0) {
            totalFees = (uint256(balanceChange) * operatorRewardPercentage) / 10000;
            for (uint256 i = 0; i < fees.length; i++) {
                totalFees += (uint256(balanceChange) * fees[i].basisPoints) / 10000;
            }
        }
        return totalFees;
    }

    /**
     * @notice updates the total amount deposited for reward distribution
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
            unclaimedOperatorRewards += amounts[0];

            for (uint256 i = 1; i < receivers.length; i++) {
                receivers[i] = fees[i - 1].receiver;
                amounts[i] = (uint256(balanceChange) * fees[i - 1].basisPoints) / 10000;
            }
        } else if (balanceChange < 0) {
            totalDeposits -= uint256(balanceChange * -1);
        }
    }

    /**
     * @notice deploys a new vault
     * @param _operator address of operator that the vault represents
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
     * @notice returns the amount of extra rewards held by this contract
     * @dev extra rewards consist of the yield earned on unclaimed operator rewards
     * @return extra rewards
     */
    function getExtraRewards() external view returns (uint256) {
        uint256 vaultCount = vaults.length;
        uint256 operatorRewards;
        for (uint256 i = 0; i < vaultCount; i++) {
            operatorRewards += vaults[i].getRewards();
        }

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
     * @param _receiver address to receive rewards
     */
    function withdrawExtraRewards(address _receiver) external onlyOwner {
        uint256 vaultCount = vaults.length;
        uint256 operatorRewards;
        for (uint256 i = 0; i < vaultCount; i++) {
            operatorRewards += vaults[i].getRewards();
        }

        uint256 totalRewards = IERC20Upgradeable(address(stakingPool)).balanceOf(address(this));

        if (totalRewards > operatorRewards) {
            uint256 extraRewards = totalRewards - operatorRewards;
            if (extraRewards >= 100) {
                IERC20Upgradeable(address(stakingPool)).safeTransfer(_receiver, totalRewards - operatorRewards);
                return;
            }
        }

        revert NoExtraRewards();
    }

    /**
     * @notice sets a vault's operator address
     * @param _index index of vault
     * @param _operator address of operator that the vault represents
     */
    function setOperator(uint256 _index, address _operator) external onlyOwner {
        vaults[_index].setOperator(_operator);
    }

    /**
     * @notice sets a vault's rewards receiver address
     * @param _index index of vault
     * @param _rewardsReceiver address of rewards receiver for the vault
     */
    function setRewardsReceiver(uint256 _index, address _rewardsReceiver) external onlyOwner {
        vaults[_index].setRewardsReceiver(_rewardsReceiver);
    }

    /**
     * @notice sets the percentage of earned rewards an operator receives
     * @dev stakingPool.updateStrategyRewards is called to mint all previous operator
     * rewards before the reward percentage changes
     * @param _operatorRewardPercentage basis point amount
     */
    function setOperatorRewardPercentage(uint256 _operatorRewardPercentage) public onlyOwner {
        if (_operatorRewardPercentage > 10000) revert InvalidPercentage();
        _updateStrategyRewards();
        operatorRewardPercentage = _operatorRewardPercentage;
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
     */
    function _updateStrategyRewards() private {
        address[] memory strategies = stakingPool.getStrategies();
        uint256[] memory strategyIdxs = new uint256[](strategies.length);
        for (uint256 i = 0; i < strategies.length; i++) {
            strategyIdxs[i] = i;
        }
        stakingPool.updateStrategyRewards(strategyIdxs);
    }
}
