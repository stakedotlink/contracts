// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/IERC721MetadataUpgradeable.sol";

import "../base/RewardsPoolController.sol";
import "../interfaces/IBoostController.sol";
import "../interfaces/IERC721Receiver.sol";

/**
 * @title SDL Pool
 * @notice Allows users to stake/lock SDL tokens and receive a percentage of the protocol's earned rewards
 */
contract SDLPool is RewardsPoolController, IERC721Upgradeable, IERC721MetadataUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct Lock {
        uint256 amount;
        uint256 boostAmount;
        uint64 startTime;
        uint64 duration;
        uint64 expiry;
    }

    string public name;
    string public symbol;

    mapping(address => mapping(address => bool)) private operatorApprovals;
    mapping(uint256 => address) private tokenApprovals;

    IERC20Upgradeable public sdlToken;
    IBoostController public boostController;

    uint256 public lastLockId;
    mapping(uint256 => Lock) private locks;
    mapping(uint256 => address) private lockOwners;
    mapping(address => uint256) private balances;

    uint256 public totalEffectiveBalance;
    mapping(address => uint256) private effectiveBalances;

    event InitiateUnlock(address indexed owner, uint256 indexed lockId, uint64 expiry);
    event Withdraw(address indexed owner, uint256 indexed lockId, uint256 amount);
    event CreateLock(
        address indexed owner,
        uint256 indexed lockId,
        uint256 amount,
        uint256 boostAmount,
        uint64 lockingDuration
    );
    event UpdateLock(
        address indexed owner,
        uint256 indexed lockId,
        uint256 amount,
        uint256 boostAmount,
        uint64 lockingDuration
    );

    error SenderNotAuthorized();
    error InvalidLockId();
    error InvalidAmount();
    error InvalidLockingDuration();
    error InvalidParams();
    error TransferFromIncorrectOwner();
    error TransferToZeroAddress();
    error TransferToNonERC721Implementer();
    error ApprovalToCurrentOwner();
    error ApprovalToCaller();
    error UnauthorizedToken();
    error TotalDurationNotElapsed();
    error HalfDurationNotElapsed();
    error InsufficientBalance();
    error UnlockNotInitiated();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory _name,
        string memory _symbol,
        address _sdlToken,
        address _boostController
    ) public initializer {
        __RewardsPoolController_init();
        name = _name;
        symbol = _symbol;
        sdlToken = IERC20Upgradeable(_sdlToken);
        boostController = IBoostController(_boostController);
    }

    modifier onlyLockOwner(uint256 _lockId, address _owner) {
        if (_owner != ownerOf(_lockId)) revert SenderNotAuthorized();
        _;
    }

    /**
     * @notice Returns the effective stake balance (including boost) of an account
     * @param _account address of account
     * @return effective stake balance
     **/
    function effectiveBalanceOf(address _account) external view returns (uint256) {
        return effectiveBalances[_account];
    }

    /**
     * @notice Returns the number of locks owned by an account
     * @param _account address of account
     * @return total number of locks owned by account
     **/
    function balanceOf(address _account) public view returns (uint256) {
        return balances[_account];
    }

    /**
     * @notice Returns the owner of a lock
     * @param _lockId id of the lock
     * @return lock owner
     **/
    function ownerOf(uint256 _lockId) public view returns (address) {
        address owner = lockOwners[_lockId];
        if (owner == address(0)) revert InvalidLockId();
        return owner;
    }

    /**
     * @notice Returns a list of locks corresponding to a list of lock ids
     * @param _lockIds list of lock ids
     * @return list of locks
     **/
    function getLocks(uint256[] calldata _lockIds) external view returns (Lock[] memory) {
        uint256 maxLockId = lastLockId;
        Lock[] memory retLocks = new Lock[](_lockIds.length);

        for (uint256 i = 0; i < _lockIds.length; ++i) {
            uint256 lockId = _lockIds[i];
            if (lockId == 0 || lockId > maxLockId) revert InvalidLockId();
            retLocks[i] = locks[lockId];
        }

        return retLocks;
    }

    /**
     * @notice Returns a list of lock ids owned by an account
     * @param _owner address of account
     * @return list of lock ids
     **/
    function getLockIdsByOwner(address _owner) external view returns (uint256[] memory) {
        uint256 maxLockId = lastLockId;
        uint256 lockCount = balanceOf(_owner);
        uint256 lockIdsFound;
        uint256[] memory lockIds = new uint256[](lockCount);

        for (uint256 i = 1; i <= maxLockId; ++i) {
            if (lockOwners[i] == _owner) {
                lockIds[lockIdsFound] = i;
                lockIdsFound++;
                if (lockIdsFound == lockCount) break;
            }
        }

        return lockIds;
    }

    /**
     * @notice ERC677 implementation to stake/lock SDL tokens or distribute rewards
     * @dev set lockId to 0 to create a new lock or > 0 to stake more into an existing lock,
     * set lockingDuration to 0 to stake without locking
     * @param _sender of the stake
     * @param _value of the token transfer
     * @param _calldata encoded lockId and lockingDuration
     **/
    function onTokenTransfer(
        address _sender,
        uint256 _value,
        bytes calldata _calldata
    ) external override {
        if (msg.sender != address(sdlToken) && !isTokenSupported(msg.sender)) revert UnauthorizedToken();

        if (_value == 0) revert InvalidAmount();

        if (msg.sender == address(sdlToken)) {
            (uint256 lockId, uint64 lockingDuration) = abi.decode(_calldata, (uint256, uint64));
            if (lockId > 0) {
                _updateLock(_sender, lockId, _value, lockingDuration);
            } else {
                _createLock(_sender, _value, lockingDuration);
            }
        } else {
            distributeToken(msg.sender);
        }
    }

    /**
     * @notice Extends the locking duration of a lock
     * @param _lockId id of lock
     * @param _lockingDuration new locking duration to set
     **/
    function extendLockDuration(uint256 _lockId, uint64 _lockingDuration) external {
        if (_lockingDuration == 0) revert InvalidLockingDuration();
        _updateLock(msg.sender, _lockId, 0, _lockingDuration);
    }

    /**
     * @notice Initiates the unlock period for a lock
     * @dev at least half of a lock's duration must have elapsed to initiate an unlock - the unlock period
     * also consists of half of the duration
     * @param _lockId id of lock
     **/
    function initiateUnlock(uint256 _lockId) external onlyLockOwner(_lockId, msg.sender) updateRewards(msg.sender) {
        uint64 halfDuration = locks[_lockId].duration / 2;
        if (locks[_lockId].startTime + halfDuration > block.timestamp) revert HalfDurationNotElapsed();

        uint64 expiry = uint64(block.timestamp) + halfDuration;
        locks[_lockId].expiry = expiry;

        uint256 boostAmount = locks[_lockId].boostAmount;
        locks[_lockId].boostAmount = 0;
        effectiveBalances[msg.sender] -= boostAmount;
        totalEffectiveBalance -= boostAmount;

        emit InitiateUnlock(msg.sender, _lockId, expiry);
    }

    /**
     * @notice Withdraws unlocked SDL
     * @dev SDL can only be withdrawn once the unlock period has expired
     * @param _lockId id of the lock
     * @param _amount amount to withdraw from the lock
     **/
    function withdraw(uint256 _lockId, uint256 _amount)
        external
        onlyLockOwner(_lockId, msg.sender)
        updateRewards(msg.sender)
    {
        uint64 expiry = locks[_lockId].expiry;
        if (expiry == 0) revert UnlockNotInitiated();
        if (expiry > block.timestamp) revert TotalDurationNotElapsed();

        uint256 baseAmount = locks[_lockId].amount;
        if (_amount > baseAmount) revert InsufficientBalance();

        emit Withdraw(msg.sender, _lockId, _amount);

        if (_amount == baseAmount) {
            delete locks[_lockId];
            delete lockOwners[_lockId];
            balances[msg.sender] -= 1;
            emit Transfer(msg.sender, address(0), _lockId);
        } else {
            locks[_lockId].amount = baseAmount - _amount;
        }

        effectiveBalances[msg.sender] -= _amount;
        totalEffectiveBalance -= _amount;

        sdlToken.safeTransfer(msg.sender, _amount);
    }

    /**
     * @notice Transfers a lock between accounts
     * @param _from address to transfer from
     * @param _to address to transfer to
     * @param _lockId id of lock to transfer
     **/
    function transferFrom(
        address _from,
        address _to,
        uint256 _lockId
    ) external {
        if (!_isApprovedOrOwner(msg.sender, _lockId)) revert SenderNotAuthorized();
        _transfer(_from, _to, _lockId);
    }

    /**
     * @notice Transfers a lock between accounts and validates that the receiver supports ERC721
     * @dev calls onERC721Received on the receiver contract if applicable
     * @param _from address to transfer from
     * @param _to address to transfer to
     * @param _lockId id of lock to transfer
     **/
    function safeTransferFrom(
        address _from,
        address _to,
        uint256 _lockId
    ) external {
        safeTransferFrom(_from, _to, _lockId, "");
    }

    /**
     * @notice Transfers a lock between accounts and validates that the receiver supports ERC721
     * @dev calls onERC721Received on the receiver contract if applicable
     * @param _from address to transfer from
     * @param _to address to transfer to
     * @param _lockId id of lock to transfer
     * @param _data optional data to pass to receiver
     **/
    function safeTransferFrom(
        address _from,
        address _to,
        uint256 _lockId,
        bytes memory _data
    ) public {
        if (!_isApprovedOrOwner(msg.sender, _lockId)) revert SenderNotAuthorized();
        _transfer(_from, _to, _lockId);
        if (!_checkOnERC721Received(_from, _to, _lockId, _data)) revert TransferToNonERC721Implementer();
    }

    /**
     * @notice Approves _to to transfer _lockId to another address
     * @dev approval is revoked on transfer, can also be revoked by approving zero address
     * @param _to address approved to transfer
     * @param _lockId id of lock
     **/
    function approve(address _to, uint256 _lockId) external {
        address owner = ownerOf(_lockId);

        if (_to == owner) revert ApprovalToCurrentOwner();
        if (msg.sender != owner && !isApprovedForAll(owner, msg.sender)) revert SenderNotAuthorized();

        tokenApprovals[_lockId] = _to;
        emit Approval(owner, _to, _lockId);
    }

    /**
     * @notice Returns the address approved to transfer a lock
     * @param _lockId id of lock
     * @return approved address
     **/
    function getApproved(uint256 _lockId) public view returns (address) {
        if (lockOwners[_lockId] == address(0)) revert InvalidLockId();

        return tokenApprovals[_lockId];
    }

    /**
     * @notice Approves _operator to transfer all tokens owned by sender
     * @dev approval will not be revoked until this function is called again with
     * _approved set to false
     * @param _operator address approved to transfer
     * @param _approved whether address is approved or not
     **/
    function setApprovalForAll(address _operator, bool _approved) external {
        address owner = msg.sender;
        if (owner == _operator) revert ApprovalToCaller();

        operatorApprovals[owner][_operator] = _approved;
        emit ApprovalForAll(owner, _operator, _approved);
    }

    /**
     * @notice Returns whether _operator is approved to transfer all tokens owned by _owner
     * @param _owner owner of tokens
     * @param _operator address approved to transfer
     * @return whether address is approved or not
     **/
    function isApprovedForAll(address _owner, address _operator) public view returns (bool) {
        return operatorApprovals[_owner][_operator];
    }

    /**
     * @notice Returns an account's staked amount for use by reward pools
     * controlled by this contract
     * @param _account account address
     * @return account's staked amount
     */
    function staked(address _account) external view override returns (uint256) {
        return effectiveBalances[_account];
    }

    /**
     * @notice Returns the total staked amount for use by reward pools
     * controlled by this contract
     * @return total staked amount
     */
    function totalStaked() external view override returns (uint256) {
        return totalEffectiveBalance;
    }

    /**
     * @notice Returns whether this contract supports an interface
     * @param _interfaceId id of interface
     * @return whether contract supports interface or not
     */
    function supportsInterface(bytes4 _interfaceId) external view returns (bool) {
        return
            _interfaceId == type(IERC721Upgradeable).interfaceId ||
            _interfaceId == type(IERC721MetadataUpgradeable).interfaceId ||
            _interfaceId == type(IERC165Upgradeable).interfaceId;
    }

    /**
     * @notice Required to conform to IERC721Metadata
     */
    function tokenURI(uint256) external view returns (string memory) {
        return "";
    }

    /**
     * @notice Sets the boost controller
     * @param _boostController address of boost controller
     */
    function setBoostController(address _boostController) external onlyOwner {
        boostController = IBoostController(_boostController);
    }

    /**
     * @notice Creates a new lock
     * @param _sender owner of lock
     * @param _amount amount to stake
     * @param _lockingDuration duration of lock
     */
    function _createLock(
        address _sender,
        uint256 _amount,
        uint64 _lockingDuration
    ) private updateRewards(_sender) {
        uint256 boostAmount = boostController.getBoostAmount(_amount, _lockingDuration);
        uint256 totalAmount = _amount + boostAmount;
        uint64 startTime = _lockingDuration != 0 ? uint64(block.timestamp) : 0;
        uint256 lockId = lastLockId + 1;

        locks[lockId] = Lock(_amount, boostAmount, startTime, _lockingDuration, 0);
        lockOwners[lockId] = _sender;
        balances[_sender] += 1;
        lastLockId++;

        effectiveBalances[_sender] += totalAmount;
        totalEffectiveBalance += totalAmount;

        emit CreateLock(_sender, lockId, _amount, boostAmount, _lockingDuration);
        emit Transfer(address(0), _sender, lockId);
    }

    /**
     * @notice Updates an existing lock
     * @param _sender owner of lock
     * @param _lockId id of lock
     * @param _amount additional amount to stake
     * @param _lockingDuration duration of lock
     */
    function _updateLock(
        address _sender,
        uint256 _lockId,
        uint256 _amount,
        uint64 _lockingDuration
    ) private onlyLockOwner(_lockId, _sender) updateRewards(_sender) {
        uint64 curLockingDuration = locks[_lockId].duration;
        if (_lockingDuration < curLockingDuration) revert InvalidLockingDuration();

        uint256 curBaseAmount = locks[_lockId].amount;

        uint256 baseAmount = curBaseAmount + _amount;
        uint256 boostAmount = boostController.getBoostAmount(baseAmount, _lockingDuration);

        if (_amount != 0) {
            locks[_lockId].amount = baseAmount;
        }

        if (_lockingDuration != curLockingDuration) {
            locks[_lockId].duration = _lockingDuration;
        }

        if (_lockingDuration != 0) {
            locks[_lockId].startTime = uint64(block.timestamp);
        }

        if (locks[_lockId].expiry != 0) {
            locks[_lockId].expiry = 0;
        }

        int256 diffTotalAmount = int256(baseAmount + boostAmount) - int256(curBaseAmount + locks[_lockId].boostAmount);
        if (diffTotalAmount > 0) {
            effectiveBalances[_sender] += uint256(diffTotalAmount);
            totalEffectiveBalance += uint256(diffTotalAmount);
        } else if (diffTotalAmount < 0) {
            effectiveBalances[_sender] -= uint256(-1 * diffTotalAmount);
            totalEffectiveBalance -= uint256(-1 * diffTotalAmount);
        }

        locks[_lockId].boostAmount = boostAmount;

        emit UpdateLock(_sender, _lockId, baseAmount, boostAmount, _lockingDuration);
    }

    /**
     * @notice transfers a lock between accounts
     * @param _from address to transfer from
     * @param _to address to transfer to
     * @param _lockId id of lock to transfer
     **/
    function _transfer(
        address _from,
        address _to,
        uint256 _lockId
    ) private {
        if (_from != ownerOf(_lockId)) revert TransferFromIncorrectOwner();
        if (_to == address(0)) revert TransferToZeroAddress();

        delete tokenApprovals[_lockId];

        _updateRewards(_from);
        _updateRewards(_to);

        uint256 effectiveBalanceChange = locks[_lockId].amount + locks[_lockId].boostAmount;
        effectiveBalances[_from] -= effectiveBalanceChange;
        effectiveBalances[_to] += effectiveBalanceChange;

        balances[_from] -= 1;
        balances[_to] += 1;

        lockOwners[_lockId] = _to;

        emit Transfer(_from, _to, _lockId);
    }

    /**
     * @notice Verifies that an address supports ERC721 and calls onERC721Received if applicable
     * @dev called after a lock is safe transferred
     * @param _from address that lock is being transferred from
     * @param _to address that lock is being transferred to
     * @param _lockId id of lock
     * @param _data optional data to be passed to receiver
     */
    function _checkOnERC721Received(
        address _from,
        address _to,
        uint256 _lockId,
        bytes memory _data
    ) private returns (bool) {
        if (_to.code.length > 0) {
            try IERC721Receiver(_to).onERC721Received(msg.sender, _from, _lockId, _data) returns (bytes4 retval) {
                return retval == IERC721Receiver.onERC721Received.selector;
            } catch (bytes memory reason) {
                if (reason.length == 0) {
                    revert TransferToNonERC721Implementer();
                } else {
                    assembly {
                        revert(add(32, reason), mload(reason))
                    }
                }
            }
        } else {
            return true;
        }
    }

    /**
     * @notice returns whether an account is authorized to transfer a lock
     * @param _spender address of account
     * @param _lockId id of lock
     * @return whether address is authorized ot not
     **/
    function _isApprovedOrOwner(address _spender, uint256 _lockId) private view returns (bool) {
        address owner = ownerOf(_lockId);
        return (_spender == owner || isApprovedForAll(owner, _spender) || getApproved(_lockId) == _spender);
    }
}