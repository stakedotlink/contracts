// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.11;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./RewardsPool.sol";
import "./interfaces/IStrategy.sol";

/**
 * @title Staking Pool
 * @dev Allows users to stake an asset and receive deriviatve tokens 1:1, then deposits staked
 * asset into strategy contracts to earn returns
 */
contract StakingPool is RewardsPool {
    using SafeERC20 for IERC677;

    uint8 public totalStrategies;
    uint public totalInStrategies;
    mapping(uint8 => address) public strategies;

    address public ownersRewardsPool;
    uint256 public ownersTakePercent;
    uint256 public ownersRewards;

    address public governance;

    event Staked(address indexed user, uint256 amount);
    event OwnersRewardsClaimed(uint256 amount);
    event StrategyRewardsClaimed(address indexed sender, uint256 amountStaked, uint256 amount, uint256 ownersTakePercent);

    constructor(
        address _rewardsToken,
        string memory _dTokenName,
        string memory _dTokenSymbol,
        address _ownersRewardsPool,
        uint256 _ownersTakePercent
    ) RewardsPool(address(this), _rewardsToken, _dTokenName, _dTokenSymbol) {
        ownersRewardsPool = _ownersRewardsPool;
        ownersTakePercent = _ownersTakePercent;
        governance = msg.sender;
    }

    modifier onlyGovernance() {
        require(governance == msg.sender, "Governance only");
        _;
    }

    /**
     * @dev calculates a user's total withdrawable balance (initial stake + earned rewards)
     * @param _account user to calculate rewards for
     * @return user's total withdrawable balance
     **/
    function balanceOf(address _account) public view override returns (uint256) {
        return
            (VirtualERC20.balanceOf(_account) * (rewardPerToken - userRewardPerTokenPaid[_account])) /
            1e18 +
            VirtualERC20.balanceOf(_account);
    }

    /**
     * @dev ERC677 implementation to receive a stake
     * @param _sender of the token transfer
     * @param _value of the token transfer
     **/
    function onTokenTransfer(
        address _sender,
        uint256 _value,
        bytes calldata
    ) external nonReentrant {
        require(msg.sender == address(rewardsToken), "Sender must be rewards token");
        _stake(_sender, _value);
    }

    /**
     * @dev stakes asset tokens and mints derivative tokens 1:1
     * @param _amount amount to stake
     **/
    function stake(uint256 _amount) public nonReentrant {
        rewardsToken.safeTransferFrom(msg.sender, address(this), _amount);
        _stake(msg.sender, _amount);
    }

    /**
     * @dev withdraws asset tokens and burns derivative tokens 1:1 (withdraws from
     * strategies if not enough liquidity)
     * @param _amount amount to withdraw
     **/
    function withdraw(uint256 _amount) public override {
        uint256 toWithdraw = _amount;
        if (_amount == type(uint256).max) {
            toWithdraw = balanceOf(msg.sender);
        }

        uint256 balance = rewardsToken.balanceOf(address(this));
        if (toWithdraw > balance) {
            _withdrawLiquidity(toWithdraw - balance);
        }
        require(rewardsToken.balanceOf(address(this)) >= toWithdraw, "Not enough liquidity available to withdraw");
        super.withdraw(toWithdraw);
    }

    /**
     * @dev claims owners share of rewards
     **/
    function claimOwnersRewards() external nonReentrant {
        require(ownersRewards > 0, "No rewards to claim");
        uint256 balance = rewardsToken.balanceOf(address(this));
        if (ownersRewards > balance) {
            _withdrawLiquidity(ownersRewards - balance);
        }
        rewardsToken.safeTransfer(ownersRewardsPool, ownersRewards);
        emit OwnersRewardsClaimed(ownersRewards);
        ownersRewards = 0;
    }

    /**
     * @dev claims earned rewards from all strategies
     **/
    function claimStrategyRewards() external nonReentrant {
        uint256 totalRewards;
        for (uint8 i = 0; i < totalStrategies; i++) {
            IStrategy strategy = IStrategy(strategies[i]);
            uint256 rewards = strategy.rewards();
            if (rewards > 0) {
                strategy.claimRewards();
                totalRewards += rewards;
            }
        }

        if (totalRewards > 0) {
            totalInStrategies += totalRewards;
            uint256 ownersTake = (totalRewards * ownersTakePercent) / 10000;
            ownersRewards = ownersRewards + ownersTake;
            _updateRewardPerToken(totalRewards - ownersTake);
            emit StrategyRewardsClaimed(
                msg.sender,
                totalInStrategies + rewardsToken.balanceOf(address(this)),
                totalRewards,
                ownersTakePercent
            );
        }
    }

    /**
     * @dev claims earned rewards from a strategy
     * @param _index index of strategy to claim from
     **/
    function claimSingleStrategyRewards(uint8 _index) public nonReentrant {
        require(_index < totalStrategies, "Strategy does not exist");
        IStrategy strategy = IStrategy(strategies[_index]);
        uint256 rewards = strategy.rewards();
        if (rewards > 0) {
            strategy.claimRewards();
            totalInStrategies += rewards;
            uint256 ownersTake = (rewards * ownersTakePercent) / 10000;
            ownersRewards += ownersTake;
            _updateRewardPerToken(rewards - ownersTake);

            emit StrategyRewardsClaimed(
                msg.sender,
                totalInStrategies + rewardsToken.balanceOf(address(this)),
                rewards,
                ownersTakePercent
            );
        }
    }

    /**
     * @dev deposits asset in a specific strategy
     * @param _index index of strategy to deposit in
     * @param _amount amount to deposit
     **/
    function strategyDeposit(uint8 _index, uint256 _amount) public onlyGovernance {
        require(_index < totalStrategies, "Strategy does not exist");
        IStrategy(strategies[_index]).deposit(_amount);
        totalInStrategies += _amount;
    }

    /**
     * @dev withdraws asset from specific strategy
     * @param _index index of strategy to withdraw from
     * @param _amount amount to withdraw
     **/
    function strategyWithdraw(uint8 _index, uint256 _amount) public onlyGovernance {
        require(_index < totalStrategies, "Strategy does not exist");
        IStrategy(strategies[_index]).withdraw(_amount);
        totalInStrategies -= _amount;
    }

    /**
     * @dev Adds a new strategy
     * @param _strategy address of strategy to add
     **/
    function addStrategy(address _strategy) external onlyGovernance {
        require(!_strategyExists(_strategy), "Strategy already exists");
        rewardsToken.safeApprove(_strategy, type(uint256).max);
        strategies[totalStrategies] = _strategy;
        totalStrategies += 1;
    }

    /**
     * @dev removes strategy at index
     * @param _index index of strategy to remove
     **/
    function removeStrategy(uint8 _index) external onlyGovernance {
        require(_index < totalStrategies, "Strategy does not exist");

        IStrategy strategy = IStrategy(strategies[_index]);
        claimSingleStrategyRewards(_index);
        uint totalStrategyDeposits = strategy.totalDeposits();
        if (totalStrategyDeposits > 0) {
            strategy.withdraw(totalStrategyDeposits);
            totalInStrategies -= totalStrategyDeposits;
        }

        for (uint8 i = _index; i < totalStrategies - 1; i++) {
            strategies[i] = strategies[i + 1];
        }
        delete strategies[totalStrategies - 1];
        totalStrategies--;
        rewardsToken.safeApprove(address(strategy), 0);
    }

    /**
     * @dev reorders strategies
     * @param _newOrder array containing new ordering of strategies
     **/
    function reorderStrategies(uint8[] calldata _newOrder) external onlyGovernance {
        require(_newOrder.length == totalStrategies, "newOrder.length must = totalStrategies");

        address[] memory strategyAddresses = new address[](totalStrategies);
        for (uint8 i = 0; i < totalStrategies; i++) {
            strategyAddresses[i] = strategies[i];
        }

        for (uint8 i = 0; i < totalStrategies; i++) {
            require(strategyAddresses[_newOrder[i]] != address(0), "all indices must be valid");
            strategies[i] = strategyAddresses[_newOrder[i]];
            strategyAddresses[_newOrder[i]] = address(0);
        }
    }

    /**
     * @dev sets governance address
     * @param _governance address to set
     **/
    function setGovernance(address _governance) external onlyGovernance {
        governance = _governance;
    }

    /**
     * @dev sets percentage of rewards that pool owners receive (units are % * 100)
     * @param _ownersTakePercent percentage to set
     **/
    function setOwnersTakePercent(uint256 _ownersTakePercent) external onlyGovernance {
        ownersTakePercent = _ownersTakePercent;
    }

    /**
     * @dev stakes asset tokens and mints derivative tokens 1:1
     * @param _sender of the stake
     * @param _amount amount to stake
     **/
    function _stake(address _sender, uint256 _amount) internal {
        require(totalStrategies > 0, "Must be > 0 strategies to stake");
        _updateReward(_sender);
        _mint(_sender, _amount);
        _depositLiquidity(_amount);
        emit Staked(_sender, _amount);
    }

    /**
     * @dev deposits available liquidity into strategies by order of priority
     * (deposits into strategies[0] until its limit is reached, then strategies[1], etc.)
     **/
    function _depositLiquidity(uint256 _amount) private {
        uint256 toDeposit = _amount;
        if (toDeposit > 0) {
            IStrategy strategy;
            for (uint8 i = 0; i < totalStrategies; i++) {
                strategy = IStrategy(strategies[i]);
                uint256 canDeposit = strategy.canDeposit();
                if (canDeposit > 0) {
                    if (canDeposit >= toDeposit) {
                        strategy.deposit(toDeposit);
                        toDeposit = 0;
                        break;
                    } else {
                        strategy.deposit(canDeposit);
                        toDeposit -= canDeposit;
                    }
                }
            }
            totalInStrategies += _amount - toDeposit;
        }
    }

    /**
     * @dev withdraws liquidity from strategies in opposite order of priority
     * (withdraws from strategies[totalStrategies - 1], then strategies[totalStrategies - 2], etc.
     * until withdraw amount is reached)
     * @param _amount amount to withdraw
     **/
    function _withdrawLiquidity(uint256 _amount) internal {
        require(_amount <= totalInStrategies, "Amount must be <= totalInStrategies");
        uint256 amountToWithdraw = _amount;

        for (uint8 i = totalStrategies; i > 0; i--) {
            IStrategy strategy = IStrategy(strategies[i - 1]);
            uint256 canWithdraw = strategy.canWithdraw();

            if (canWithdraw >= amountToWithdraw) {
                strategy.withdraw(amountToWithdraw);
                amountToWithdraw = 0;
                break;
            }
            if (canWithdraw > 0) {
                strategy.withdraw(canWithdraw);
                amountToWithdraw = amountToWithdraw - canWithdraw;
            }
        }
        totalInStrategies -= _amount - amountToWithdraw;
    }

    /**
     * @dev checks whether or not a strategy exists
     * @param _strategy address of strategy
     * @return true if strategy exists, false otherwise
     **/
    function _strategyExists(address _strategy) private view returns (bool) {
        for (uint8 i = 0; i < totalStrategies; i++) {
            if (strategies[i] == _strategy) {
                return true;
            }
        }
        return false;
    }
}
