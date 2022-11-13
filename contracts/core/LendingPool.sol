// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./base/RewardsPoolController.sol";
import "./interfaces/IPoolRouter.sol";
import "./interfaces/IFeeCurve.sol";

/**
 * @title Lending Pool
 * @notice Allows users to stake allowance tokens, stakers receive a percentage of earned rewards
 */
contract LendingPool is RewardsPoolController {
    using SafeERC20 for IERC20;

    IERC20 public immutable allowanceToken;
    IPoolRouter public immutable poolRouter;
    IFeeCurve public feeCurve;

    event AllowanceStaked(address indexed user, uint amount);
    event AllowanceWithdrawn(address indexed user, uint amount);

    constructor(
        address _allowanceToken,
        string memory _dTokenName,
        string memory _dTokenSymbol,
        address _poolRouter,
        address _feeCurve
    ) RewardsPoolController(_dTokenName, _dTokenSymbol) {
        allowanceToken = IERC20(_allowanceToken);
        poolRouter = IPoolRouter(_poolRouter);
        feeCurve = IFeeCurve(_feeCurve);
    }

    /**
     * @notice ERC677 implementation to stake allowance or distribute rewards
     * @param _sender of the stake
     * @param _value of the token transfer
     **/
    function onTokenTransfer(
        address _sender,
        uint _value,
        bytes calldata
    ) external override {
        require(
            msg.sender == address(allowanceToken) || isTokenSupported(msg.sender),
            "Sender must be allowance or rewards token"
        );

        if (msg.sender == address(allowanceToken)) {
            _stakeAllowance(_sender, _value);
        } else {
            distributeToken(msg.sender);
        }
    }

    /**
     * @notice returns the current fee rate based on the % of allowance token borrowed
     * @param _token the token address of the pool
     * @param _index the pool index
     * @return current rate
     **/
    function currentRate(address _token, uint16 _index) public view returns (uint) {
        return feeCurve.currentRate(poolRouter.poolUtilisation(_token, _index));
    }

    /**
     * @notice returns the current fee rate based on a specified percentage
     * @dev 1 ether = 100%, 0.5 ether = 50% etc
     * @param _percentageBorrowed the percentage borrowed for fee calculation
     * @return current rate
     **/
    function currentRateAt(uint _percentageBorrowed) public view returns (uint) {
        return feeCurve.currentRate(_percentageBorrowed);
    }

    /**
     * @notice withdraws lent allowance tokens if there are enough available
     * @param _amount amount to withdraw
     **/
    function withdrawAllowance(uint _amount) external updateRewards(msg.sender) {
        require(!poolRouter.isReservedMode(), "Allowance cannot be withdrawn when pools are reserved");

        uint toWithdraw = _amount;
        if (_amount == type(uint).max) {
            toWithdraw = balanceOf(msg.sender);
        }

        _burn(msg.sender, toWithdraw);
        allowanceToken.safeTransfer(msg.sender, toWithdraw);

        emit AllowanceWithdrawn(msg.sender, toWithdraw);
    }

    /**
     * @notice sets the fee curve interface
     * @param _feeCurve interface
     */
    function setFeeCurve(address _feeCurve) external onlyOwner {
        require(_feeCurve != address(0), "Invalid fee curve address");
        feeCurve = IFeeCurve(_feeCurve);
    }

    /**
     * @notice stakes allowane tokens for an account
     * @dev used by pool router
     * @param _account account to stake for
     * @param _amount amount to stake
     **/
    function stakeAllowance(address _account, uint _amount) external {
        require(msg.sender == address(poolRouter), "Sender is not pool router");
        allowanceToken.safeTransferFrom(msg.sender, address(this), _amount);
        _stakeAllowance(_account, _amount);
    }

    /**
     * @notice stakes allowance tokens for lending
     * @param _amount amount to stake
     **/
    function _stakeAllowance(address _sender, uint _amount) private updateRewards(_sender) {
        _mint(_sender, _amount);
        emit AllowanceStaked(_sender, _amount);
    }
}
