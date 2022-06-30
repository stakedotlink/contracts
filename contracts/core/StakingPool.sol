// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./base/StakingRewardsPool.sol";
import "./base/RewardsPoolController.sol";
import "./interfaces/IStrategy.sol";
import "./interfaces/IWrappedSDToken.sol";

/**
 * @title Staking Pool
 * @notice Allows users to stake an asset and receive deriviatve tokens 1:1, then deposits staked
 * assets into strategy contracts to earn returns
 */
contract StakingPool is StakingRewardsPool, RewardsPoolController {
    using SafeERC20 for IERC677;

    struct Fee {
        address receiver;
        uint basisPoints;
    }

    address[] private strategies;
    uint public totalStaked;

    Fee[] private fees;
    IWrappedSDToken public wsdToken;

    address public poolRouter;

    event Stake(address indexed account, uint amount);
    event Withdraw(address indexed account, uint amount);
    event UpdateStrategyRewards(address indexed account, uint totalStaked, int rewardsAmount, uint totalFees);

    constructor(
        address _token,
        string memory _derivativeTokenName,
        string memory _derivativeTokenSymbol,
        Fee[] memory _fees,
        address _poolRouter
    ) StakingRewardsPool(_token, _derivativeTokenName, _derivativeTokenSymbol) {
        for (uint i = 0; i < _fees.length; i++) {
            fees.push(_fees[i]);
        }
        poolRouter = _poolRouter;
    }

    modifier onlyRouter() {
        require(poolRouter == msg.sender, "PoolRouter only");
        _;
    }

    /**
     * @notice returns an account's stake balance for use by reward pools
     * controlled by this contract
     * @dev required by RewardsPoolController
     * @return account's balance
     */
    function rpcStaked(address _account) external view returns (uint) {
        return sharesOf(_account);
    }

    /**
     * @notice returns the total staked amount for use by reward pools
     * controlled by this contract
     * @dev required by RewardsPoolController
     * @return total staked amount
     */
    function rpcTotalStaked() external view returns (uint) {
        return totalShares;
    }

    /**
     * @notice returns a list of all active strategies
     * @return list of strategies
     */
    function getStrategies() external view returns (address[] memory) {
        return strategies;
    }

    /**
     * @notice returns a list of all fees
     * @return list of fees
     */
    function getFees() external view returns (Fee[] memory) {
        return fees;
    }

    /**
     * @notice stakes asset tokens and mints derivative tokens
     * @param _account account to stake for
     * @param _amount amount to stake
     **/
    function stake(address _account, uint _amount) external onlyRouter updateRewards(_account) {
        require(strategies.length > 0, "Must be > 0 strategies to stake");

        token.safeTransferFrom(msg.sender, address(this), _amount);
        _depositLiquidity(_amount);

        _mint(_account, _amount);
        totalStaked += _amount;

        emit Stake(_account, _amount);
    }

    /**
     * @notice withdraws asset tokens and burns derivative tokens
     * @dev will withdraw from strategies if not enough liquidity
     * @param _account account to withdraw for
     * @param _amount amount to withdraw
     **/
    function withdraw(address _account, uint _amount) external onlyRouter updateRewards(_account) {
        uint toWithdraw = _amount;
        if (_amount == type(uint).max) {
            toWithdraw = balanceOf(_account);
        }

        uint balance = token.balanceOf(address(this));
        if (toWithdraw > balance) {
            _withdrawLiquidity(toWithdraw - balance);
        }
        require(token.balanceOf(address(this)) >= toWithdraw, "Not enough liquidity available to withdraw");

        _burn(_account, toWithdraw);
        totalStaked -= toWithdraw;
        token.safeTransfer(_account, toWithdraw);

        emit Withdraw(_account, toWithdraw);
    }

    /**
     * @notice mints shares to a supported strategy
     * @param _amount amount of shares to mint
     **/
    function mintShares(uint _amount) external {
        require(_strategyExists(msg.sender), "Sender is not a supported strategy");
        _mintShares(msg.sender, _amount);
    }

    /**
     * @notice deposits assets in a strategy
     * @param _index index of strategy to deposit in
     * @param _amount amount to deposit
     **/
    function strategyDeposit(uint _index, uint _amount) external onlyOwner {
        require(_index < strategies.length, "Strategy does not exist");
        IStrategy(strategies[_index]).deposit(_amount);
    }

    /**
     * @notice withdraws assets from a strategy
     * @param _index index of strategy to withdraw from
     * @param _amount amount to withdraw
     **/
    function strategyWithdraw(uint _index, uint _amount) external onlyOwner {
        require(_index < strategies.length, "Strategy does not exist");
        IStrategy(strategies[_index]).withdraw(_amount);
    }

    /**
     * @notice adds a new strategy
     * @param _strategy address of strategy to add
     **/
    function addStrategy(address _strategy) external onlyOwner {
        require(!_strategyExists(_strategy), "Strategy already exists");
        token.safeApprove(_strategy, type(uint).max);
        strategies.push(_strategy);
    }

    /**
     * @notice removes a strategy
     * @param _index index of strategy to remove
     **/
    function removeStrategy(uint _index) external onlyOwner {
        require(_index < strategies.length, "Strategy does not exist");

        uint[] memory idxs = new uint[](1);
        idxs[0] = _index;
        updateStrategyRewards(idxs);

        IStrategy strategy = IStrategy(strategies[_index]);
        uint totalStrategyDeposits = strategy.totalDeposits();
        if (totalStrategyDeposits > 0) {
            strategy.withdraw(totalStrategyDeposits);
        }

        for (uint i = _index; i < strategies.length - 1; i++) {
            strategies[i] = strategies[i + 1];
        }
        strategies.pop();
        token.safeApprove(address(strategy), 0);
    }

    /**
     * @notice reorders strategies
     * @param _newOrder array containing strategy indexes in a new order
     **/
    function reorderStrategies(uint[] calldata _newOrder) external onlyOwner {
        require(_newOrder.length == strategies.length, "newOrder.length must = strategies.length");

        address[] memory strategyAddresses = new address[](strategies.length);
        for (uint i = 0; i < strategies.length; i++) {
            strategyAddresses[i] = strategies[i];
        }

        for (uint i = 0; i < strategies.length; i++) {
            require(strategyAddresses[_newOrder[i]] != address(0), "all indices must be valid");
            strategies[i] = strategyAddresses[_newOrder[i]];
            strategyAddresses[_newOrder[i]] = address(0);
        }
    }

    /**
     * @notice adds a new fee
     * @param _receiver receiver of fee
     * @param _feeBasisPoints fee in basis points
     **/
    function addFee(address _receiver, uint _feeBasisPoints) external onlyOwner {
        fees.push(Fee(_receiver, _feeBasisPoints));
    }

    /**
     * @notice updates an existing fee
     * @param _index index of fee
     * @param _receiver receiver of fee
     * @param _feeBasisPoints fee in basis points
     **/
    function updateFee(
        uint _index,
        address _receiver,
        uint _feeBasisPoints
    ) external onlyOwner {
        require(_index < fees.length, "Fee does not exist");

        if (_feeBasisPoints == 0) {
            fees[_index] = fees[fees.length - 1];
            fees.pop();
        } else {
            fees[_index].receiver = _receiver;
            fees[_index].basisPoints = _feeBasisPoints;
        }
    }

    /**
     * @notice sets the wrapped staking derivative token for this pool
     * @param _wsdToken wsd token to set
     * @dev must be set for contract to work, can only be set once
     **/
    function setWSDToken(address _wsdToken) external onlyOwner {
        require(address(wsdToken) == address(0), "wsdToken already set");
        wsdToken = IWrappedSDToken(_wsdToken);
        _approve(address(this), _wsdToken, type(uint).max);
    }

    /**
     * @notice updates rewards based on balance changes in strategies
     * @param _strategyIdxs indexes of strategies to update rewards for
     **/
    function updateStrategyRewards(uint[] memory _strategyIdxs) public {
        int totalRewards;
        uint totalFeeAmounts;
        uint feeCount;
        address[] memory receivers = new address[](_strategyIdxs.length * 3 + fees.length);
        uint[] memory feeAmounts = new uint[](_strategyIdxs.length * 3 + fees.length);

        for (uint i = 0; i < _strategyIdxs.length; i++) {
            IStrategy strategy = IStrategy(strategies[_strategyIdxs[i]]);
            int rewards = strategy.depositChange();
            if (rewards != 0) {
                (address[] memory strategyReceivers, uint[] memory strategyFeeAmounts) = strategy.updateDeposits();
                totalRewards += rewards;
                if (rewards > 0) {
                    for (uint i = 0; i < strategyReceivers.length; i++) {
                        receivers[feeCount] = (strategyReceivers[i]);
                        feeAmounts[feeCount] = (strategyFeeAmounts[i]);
                        totalFeeAmounts += strategyFeeAmounts[i];
                        feeCount++;
                    }
                }
            }
        }

        if (totalRewards != 0) {
            totalStaked = uint(int(totalStaked) + totalRewards);
        }

        if (totalRewards > 0) {
            for (uint i = 0; i < fees.length; i++) {
                receivers[feeCount] = fees[i].receiver;
                feeAmounts[feeCount] = (uint(totalRewards) * fees[i].basisPoints) / 10000;
                totalFeeAmounts += feeAmounts[feeCount];
                feeCount++;
            }
        }

        if (totalFeeAmounts > 0) {
            uint sharesToMint = (totalFeeAmounts * totalShares) / (totalStaked - totalFeeAmounts);
            _mintShares(address(this), sharesToMint);
            wsdToken.wrap(balanceOf(address(this)));

            for (uint i = 0; i < feeCount - 1; i++) {
                wsdToken.transferAndCall(receivers[i], getSharesByStake(feeAmounts[i]), "0x00");
            }
            wsdToken.transferAndCall(receivers[feeCount - 1], wsdToken.balanceOf(address(this)), "0x00");
        }

        emit UpdateStrategyRewards(msg.sender, totalStaked, totalRewards, totalFeeAmounts);
    }

    /**
     * @notice returns the total amount of assets staked in the pool
     * @return the total staked amount
     */
    function _totalStaked() internal view override returns (uint) {
        return totalStaked;
    }

    /**
     * @notice deposits available liquidity into strategies by order of priority
     * @dev deposits into strategies[0] until its limit is reached, then strategies[1], and so on
     * @param _amount amount to deposit
     **/
    function _depositLiquidity(uint _amount) private {
        uint toDeposit = _amount;
        if (toDeposit > 0) {
            for (uint i = 0; i < strategies.length; i++) {
                IStrategy strategy = IStrategy(strategies[i]);
                uint canDeposit = strategy.canDeposit();
                if (canDeposit >= toDeposit) {
                    strategy.deposit(toDeposit);
                    break;
                } else if (canDeposit > 0) {
                    strategy.deposit(canDeposit);
                    toDeposit -= canDeposit;
                }
            }
        }
    }

    /**
     * @notice withdraws liquidity from strategies in opposite order of priority
     * @dev withdraws from strategies[strategies.length - 1], then strategies[strategies.length - 2], and so on
     * until withdraw amount is reached
     * @param _amount amount to withdraw
     **/
    function _withdrawLiquidity(uint _amount) private {
        uint toWithdraw = _amount;

        for (uint i = strategies.length - 1; i >= 0; i--) {
            IStrategy strategy = IStrategy(strategies[i]);
            uint canWithdraw = strategy.canWithdraw();

            if (canWithdraw >= toWithdraw) {
                strategy.withdraw(toWithdraw);
                break;
            } else if (canWithdraw > 0) {
                strategy.withdraw(canWithdraw);
                toWithdraw -= canWithdraw;
            }
        }
    }

    /**
     * @notice checks whether or not a strategy exists
     * @param _strategy address of strategy
     * @return true if strategy exists, false otherwise
     **/
    function _strategyExists(address _strategy) private view returns (bool) {
        for (uint i = 0; i < strategies.length; i++) {
            if (strategies[i] == _strategy) {
                return true;
            }
        }
        return false;
    }
}
