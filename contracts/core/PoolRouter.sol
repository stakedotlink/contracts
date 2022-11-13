// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

import "./interfaces/IERC677.sol";
import "./interfaces/IStakingPool.sol";
import "./interfaces/ILendingPool.sol";
import "../ethStaking/interfaces/IWrappedETH.sol";

import "hardhat/console.sol";

/**
 * @title PoolRouter
 * @dev Handles staking allowances and acts as a proxy for staking pools
 */
contract PoolRouter is Ownable {
    using SafeERC20 for IERC677;

    enum PoolStatus {
        OPEN,
        DRAINING,
        CLOSED
    }

    struct Pool {
        IERC677 token;
        IStakingPool stakingPool;
        bool allowanceRequired;
        PoolStatus status;
        uint totalStaked;
    }

    IERC677 public immutable allowanceToken;
    ILendingPool public lendingPool;

    mapping(bytes32 => Pool) private pools;
    mapping(address => uint16) public poolCountByToken;
    uint public poolCount;

    address[] public tokens;
    address public wrappedETH;

    bool private reservedMode;
    uint private reservedMultiplier;

    event StakeToken(address indexed token, address indexed pool, address indexed account, uint amount);
    event WithdrawToken(address indexed token, address indexed pool, address indexed account, uint amount);
    event AddPool(address indexed token, address indexed pool);
    event RemovePool(address indexed token, address indexed pool);

    modifier poolExists(address _token, uint _index) {
        require(poolCountByToken[_token] > _index, "Pool does not exist");
        _;
    }

    constructor(address _allowanceToken, bool _reservedMode) {
        allowanceToken = IERC677(_allowanceToken);
        reservedMultiplier = 1e4;
        reservedMode = _reservedMode;
    }

    receive() external payable {}

    /**
     * @notice Returns a list of all supported tokens
     * @return list of tokens
     **/
    function supportedTokens() external view returns (address[] memory) {
        return tokens;
    }

    /**
     * @notice Returns a pool
     * @param _token pool token
     * @param _index pool index
     */
    function getPool(address _token, uint16 _index) external view returns (Pool memory) {
        return pools[_poolKey(_token, _index)];
    }

    /**
     * @notice Fetch a list of all pools
     * @return poolList list of all pools
     **/
    function allPools() external view returns (Pool[] memory poolList) {
        poolList = new Pool[](poolCount);

        uint index = 0;
        for (uint i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            for (uint16 j = 0; j < poolCountByToken[token]; j++) {
                poolList[index] = pools[_poolKey(token, j)];
                index++;
            }
        }
    }

    /**
     * @notice returns whether the pools are in reserved mode
     * @return reservedMode true/false
     */
    function isReservedMode() external view returns (bool) {
        return reservedMode;
    }

    /**
     * @notice returns the allocation multiplier while in reserved mode
     * @return reservedMultiplier multiplier
     */
    function getReservedMultiplier() external view returns (uint) {
        return reservedMultiplier;
    }

    /**
     * @notice ERC677 implementation to receive a token stake
     * @dev token and allowance can be staked simultaneously to ensure sender is able to fill
     * newly created deposit room
     * @param _sender of the token transfer
     * @param _value of the token transfer
     * @param _calldata abi encoded token address, token amount, and pool index for simultaneous staking
     * or pool index for single token staking
     **/
    function onTokenTransfer(
        address _sender,
        uint _value,
        bytes calldata _calldata
    ) external {
        require(
            msg.sender == address(allowanceToken) || poolCountByToken[msg.sender] > 0,
            "Only callable by supported tokens"
        );

        if (msg.sender == address(allowanceToken)) {
            (address token, uint tokenAmount, uint16 index) = abi.decode(_calldata, (address, uint, uint16));
            require(poolCountByToken[token] > index, "Pool does not exist");
            lendingPool.stakeAllowance(_sender, _value);
            IERC677(token).safeTransferFrom(_sender, address(this), tokenAmount);
            _stake(token, index, _sender, tokenAmount);
        } else {
            uint16 index = SafeCast.toUint16(_bytesToUint(_calldata));
            require(poolCountByToken[msg.sender] > index, "Pool does not exist");
            _stake(msg.sender, index, _sender, _value);
        }
    }

    /**
     * @notice stakes tokens in a staking pool
     * @param _token token to stake
     * @param _index index of pool to stake in
     * @param _amount amount to stake
     **/
    function stake(
        address _token,
        uint16 _index,
        uint _amount
    ) external poolExists(_token, _index) {
        IERC677(_token).safeTransferFrom(msg.sender, address(this), _amount);
        _stake(_token, _index, msg.sender, _amount);
    }

    /**
     * @notice withdraws tokens from a staking pool
     * @param _token token to withdraw
     * @param _index pool index
     * @param _amount amount to withdraw
     **/
    function withdraw(
        address _token,
        uint16 _index,
        uint _amount
    ) external poolExists(_token, _index) {
        _withdraw(_token, _index, _amount, msg.sender);
    }

    /**
     * @notice wraps ETH and stakes wrapped ETH in a staking pool
     * @param _index index of pool to stake in
     **/
    function stakeETH(uint16 _index) external payable poolExists(wrappedETH, _index) {
        IWrappedETH(wrappedETH).wrap{value: msg.value}();
        _stake(wrappedETH, _index, msg.sender, msg.value);
    }

    /**
     * @notice withdraws wrapped ETH from a staking pool and unwraps
     * @param _index pool index
     * @param _amount amount to withdraw
     **/
    function withdrawETH(uint16 _index, uint _amount) external poolExists(wrappedETH, _index) {
        _withdraw(wrappedETH, _index, _amount, address(this));
        IWrappedETH(wrappedETH).unwrap(_amount);
        (bool success, ) = payable(msg.sender).call{value: _amount}("");
        require(success, "ETH transfer failed");
    }

    /**
     * @notice adds a new pool
     * @param _token staking token to add
     * @param _stakingPool token staking pool
     * @param _allowanceRequired whether the pool requires allowance to stake
     **/
    function addPool(
        address _token,
        address _stakingPool,
        bool _allowanceRequired,
        PoolStatus _status
    ) external onlyOwner {
        poolCount++;
        uint16 tokenPoolCount = poolCountByToken[_token];
        Pool storage pool = pools[_poolKey(_token, tokenPoolCount)];

        poolCountByToken[_token]++;
        if (tokenPoolCount == 0) {
            tokens.push(_token);
        }

        pool.token = IERC677(_token);
        pool.stakingPool = IStakingPool(_stakingPool);
        pool.allowanceRequired = _allowanceRequired;
        pool.status = _status;

        if (IERC677(_token).allowance(address(this), _stakingPool) == 0) {
            IERC677(_token).safeApprove(_stakingPool, type(uint).max);
        }

        IStakingPool(_stakingPool).setPoolIndex(tokenPoolCount);

        emit AddPool(_token, _stakingPool);
    }

    /**
     * @notice removes an existing pool
     * @param _token staking token
     * @param _index index of pool to remove
     **/
    function removePool(address _token, uint16 _index) external onlyOwner poolExists(_token, _index) {
        Pool storage pool = pools[_poolKey(_token, _index)];
        require(pool.stakingPool.totalSupply() == 0, "Can only remove a pool with no active stake");

        emit RemovePool(_token, address(pool.stakingPool));

        uint16 lastPoolIndex = poolCountByToken[_token] - 1;

        if (_index != lastPoolIndex) {
            pools[_poolKey(_token, _index)] = pools[_poolKey(_token, lastPoolIndex)];
            pools[_poolKey(_token, _index)].stakingPool.setPoolIndex(_index);
        }

        delete pools[_poolKey(_token, lastPoolIndex)];
        poolCountByToken[_token]--;
        poolCount--;

        if (poolCountByToken[_token] == 0) {
            for (uint i = 0; i < tokens.length; i++) {
                if (tokens[i] == _token) {
                    tokens[i] = tokens[tokens.length - 1];
                    tokens.pop();
                    break;
                }
            }
        }
    }

    /**
     * @notice updates a given pool to whether allowance is needed or not
     * @param _token token address for the staking pool
     * @param _index pool index
     * @param _allowanceRequired bool whether allowance is required
     */
    function setAllowanceRequired(
        address _token,
        uint16 _index,
        bool _allowanceRequired
    ) external onlyOwner poolExists(_token, _index) {
        pools[_poolKey(_token, _index)].allowanceRequired = _allowanceRequired;
    }

    /**
     * @notice calculates the amount of stake that can be deposited based on allowance staked
     * @param _token the token address used by the staking pool
     * @param _index pool index
     * @return the amount of allowance tokens in use
     **/
    function canStake(
        address _account,
        address _token,
        uint16 _index
    ) public view poolExists(_token, _index) returns (uint) {
        Pool memory pool = pools[_poolKey(_token, _index)];
        if (!pool.allowanceRequired) {
            return type(uint).max;
        }

        uint maximumStake;
        uint availableAllowance = lendingPool.totalSupply() - allowanceInUse(_token, _index);
        if (availableAllowance == 0) {
            maximumStake = 0;
        } else {
            maximumStake =
                (1e18 * pool.stakingPool.maxDeposits()) /
                ((lendingPool.totalSupply() * 1e18) / availableAllowance);
        }
        return reservedMode ? _reservedAllocation(_account, _token, _index, maximumStake) : maximumStake;
    }

    /**
     * @notice calculates the maximum allowance in use across all pools
     * @return the amount of allowance tokens in use
     **/
    function maxAllowanceInUse() public view returns (uint) {
        uint usedAllowance;
        for (uint i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            for (uint16 j = 0; j < poolCountByToken[token]; j++) {
                usedAllowance = Math.max(allowanceInUse(token, j), usedAllowance);
            }
        }
        return usedAllowance;
    }

    /**
     * @notice calculates the amount of allowance tokens in use for a given staking pool
     * @param _token the token address used by the staking pool
     * @param _index pool index
     * @return the amount of allowance tokens in use
     **/
    function allowanceInUse(address _token, uint16 _index) public view returns (uint) {
        Pool memory pool = pools[_poolKey(_token, _index)];
        if (!pool.allowanceRequired) {
            return 0;
        }

        return (1e18 * pool.totalStaked) / ((1e18 * pool.stakingPool.maxDeposits()) / lendingPool.totalSupply());
    }

    /**
     * @notice sets a pool's status
     * @param _token pool token
     * @param _index pool index
     * @param _status pool status
     */
    function setPoolStatus(
        address _token,
        uint16 _index,
        PoolStatus _status
    ) external poolExists(_token, _index) onlyOwner {
        require(_status != PoolStatus.CLOSED, "Cannot set status to CLOSED");
        pools[_poolKey(_token, _index)].status = _status;
    }

    /**
     * @notice sets a pool's status to CLOSED
     * @param _token pool token
     * @param _index pool index
     */
    function setPoolStatusClosed(address _token, uint16 _index) external poolExists(_token, _index) onlyOwner {
        pools[_poolKey(_token, _index)].status = PoolStatus.CLOSED;
    }

    /**
     * @notice sets the wrapped ETH token
     * @dev must be set for ETH staking to work, can only be set once
     * @param _wrappedETH wrapped ETH token to set
     **/
    function setWrappedETH(address _wrappedETH) external onlyOwner {
        require(wrappedETH == address(0), "wrappedETH already set");
        wrappedETH = _wrappedETH;
        IERC677(_wrappedETH).safeApprove(_wrappedETH, type(uint).max);
    }

    /**
     * @notice sets the lending pool address
     * @dev must be set for pool router to work
     * @param _lendingPool lending pool address
     **/
    function setLendingPool(address _lendingPool) external onlyOwner {
        require(address(lendingPool) == address(0), "lendingPool already set");
        lendingPool = ILendingPool(_lendingPool);
        allowanceToken.safeApprove(_lendingPool, type(uint).max);
    }

    /**
     * @notice sets whether a pool is reserved by only the allowance stakers
     * @param _reservedMode whether it is reserved only
     **/
    function setReservedMode(bool _reservedMode) external onlyOwner {
        reservedMode = _reservedMode;
    }

    /**
     * @notice sets the multiplier for stake per allowance when the pool has reserved space for allowance stakers
     * @param _reservedMultiplier multiplier
     **/
    function setReservedSpaceMultiplier(uint _reservedMultiplier) external onlyOwner {
        require(_reservedMultiplier >= 1e4, "Invalid reserved space multiplier");
        reservedMultiplier = _reservedMultiplier;
    }

    /**
     * @notice stakes tokens in a staking pool
     * @param _token token to stake
     * @param _index index of pool to stake in
     * @param _account account to stake for
     * @param _amount amount to stake
     **/
    function _stake(
        address _token,
        uint16 _index,
        address _account,
        uint _amount
    ) private {
        Pool storage pool = pools[_poolKey(_token, _index)];

        require(pool.status == PoolStatus.OPEN, "Pool is not open");
        require(_amount <= canStake(_account, _token, _index), "Not enough allowance staked");

        pool.totalStaked += _amount;
        pool.stakingPool.stake(_account, _amount);

        emit StakeToken(_token, address(pool.stakingPool), _account, _amount);
    }

    /**
     * @notice withdraws tokens from a staking pool
     * @param _token token to withdraw
     * @param _index pool index
     * @param _amount amount to withdraw
     * @param _receiver address to receive tokens
     **/
    function _withdraw(
        address _token,
        uint16 _index,
        uint _amount,
        address _receiver
    ) private poolExists(_token, _index) {
        Pool storage pool = pools[_poolKey(_token, _index)];
        require(pool.status != PoolStatus.CLOSED, "Pool is closed");
        require(pool.stakingPool.balanceOf(msg.sender) >= _amount, "Amount exceeds staked balance");

        if (_amount > pool.totalStaked) {
            pool.totalStaked = 0;
        } else {
            pool.totalStaked -= _amount;
        }
        pool.stakingPool.withdraw(msg.sender, _receiver, _amount);

        emit WithdrawToken(_token, address(pool.stakingPool), msg.sender, _amount);
    }

    /**
     * @notice returns the reserved allocation for the user based on their amount of allocation staked in the lending pool.
     * If the user has no allowance staked, the public allocation is returned. The public allocation reduces the more allowance
     * stakers reserve their space.
     */
    function _reservedAllocation(
        address _account,
        address _token,
        uint16 _index,
        uint _maximumStake
    ) private view returns (uint) {
        Pool memory pool = pools[_poolKey(_token, _index)];

        if (lendingPool.balanceOf(_account) == 0) {
            return 0;
        }
        uint accountMaxStake = (((((1e18 * lendingPool.balanceOf(_account)) / lendingPool.totalSupply()) *
            pool.stakingPool.maxDeposits()) / 1e18) / 1e4) * reservedMultiplier;

        if (pool.stakingPool.balanceOf(_account) >= accountMaxStake) {
            return 0;
        }
        return (accountMaxStake > _maximumStake) ? _maximumStake : accountMaxStake - pool.stakingPool.balanceOf(_account);
    }

    /**
     * @notice returns the pool key hash by token and index
     * @param _token token
     * @param _index pool index
     * @return the hashed pool key
     */
    function _poolKey(address _token, uint16 _index) private pure returns (bytes32) {
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
}
