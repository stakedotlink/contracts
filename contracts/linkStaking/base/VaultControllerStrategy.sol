// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../../core/interfaces/IERC677.sol";
import "../../core/base/Strategy.sol";
import "../interfaces/IVault.sol";
import "../interfaces/IStaking.sol";

/**
 * @title Vault Controller Strategy
 * @notice Base strategy for managing multiple Chainlink staking vaults
 */
abstract contract VaultControllerStrategy is Strategy {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct Fee {
        address receiver;
        uint basisPoints;
    }

    IStaking public stakeController;
    Fee[] internal fees;

    address public vaultImplementation;

    IVault[] internal vaults;
    uint internal totalDeposits;
    uint internal bufferedDeposits;
    uint public minDepositThreshold;

    uint[10] private __gap;

    event MigratedVaults(uint startIndex, uint numVaults, bytes data);
    event UpgradedVaults(uint startIndex, uint numVaults, bytes data);
    event SetMinDepositThreshold(uint minDepositThreshold);
    event SetVaultImplementation(address vaultImplementation);

    function __VaultControllerStrategy_init(
        address _token,
        address _stakingPool,
        address _stakeController,
        address _vaultImplementation,
        uint _minDepositThreshold,
        Fee[] memory _fees
    ) public onlyInitializing {
        __Strategy_init(_token, _stakingPool);

        require(_isContract(_vaultImplementation), "Vault implementation address must belong to a contract");
        vaultImplementation = _vaultImplementation;

        stakeController = IStaking(_stakeController);
        minDepositThreshold = _minDepositThreshold;
        for (uint i = 0; i < _fees.length; i++) {
            fees.push(_fees[i]);
        }
    }

    /**
     * @notice returns a list of all vaults
     * @return vaults list of vault addresses
     */
    function getVaults() external view returns (IVault[] memory) {
        return vaults;
    }

    /**
     * @notice deposits tokens into this strategy
     * @param _amount amount to deposit
     */
    function deposit(uint256 _amount) external onlyStakingPool {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        totalDeposits += _amount;
        bufferedDeposits += _amount;
    }

    /**
     * @notice withdrawals are not yet implemented in this iteration of Chainlink staking
     */
    function withdraw(uint256) external view onlyStakingPool {
        revert("withdrawals not yet implemented");
    }

    function checkUpkeep(bytes calldata) external view returns (bool, bytes memory) {
        if (!stakeController.isActive() || stakeController.isPaused()) {
            return (false, bytes(""));
        }
        if (bufferedDeposits < minDepositThreshold) {
            return (false, bytes(""));
        }

        (, uint vaultMaxDeposits) = getVaultDepositLimits();
        uint firstNonFullVault;

        for (uint i = 0; i < vaults.length; i++) {
            uint vaultDeposits = vaults[i].getPrincipalDeposits();

            if (vaultDeposits < vaultMaxDeposits) {
                firstNonFullVault = i;
                break;
            }
        }

        return (true, abi.encode(firstNonFullVault));
    }

    /**
     * @notice deposits buffered tokens into vaults if buffered balance exceeds minDepositThreshold
     * @param _performData abi encoded index of first non-full vault
     */
    function performUpkeep(bytes calldata _performData) external {
        require(bufferedDeposits >= minDepositThreshold, "Minimum deposit threshold has not been met");
        uint startIndex = abi.decode(_performData, (uint));
        depositBufferedTokens(startIndex);
    }

    /**
     * @notice deposits buffered tokens into vaults
     * @param _startIndex index of first non-full vault
     */
    function depositBufferedTokens(uint _startIndex) public {
        (uint vaultMinDeposits, uint vaultMaxDeposits) = getVaultDepositLimits();
        require(
            _startIndex == vaults.length - 1 || vaults[_startIndex].getPrincipalDeposits() < vaultMaxDeposits,
            "Cannot deposit into vault that is full"
        );
        require(
            _startIndex == 0 || vaults[_startIndex - 1].getPrincipalDeposits() >= vaultMaxDeposits,
            "Cannot deposit into vault if lower index vault is not full"
        );

        _depositBufferedTokens(_startIndex, bufferedDeposits, vaultMinDeposits, vaultMaxDeposits);
    }

    /**
     * @notice returns the deposit change (positive/negative) since deposits were last updated
     * @return int deposit change
     */
    function depositChange() public view returns (int) {
        uint totalBalance = token.balanceOf(address(this));
        for (uint i = 0; i < vaults.length; i++) {
            totalBalance += vaults[i].getTotalDeposits();
        }
        return int(totalBalance) - int(totalDeposits);
    }

    /**
     * @notice updates the total amount deposited for reward distribution
     * @return receivers list of fee receivers
     * @return amounts list of fee amounts
     */
    function updateDeposits() external onlyStakingPool returns (address[] memory receivers, uint[] memory amounts) {
        receivers = new address[](fees.length);
        amounts = new uint[](fees.length);

        for (uint i = 0; i < fees.length; i++) {
            receivers[i] = fees[i].receiver;
            amounts[i] = fees[i].basisPoints;
        }

        int balanceChange = depositChange();
        if (balanceChange > 0) {
            totalDeposits += uint(balanceChange);
        } else if (balanceChange < 0) {
            totalDeposits -= uint(balanceChange * -1);
        }
    }

    /**
     * @notice the amount of total deposits as tracked in this strategy
     * @return uint total deposited
     */
    function getTotalDeposits() public view override returns (uint) {
        return totalDeposits;
    }

    /**
     * @notice returns the vault deposit limits
     * @return minimum minimum amount of deposits that a vault can hold
     * @return maximum maximum amount of deposits that a vault can hold
     */
    function getVaultDepositLimits() public view virtual returns (uint, uint);

    /**
     * @notice migrates vaults to a new stake controller
     * @param _startIndex index of first vault to migrate
     * @param _numVaults number of vaults to migrate starting at _startIndex
     * @param _data migration data
     */
    function migrateVaults(
        uint _startIndex,
        uint _numVaults,
        bytes calldata _data
    ) external onlyOwner {
        for (uint i = _startIndex; i < _startIndex + _numVaults; i++) {
            vaults[i].migrate(_data);
        }
        emit MigratedVaults(_startIndex, _numVaults, _data);
    }

    /**
     * @notice upgrades vaults to a new implementation contract
     * @param _startIndex index of first vault to upgrade
     * @param _numVaults number of vaults to upgrade starting at _startIndex
     * @param _data optional encoded function call to be executed after upgrade
     */
    function upgradeVaults(
        uint _startIndex,
        uint _numVaults,
        bytes memory _data
    ) external onlyOwner {
        for (uint i = _startIndex; i < _startIndex + _numVaults; i++) {
            _upgradeVault(i, _data);
        }
        emit UpgradedVaults(_startIndex, _numVaults, _data);
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
     * @notice sets the minimum buffered token balance needed to initiate a deposit into vaults
     * @dev should always be >= to minimum vault deposit limit
     * @param _minDepositThreshold mimumum token balance
     **/
    function setMinDepositThreshold(uint _minDepositThreshold) external onlyOwner {
        (uint vaultMinDeposits, ) = getVaultDepositLimits();
        require(_minDepositThreshold >= vaultMinDeposits, "Must be >= to minimum vault deposit limit");
        minDepositThreshold = _minDepositThreshold;
        emit SetMinDepositThreshold(_minDepositThreshold);
    }

    /**
     * @notice sets a new vault implementation contract to be used when deploying/upgrading vaults
     * @param _vaultImplementation address of implementaion contract
     */
    function setVaultImplementation(address _vaultImplementation) external onlyOwner {
        require(_isContract(_vaultImplementation), "Address must belong to a contract");
        vaultImplementation = _vaultImplementation;
        emit SetVaultImplementation(_vaultImplementation);
    }

    /**
     * @notice deposits buffered tokens into vaults
     * @param _startIndex index of first vault to deposit into
     * @param _toDeposit amount to deposit
     * @param _vaultMinDeposits minimum amount of deposits that a vault can hold
     * @param _vaultMaxDeposits minimum amount of deposits that a vault can hold
     */
    function _depositBufferedTokens(
        uint _startIndex,
        uint _toDeposit,
        uint _vaultMinDeposits,
        uint _vaultMaxDeposits
    ) internal virtual;

    /**
     * @notice deposits tokens into vaults
     * @param _startIndex index of first vault to deposit into
     * @param _toDeposit amount to deposit
     * @param _minDeposits minimum amount of deposits that a vault can hold
     * @param _maxDeposits minimum amount of deposits that a vault can hold
     */
    function _depositToVaults(
        uint _startIndex,
        uint _toDeposit,
        uint _minDeposits,
        uint _maxDeposits
    ) internal returns (uint) {
        uint toDeposit = _toDeposit;
        for (uint i = _startIndex; i < vaults.length; i++) {
            IVault vault = vaults[i];
            uint deposits = vault.getPrincipalDeposits();
            uint canDeposit = _maxDeposits - deposits;

            if (deposits < _minDeposits && toDeposit < (_minDeposits - deposits)) {
                break;
            } else if (toDeposit > canDeposit) {
                vault.deposit(canDeposit);
                toDeposit -= canDeposit;
            } else {
                vault.deposit(toDeposit);
                toDeposit = 0;
                break;
            }
        }
        return _toDeposit - toDeposit;
    }

    /**
     * @notice deploys a new vault
     * @param _data optional encoded function call to be executed after deployment
     */
    function _deployVault(bytes memory _data) internal {
        address vault = address(new ERC1967Proxy(vaultImplementation, _data));
        token.safeApprove(vault, type(uint).max);
        vaults.push(IVault(vault));
    }

    /**
     * @notice upgrades a vault
     * @param _vaultIdx index of vault to upgrade
     * @param _data optional encoded function call to be executed after upgrade
     */
    function _upgradeVault(uint _vaultIdx, bytes memory _data) internal {
        IVault vault = vaults[_vaultIdx];
        if (_data.length == 0) {
            vault.upgradeTo(vaultImplementation);
        } else {
            vault.upgradeToAndCall(vaultImplementation, _data);
        }
    }

    /**
     * @notice returns whether an address belongs to a contract
     * @param _address address to check
     * @return isContract true if address is contract
     */
    function _isContract(address _address) private view returns (bool) {
        uint256 length;
        assembly {
            length := extcodesize(_address)
        }
        return length > 0;
    }
}
