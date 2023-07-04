// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";

import "./interfaces/IStakingPool.sol";

/**
 * @title PoolRouter
 * @dev Acts as a proxy for staking pools
 */
contract PoolRouter is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    enum PoolStatus {
        OPEN,
        DRAINING,
        CLOSED
    }

    struct Pool {
        IERC20Upgradeable token;
        IStakingPool stakingPool;
        PoolStatus status;
    }

    mapping(bytes32 => Pool) private pools;
    mapping(address => uint16) public poolCountByToken;
    uint256 public poolCount;

    address[] public tokens;

    event StakeToken(address indexed token, address indexed pool, address indexed account, uint256 amount);
    event WithdrawToken(address indexed token, address indexed pool, address indexed account, uint256 amount);
    event AddPool(address indexed token, address indexed pool);
    event RemovePool(address indexed token, address indexed pool);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();
    }

    modifier poolExists(address _token, uint256 _index) {
        require(poolCountByToken[_token] > _index, "Pool does not exist");
        _;
    }

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
     * @return pool
     */
    function getPool(address _token, uint16 _index) public view returns (Pool memory) {
        return pools[_poolKey(_token, _index)];
    }

    /**
     * @notice Returns a list of all pools
     * @return poolList list of all pools
     **/
    function allPools() external view returns (Pool[] memory poolList) {
        poolList = new Pool[](poolCount);

        uint256 index = 0;
        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            for (uint16 j = 0; j < poolCountByToken[token]; j++) {
                poolList[index] = getPool(token, j);
                index++;
            }
        }
    }

    /**
     * @notice ERC677 implementation to receive a token stake
     * @param _sender of the token transfer
     * @param _value of the token transfer
     * @param _calldata pool index
     **/
    function onTokenTransfer(
        address _sender,
        uint256 _value,
        bytes calldata _calldata
    ) external {
        require(poolCountByToken[msg.sender] > 0, "Only callable by supported tokens");

        uint16 index = SafeCastUpgradeable.toUint16(_bytesToUint(_calldata));
        require(poolCountByToken[msg.sender] > index, "Pool does not exist");

        _stake(msg.sender, index, _sender, _value);
    }

    /**
     * @notice stakes tokens in a staking pool
     * @param _token token to stake
     * @param _index pool index
     * @param _amount amount to stake
     **/
    function stake(
        address _token,
        uint16 _index,
        uint256 _amount
    ) external {
        IERC20Upgradeable(_token).safeTransferFrom(msg.sender, address(this), _amount);
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
        uint256 _amount
    ) external poolExists(_token, _index) {
        _withdraw(_token, _index, _amount, msg.sender);
    }

    /**
     * @notice adds a new pool
     * @param _stakingPool staking pool address
     **/
    function addPool(address _stakingPool, PoolStatus _status) external onlyOwner {
        address token = IStakingPool(_stakingPool).token();
        require(
            address(getPool(token, IStakingPool(_stakingPool).poolIndex()).stakingPool) != _stakingPool,
            "Pool is already added"
        );
        uint16 tokenPoolCount = poolCountByToken[token];
        Pool storage pool = pools[_poolKey(token, tokenPoolCount)];

        poolCountByToken[token]++;
        poolCount++;
        if (tokenPoolCount == 0) {
            tokens.push(token);
        }

        pool.token = IERC20Upgradeable(token);
        pool.stakingPool = IStakingPool(_stakingPool);
        pool.status = _status;

        if (IERC20Upgradeable(token).allowance(address(this), _stakingPool) == 0) {
            IERC20Upgradeable(token).safeApprove(_stakingPool, type(uint256).max);
        }

        IStakingPool(_stakingPool).setPoolIndex(tokenPoolCount);

        emit AddPool(token, _stakingPool);
    }

    /**
     * @notice removes an existing pool
     * @param _token staking token
     * @param _index index of pool
     **/
    function removePool(address _token, uint16 _index) external onlyOwner poolExists(_token, _index) {
        Pool storage pool = pools[_poolKey(_token, _index)];
        require(pool.stakingPool.totalSupply() == 0, "Can only remove a pool with no active stake");

        emit RemovePool(_token, address(pool.stakingPool));

        IERC20Upgradeable(_token).safeApprove(address(pool.stakingPool), 0);

        uint16 lastPoolIndex = poolCountByToken[_token] - 1;

        if (_index != lastPoolIndex) {
            pools[_poolKey(_token, _index)] = pools[_poolKey(_token, lastPoolIndex)];
            pools[_poolKey(_token, _index)].stakingPool.setPoolIndex(_index);
        }

        delete pools[_poolKey(_token, lastPoolIndex)];
        poolCountByToken[_token]--;
        poolCount--;

        if (poolCountByToken[_token] == 0) {
            for (uint256 i = 0; i < tokens.length; i++) {
                if (tokens[i] == _token) {
                    tokens[i] = tokens[tokens.length - 1];
                    tokens.pop();
                    break;
                }
            }
        }
    }

    /**
     * @notice calculates the amount of stake an account can deposit
     * @param _token the token address used by the staking pool
     * @param _index pool index
     * @return amount that can be deposited
     **/
    function canDeposit(address _token, uint16 _index) public view poolExists(_token, _index) returns (uint256) {
        return getPool(_token, _index).stakingPool.canDeposit();
    }

    /**
     * @notice sets a pool's status
     * @param _token token address
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
     * @param _token token address
     * @param _index pool index
     */
    function setPoolStatusClosed(address _token, uint16 _index) external poolExists(_token, _index) onlyOwner {
        pools[_poolKey(_token, _index)].status = PoolStatus.CLOSED;
    }

    /**
     * @notice stakes tokens in a staking pool
     * @param _token token to stake
     * @param _index pool index
     * @param _account account to stake for
     * @param _amount amount to stake
     **/
    function _stake(
        address _token,
        uint16 _index,
        address _account,
        uint256 _amount
    ) private {
        Pool memory pool = getPool(_token, _index);

        require(pool.status == PoolStatus.OPEN, "Pool is not open");
        require(_amount <= canDeposit(_token, _index), "Insufficient deposit room");

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
        uint256 _amount,
        address _receiver
    ) private poolExists(_token, _index) {
        Pool memory pool = getPool(_token, _index);
        require(pool.status != PoolStatus.CLOSED, "Pool is closed");
        require(pool.stakingPool.balanceOf(msg.sender) >= _amount, "Amount exceeds staked balance");

        pool.stakingPool.withdraw(msg.sender, _receiver, _amount);

        emit WithdrawToken(_token, address(pool.stakingPool), msg.sender, _amount);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /**
     * @notice returns the pool key hash by token and index
     * @param _token token address
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
        for (uint256 i = 0; i < _bytes.length; i++) {
            number = number + uint256(uint8(_bytes[i])) * (2**(8 * (_bytes.length - (i + 1))));
        }
        return number;
    }
}
