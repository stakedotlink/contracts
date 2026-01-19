// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/IEspressoStaking.sol";

/**
 * @title Espresso Staking Mock
 * @notice Mock contract for testing EspressoVault and EspressoStrategy
 * @dev Simulates the StakeTableV2 contract from Espresso Network
 */
contract EspressoStakingMock is IEspressoStaking {
    using SafeERC20 for IERC20;

    struct Undelegation {
        uint256 amount;
        uint256 unlocksAt;
    }

    struct Validator {
        uint256 totalDelegated;
        ValidatorStatus status;
    }

    IERC20 public token;
    uint256 public exitEscrowPeriod;

    // validator => delegator => delegated amount
    mapping(address => mapping(address => uint256)) public delegations;
    // validator => delegator => undelegation info
    mapping(address => mapping(address => Undelegation)) private _undelegations;
    // validator => validator info
    mapping(address => Validator) private _validators;

    event Delegated(address indexed delegator, address indexed validator, uint256 amount);
    event Undelegated(address indexed delegator, address indexed validator, uint256 amount, uint256 unlocksAt);
    event WithdrawalClaimed(address indexed delegator, address indexed validator, uint256 amount);
    event ValidatorExitClaimed(address indexed delegator, address indexed validator, uint256 amount);
    event ValidatorRegistered(address indexed validator);
    event ValidatorExited(address indexed validator);

    error NoUndelegationFound();
    error UndelegationNotReady();
    error InsufficientDelegation();
    error ValidatorNotExited();
    error NoDelegationFound();

    /**
     * @notice Initializes the mock contract
     * @param _token address of the staking token
     * @param _exitEscrowPeriod time in seconds before undelegated tokens can be withdrawn
     */
    constructor(address _token, uint256 _exitEscrowPeriod) {
        token = IERC20(_token);
        exitEscrowPeriod = _exitEscrowPeriod;
    }

    /**
     * @notice Registers a new validator
     * @param _validator address of the validator to register
     */
    function registerValidator(address _validator) external {
        _validators[_validator] = Validator({totalDelegated: 0, status: ValidatorStatus.Active});

        emit ValidatorRegistered(_validator);
    }

    /**
     * @notice Sets a validator's exit status
     * @param _validator address of the validator to exit
     */
    function exitValidator(address _validator) external {
        _validators[_validator].status = ValidatorStatus.Exited;

        emit ValidatorExited(_validator);
    }

    /**
     * @notice Delegates tokens to a validator
     * @param _validator address of the validator to delegate to
     * @param _amount amount of tokens to delegate
     */
    function delegate(address _validator, uint256 _amount) external override {
        token.safeTransferFrom(msg.sender, address(this), _amount);

        delegations[_validator][msg.sender] += _amount;
        _validators[_validator].totalDelegated += _amount;

        emit Delegated(msg.sender, _validator, _amount);
    }

    /**
     * @notice Undelegates tokens from a validator
     * @param _validator address of the validator to undelegate from
     * @param _amount amount of tokens to undelegate
     */
    function undelegate(address _validator, uint256 _amount) external override {
        if (delegations[_validator][msg.sender] < _amount) revert InsufficientDelegation();

        delegations[_validator][msg.sender] -= _amount;
        _validators[_validator].totalDelegated -= _amount;

        uint256 unlocksAt = block.timestamp + exitEscrowPeriod;
        _undelegations[_validator][msg.sender] = Undelegation({amount: _amount, unlocksAt: unlocksAt});

        emit Undelegated(msg.sender, _validator, _amount, unlocksAt);
    }

    /**
     * @notice Claims tokens after the undelegation period has passed
     * @param _validator address of the validator to claim from
     */
    function claimWithdrawal(address _validator) external override {
        Undelegation storage undelegation = _undelegations[_validator][msg.sender];

        if (undelegation.amount == 0) revert NoUndelegationFound();
        if (block.timestamp < undelegation.unlocksAt) revert UndelegationNotReady();

        uint256 amount = undelegation.amount;
        delete _undelegations[_validator][msg.sender];

        token.safeTransfer(msg.sender, amount);

        emit WithdrawalClaimed(msg.sender, _validator, amount);
    }

    /**
     * @notice Claims tokens when a validator has exited
     * @param _validator address of the exited validator
     */
    function claimValidatorExit(address _validator) external override {
        if (_validators[_validator].status != ValidatorStatus.Exited) revert ValidatorNotExited();

        uint256 amount = delegations[_validator][msg.sender];
        if (amount == 0) revert NoDelegationFound();

        delegations[_validator][msg.sender] = 0;
        _validators[_validator].totalDelegated -= amount;

        token.safeTransfer(msg.sender, amount);

        emit ValidatorExitClaimed(msg.sender, _validator, amount);
    }

    /**
     * @notice Returns the undelegation info for a delegator
     * @param _validator address of the validator
     * @param _delegator address of the delegator
     * @return amount amount of tokens undelegated
     * @return unlocksAt timestamp when tokens can be withdrawn
     */
    function undelegations(
        address _validator,
        address _delegator
    ) external view override returns (uint256 amount, uint256 unlocksAt) {
        Undelegation storage undelegation = _undelegations[_validator][_delegator];
        return (undelegation.amount, undelegation.unlocksAt);
    }

    /**
     * @notice Returns the validator info
     * @param _validator address of the validator
     * @return totalDelegated total amount delegated to the validator
     * @return status validator status
     */
    function validators(
        address _validator
    ) external view override returns (uint256 totalDelegated, ValidatorStatus status) {
        Validator storage validator = _validators[_validator];
        return (validator.totalDelegated, validator.status);
    }

    /**
     * @notice Sets the exit escrow period
     * @param _exitEscrowPeriod new exit escrow period in seconds
     */
    function setExitEscrowPeriod(uint256 _exitEscrowPeriod) external {
        exitEscrowPeriod = _exitEscrowPeriod;
    }

    /**
     * @notice Simulates slashing a delegator's stake
     * @param _validator address of the validator
     * @param _delegator address of the delegator to slash
     * @param _amount amount to slash
     */
    function slash(address _validator, address _delegator, uint256 _amount) external {
        delegations[_validator][_delegator] -= _amount;
        _validators[_validator].totalDelegated -= _amount;
    }
}
