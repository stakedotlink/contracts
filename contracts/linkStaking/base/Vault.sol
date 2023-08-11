// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../../core/interfaces/IERC677.sol";
import "../interfaces/IStaking.sol";

/**
 * @title Vault
 * @notice Base vault contract for depositing LINK collateral into the Chainlink staking controller
 */
abstract contract Vault is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    IERC20Upgradeable public token;
    address public vaultController;
    IStaking public stakeController;

    uint256[10] private __gap;

    error OnlyVaultController();

    /**
     * @notice initializes contract
     * @param _token address of LINK token
     * @param _vaultController address of the strategy that controls this vault
     * @param _stakeController address of Chainlink staking contract
     **/
    function __Vault_init(
        address _token,
        address _vaultController,
        address _stakeController
    ) public onlyInitializing {
        __Ownable_init();
        __UUPSUpgradeable_init();
        token = IERC20Upgradeable(_token);
        vaultController = _vaultController;
        stakeController = IStaking(_stakeController);
    }

    /**
     * @notice reverts if sender is not vaultController
     **/
    modifier onlyVaultController() {
        if (msg.sender != vaultController) revert OnlyVaultController();
        _;
    }

    /**
     * @notice deposits tokens from the vaultController into the Chainlink staking contract
     * @param _amount amount to deposit
     */
    function deposit(uint256 _amount) external virtual onlyVaultController {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        IERC677(address(token)).transferAndCall(address(stakeController), _amount, "0x");
    }

    /**
     * @notice withdrawals are not yet implemented in this iteration of Chainlink staking
     */
    function withdraw(uint256) external view onlyVaultController {
        revert("withdrawals not yet implemented");
    }

    /**
     * @notice returns the total balance of this contract in the Chainlink staking contract
     * @dev includes principal plus any rewards
     * @return total balance
     */
    function getTotalDeposits() public view virtual returns (uint256);

    /**
     * @notice returns the principal balance of this contract in the Chainlink staking contract
     * @return principal balance
     */
    function getPrincipalDeposits() public view returns (uint256) {
        return stakeController.getStake(address(this));
    }

    /**
     * @notice migrates the deposited tokens into a new Chainlink staking contract
     */
    function migrate(bytes calldata data) external onlyVaultController {
        stakeController.migrate(data);
        stakeController = IStaking(stakeController.getMigrationTarget());
    }

    /**
     * @dev Checks authorization for contract upgrades
     */
    function _authorizeUpgrade(address) internal override onlyOwner {}
}
