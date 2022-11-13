// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@prb/math/contracts/PRBMathUD60x18.sol";

import "./base/RewardsPoolController.sol";
import "./interfaces/IPoolRouter.sol";

/**
 * @title Lending Pool
 * @notice Allows users to stake allowance tokens, stakers receive a percentage of earned rewards
 */
contract LendingPool is RewardsPoolController {
    using SafeERC20 for IERC20;
    using PRBMathUD60x18 for uint;

    IERC20 public immutable allowanceToken;
    IPoolRouter public immutable poolRouter;

    uint public rateConstantA;
    uint public rateConstantB;
    uint public rateConstantC;
    uint public rateConstantD;
    uint public rateConstantE;

    event AllowanceStaked(address indexed user, uint amount);
    event AllowanceWithdrawn(address indexed user, uint amount);
    event RateConstantsSet(
        uint _rateConstantA,
        uint _rateConstantB,
        uint _rateConstantC,
        uint _rateConstantD,
        uint _rateConstantE
    );

    constructor(
        address _allowanceToken,
        string memory _dTokenName,
        string memory _dTokenSymbol,
        address _poolRouter,
        uint _rateConstantA,
        uint _rateConstantB,
        uint _rateConstantC,
        uint _rateConstantD,
        uint _rateConstantE
    ) RewardsPoolController(_dTokenName, _dTokenSymbol) {
        allowanceToken = IERC20(_allowanceToken);
        poolRouter = IPoolRouter(_poolRouter);
        setRateConstants(_rateConstantA, _rateConstantB, _rateConstantC, _rateConstantD, _rateConstantE);
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
        uint allowanceInUse = poolRouter.allowanceInUse(_token, _index);
        return _currentRate(allowanceInUse.div(totalSupply()));
    }

    /**
     * @notice returns the current fee rate based on a specified percentage
     * @dev 1 ether = 100%, 0.5 ether = 50% etc
     * @param _percentageBorrowed the percentage borrowed for fee calculation
     * @return current rate
     **/
    function currentRateAt(uint _percentageBorrowed) public view returns (uint) {
        return _currentRate(_percentageBorrowed);
    }

    /**
     * @notice calculates the amount of allowance tokens available for withdrawal
     * @return available allowance tokens
     **/
    function availableAllowance() public view returns (uint) {
        return totalSupply() - poolRouter.maxAllowanceInUse();
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

        require(toWithdraw <= availableAllowance(), "Insufficient allowance available for withdrawal");

        _burn(msg.sender, toWithdraw);
        allowanceToken.safeTransfer(msg.sender, toWithdraw);

        emit AllowanceWithdrawn(msg.sender, toWithdraw);
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
     * @notice sets the constants used for calculating current rate
     * @param _rateConstantA value to set for rateA
     * @param _rateConstantB value to set for rateB
     * @param _rateConstantC value to set for rateC
     * @param _rateConstantD value to set for rateD
     * @param _rateConstantE value to set for rateE
     **/
    function setRateConstants(
        uint _rateConstantA,
        uint _rateConstantB,
        uint _rateConstantC,
        uint _rateConstantD,
        uint _rateConstantE
    ) public onlyOwner {
        require(_rateConstantA > 0 && _rateConstantB > 0 && _rateConstantC > 0, "Rate constants A, B and C cannot be zero");

        rateConstantA = _rateConstantA;
        rateConstantB = _rateConstantB;
        rateConstantC = _rateConstantC;
        rateConstantD = _rateConstantD;
        rateConstantE = _rateConstantE;

        emit RateConstantsSet(_rateConstantA, _rateConstantB, _rateConstantC, _rateConstantD, _rateConstantE);
    }

    /**
     * @notice stakes allowance tokens for lending
     * @param _amount amount to stake
     **/
    function _stakeAllowance(address _sender, uint _amount) private updateRewards(_sender) {
        _mint(_sender, _amount);
        emit AllowanceStaked(_sender, _amount);
    }

    /**
     * @notice calculates the current percentage of rewards that lenders
     * receive and borrowers pay. Fee cap of 95% hardcoded.
     * @dev Equation: y = (A*x/B)^C + x/D + E
     * @return current rate
     **/
    function _currentRate(uint _percentageBorrowed) private view returns (uint) {
        if (_percentageBorrowed == 0) {
            return rateConstantE * 100;
        }
        uint x = _percentageBorrowed;
        uint y = x.div(rateConstantB).mul(rateConstantA * 100).powu(rateConstantC);
        if (rateConstantD > 1) {
            y = y + (x * 100).div(rateConstantD).toUint();
        }
        y = y / 1e16 + rateConstantE * 100;

        if (y > 9500) {
            return 9500;
        }
        return y;
    }
}
