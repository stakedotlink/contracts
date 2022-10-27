// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@prb/math/contracts/PRBMathUD60x18.sol";

import "./interfaces/IPoolRouter.sol";
import "./base/RewardsPoolController.sol";
import "./interfaces/IBorrowingPool.sol";
import "./interfaces/ILendingPool.sol";

/**
 * @title Lending Pool
 * @notice Allows users to lend allowance tokens to others who wish to stake,
 * borrowers pay lenders a percentage of earned rewards in return
 */
contract LendingPool is ILendingPool, RewardsPoolController {
    using SafeERC20 for IERC20;
    using PRBMathUD60x18 for uint256;

    IERC20 public immutable allowanceToken;
    IPoolRouter public immutable poolRouter;

    uint256 public rateConstantA;
    uint256 public rateConstantB;
    uint256 public rateConstantC;
    uint256 public rateConstantD;
    uint256 public rateConstantE;

    mapping(bytes32 => IBorrowingPool) public borrowingPools;
    bytes32[] public supportedPools;

    event AllowanceLent(address indexed user, uint256 amount);
    event AllowanceWithdrawn(address indexed user, uint256 amount);
    event Stake(
        address indexed token,
        uint16 indexed index,
        address indexed user,
        uint256 allowanceAmount,
        uint256 stakeAmount
    );
    event Withdraw(
        address indexed token,
        uint16 indexed index,
        address indexed user,
        uint256 allowanceAmount,
        uint256 withdrawalAmount
    );
    event PoolAdded(address indexed token, uint16 indexed index);
    event PoolRemoved(address indexed token, uint16 indexed index);
    event RateConstantsSet(
        uint256 _rateConstantA,
        uint256 _rateConstantB,
        uint256 _rateConstantC,
        uint256 _rateConstantD,
        uint256 _rateConstantE
    );

    constructor(
        address _allowanceToken,
        string memory _dTokenName,
        string memory _dTokenSymbol,
        address _poolRouter,
        uint256 _rateConstantA,
        uint256 _rateConstantB,
        uint256 _rateConstantC,
        uint256 _rateConstantD,
        uint256 _rateConstantE
    ) RewardsPoolController(_dTokenName, _dTokenSymbol) {
        allowanceToken = IERC20(_allowanceToken);
        poolRouter = IPoolRouter(_poolRouter);
        allowanceToken.safeApprove(_poolRouter, type(uint256).max);
        setRateConstants(_rateConstantA, _rateConstantB, _rateConstantC, _rateConstantD, _rateConstantE);
    }

    /**
     * @notice returns a boolean to whether a given pool is supported for allowance lending
     * @param _token pool token
     * @param _index pool index
     */
    function isPoolSupported(address _token, uint16 _index) external view returns (bool) {
        return address(borrowingPools[_poolKey(_token, _index)]) != address(0) ? true : false;
    }

    /**
     * @notice ERC677 implementation to lend allowance or stake
     * @param _sender of the stake
     * @param _value of the token transfer
     **/
    function onTokenTransfer(
        address _sender,
        uint256 _value,
        bytes calldata _calldata
    ) external override {
        require(
            msg.sender == address(allowanceToken) ||
                poolRouter.poolsByToken(msg.sender).length > 0 ||
                isTokenSupported(msg.sender),
            "Sender must be allowance or staking token"
        );
        if (msg.sender == address(allowanceToken)) {
            _lendAllowance(_sender, _value);
        } else if (poolRouter.poolsByToken(msg.sender).length > 0) {
            uint16 index = SafeCast.toUint16(_bytesToUint(_calldata));
            _stake(_sender, msg.sender, index, _value);
        } else {
            distributeToken(msg.sender);
        }
    }

    /**
     * @notice calculates the total amount that users can stake
     * @param _token the token address of the pool
     * @param _index the pool index
     * @return amount users can stake
     **/
    function canStake(address _token, uint16 _index) public view returns (uint256) {
        return poolRouter.availableStake(_token, _index, address(this));
    }

    /**
     * @notice returns the current fee rate based on the % of allowance token borrowed
     * @param _token the token address of the pool
     * @param _index the pool index
     * @return current rate
     **/
    function currentRate(address _token, uint16 _index) public view returns (uint256) {
        uint256 allowanceInUse = poolRouter.allowanceInUse(_token, _index, address(this));
        return _currentRate(allowanceInUse.div(allowanceInUse + availableAllowance(_token, _index)));
    }

    /**
     * @notice returns the current fee rate based on a specified percentage
     * @dev 1 ether = 100%, 0.5 ether = 50% etc
     * @param _percentageBorrowed the percentage borrowed for fee calculation
     * @return current rate
     **/
    function currentRateAt(uint _percentageBorrowed) public view returns (uint256) {
        return _currentRate(_percentageBorrowed);
    }

    /**
     * @notice calculates the amount of allowance tokens available for staking
     * in staking pool
     * @return available allowance tokens
     **/
    function availableAllowance(address _token, uint16 _index) public view returns (uint256) {
        return totalSupply() - poolRouter.allowanceInUse(_token, _index, address(this));
    }

    /**
     * @notice stakes allowance tokens for lending
     * @param _amount amount to lend
     **/
    function lendAllowance(uint256 _amount) external {
        allowanceToken.safeTransferFrom(msg.sender, address(this), _amount);
        _lendAllowance(msg.sender, _amount);
    }

    /**
     * @notice withdraws lent allowance tokens if there are enough available
     * @param _amount amount to withdraw
     **/
    function withdrawAllowance(uint256 _amount) external updateRewards(msg.sender) {
        uint256 toWithdraw = _amount;
        if (_amount == type(uint256).max) {
            toWithdraw = balanceOf(msg.sender);
        }

        _burn(msg.sender, toWithdraw);
        poolRouter.withdrawAllowance(toWithdraw);
        allowanceToken.safeTransfer(msg.sender, toWithdraw);

        emit AllowanceWithdrawn(msg.sender, toWithdraw);
    }

    /**
     * @notice stakes user asset tokens with available lent allowance tokens
     * in staking pool, mints derivative tokens 1:1
     * @param _token the token address of the pool
     * @param _index the pool index
     * @param _amount amount to stake
     **/
    function stake(
        address _token,
        uint16 _index,
        uint256 _amount
    ) public {
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
        _stake(msg.sender, _token, _index, _amount);
    }

    /**
     * @notice withdraws asset & allowance tokens from staking pool, burns
     * derivative tokens 1:1, transfers user withdrawn asset tokens
     * @param _token pool token address
     * @param _index pool index
     * @param _amount amount to withdraw
     **/
    function withdraw(
        address _token,
        uint16 _index,
        uint256 _amount
    ) public {
        IBorrowingPool borrowingPool = borrowingPools[_poolKey(_token, _index)];
        require(address(borrowingPool) != address(0), "Pool is not supported");

        uint256 toWithdraw = _amount;
        if (_amount == type(uint256).max) {
            toWithdraw = borrowingPool.balanceOf(msg.sender);
        }

        borrowingPool.withdraw(msg.sender, toWithdraw);
        poolRouter.withdraw(_token, _index, toWithdraw);
        IERC20(_token).safeTransfer(msg.sender, toWithdraw);

        emit Withdraw(_token, _index, msg.sender, poolRouter.allowanceRequired(_token, _index, toWithdraw), toWithdraw);
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
        uint256 _rateConstantA,
        uint256 _rateConstantB,
        uint256 _rateConstantC,
        uint256 _rateConstantD,
        uint256 _rateConstantE
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
     * @notice add a pool to be supported for allowance borrowing
     * @param _token token address of the pool
     * @param _index pool index
     * @param _borrowingPool address of the borrowing pool
     */
    function addPool(
        address _token,
        uint16 _index,
        address _borrowingPool
    ) external onlyOwner {
        address[] memory poolsByToken = poolRouter.poolsByToken(_token);
        require(poolsByToken.length > _index, "Pool is not supported by the router");

        bytes32 poolKey = _poolKey(_token, _index);
        borrowingPools[poolKey] = IBorrowingPool(_borrowingPool);
        supportedPools.push(poolKey);

        if (IERC20(_token).allowance(address(this), address(poolRouter)) == 0) {
            IERC20(_token).safeApprove(address(poolRouter), type(uint256).max);
        }

        emit PoolAdded(_token, _index);
    }

    /**
     * @notice remove a pool to be supported for allowance borrowing
     * @param _token token address of the pool
     * @param _index pool index
     */
    function removePool(address _token, uint16 _index) external onlyOwner {
        bytes32 poolKey = _poolKey(_token, _index);
        IBorrowingPool borrowingPool = borrowingPools[poolKey];

        require(address(borrowingPool) != address(0), "Pool is not supported");
        require(borrowingPool.totalSupply() == 0, "Pool cannot be removed when there's an active stake");

        delete (borrowingPools[poolKey]);
        for (uint i = 0; i < supportedPools.length; i++) {
            if (supportedPools[i] == poolKey) {
                supportedPools[i] = supportedPools[supportedPools.length - 1];
                supportedPools.pop();
                break;
            }
        }

        emit PoolRemoved(_token, _index);
    }

    /**
     * @notice stakes allowance tokens for lending
     * @param _amount amount to lend
     **/
    function _lendAllowance(address _sender, uint256 _amount) private updateRewards(_sender) {
        poolRouter.stakeAllowance(_amount);
        _mint(_sender, _amount);
        emit AllowanceLent(_sender, _amount);
    }

    /**
     * @notice stakes user asset tokens with available lent allowance tokens
     * in staking pool, mints derivative tokens 1:1
     * @param _sender the address of the stake sender
     * @param _token the token address of the pool
     * @param _index the pool index
     * @param _amount amount to stake
     **/
    function _stake(
        address _sender,
        address _token,
        uint16 _index,
        uint256 _amount
    ) internal {
        IBorrowingPool borrowingPool = borrowingPools[_poolKey(_token, _index)];

        require(address(borrowingPool) != address(0), "Pool is not supported");
        require(_amount <= poolRouter.availableStake(_token, _index, address(this)), "Not enough allowance available");

        borrowingPool.stake(_sender, _amount);
        poolRouter.stake(_token, _index, _amount);

        emit Stake(_token, _index, _sender, poolRouter.allowanceRequired(_token, _index, _amount), _amount);
    }

    /**
     * @notice returns the hashed pool key
     * @param _token pool token address
     * @param _index pool index
     * @return hash bytes32 hash of the pool key
     */
    function _poolKey(address _token, uint16 _index) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(_token, _index));
    }

    /**
     * @notice converts bytes to uint
     * @param _bytes to convert
     * @return uint256 result
     */
    function _bytesToUint(bytes memory _bytes) private pure returns (uint256) {
        uint256 number;
        for (uint i = 0; i < _bytes.length; i++) {
            number = number + uint(uint8(_bytes[i])) * (2**(8 * (_bytes.length - (i + 1))));
        }
        return number;
    }

    /**
     * @notice calculates the current percentage of rewards that lenders
     * receive and borrowers pay. Fee cap of 95% hardcoded.
     * @dev Equation: y = (A*x/B)^C + x/D + E
     * @return current rate
     **/
    function _currentRate(uint256 _percentageBorrowed) internal view returns (uint256) {
        if (_percentageBorrowed == 0) {
            return rateConstantE * 100;
        }
        uint256 x = _percentageBorrowed;
        uint256 y = x.div(rateConstantB).mul(rateConstantA * 100).powu(rateConstantC);
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
