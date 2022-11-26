// SPDX-License-Identifier: UNLICENSED
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

    uint[10] private __gap;

    function __Vault_init(
        address _token,
        address _vaultController,
        address _stakeController
    ) public initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();
        token = IERC20Upgradeable(_token);
        vaultController = _vaultController;
        stakeController = IStaking(_stakeController);
    }

    modifier onlyVaultController() {
        require(vaultController == msg.sender, "Vault controller only");
        _;
    }

    /**
     * @notice deposits the amount of token into the Chainlink staking contract
     * @param _amount amount to deposit
     */
    function deposit(uint256 _amount) external onlyVaultController {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        IERC677(address(token)).transferAndCall(address(stakeController), _amount, "0x00");
    }

    /**
     * @notice withdrawals are not yet implemented in this iteration of Chainlink staking
     */
    function withdraw(uint256) external view onlyVaultController {
        revert("withdrawals not yet implemented");
    }

    /**
     * @notice returns the total balance of this contract in the Chainlink staking contract
     * @return balance total balance
     */
    function getTotalDeposits() public view virtual returns (uint);

    /**
     * @notice returns the principal balance of this contract in the Chainlink staking contract
     * @return balance principal balance
     */
    function getPrincipalDeposits() public view returns (uint) {
        return stakeController.getStake(address(this));
    }

    /**
     * @notice migrates the tokens deposited into a new stake controller,
     */
    function migrate(bytes calldata data) external onlyVaultController {
        stakeController.migrate(data);
        stakeController = IStaking(stakeController.getMigrationTarget());
    }

    /**
     * @notice allows the vault controller to be set after deployment only if it was set as an empty
     * address on deploy
     * @param _vaultController new vault controller address
     */
    function setVaultController(address _vaultController) external onlyOwner {
        require(
            _vaultController != address(0) && vaultController == address(0),
            "Vault controller cannot be empty/controller is already set"
        );
        vaultController = _vaultController;
    }

    /**
     * @notice allows the stake controller to be set after deployment only if it was set as an empty
     * address on deploy
     * @param _stakeController new stake controller address
     */
    function setStakeController(address _stakeController) external onlyOwner {
        require(
            _stakeController != address(0) && address(stakeController) == address(0),
            "Stake controller cannot be empty/controller is already set"
        );
        stakeController = IStaking(_stakeController);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
