// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

interface IEspressoStaking {
    enum ValidatorStatus {
        Unknown,
        Active,
        Exited
    }

    function delegate(address _validator, uint256 _amount) external;

    function undelegate(address _validator, uint256 _amount) external;

    function claimWithdrawal(address _validator) external;

    function claimValidatorExit(address validator) external;

    function delegations(address _validator, address _delegator) external view returns (uint256);

    function undelegations(
        address _validator,
        address _delegator
    ) external view returns (uint256 amount, uint256 unlocksAt);

    function validators(address _validator) external view returns (uint256, ValidatorStatus);
}
