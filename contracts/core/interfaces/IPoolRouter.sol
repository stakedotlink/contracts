// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

interface IPoolRouter {
    function supportedTokens() external view returns (address[] memory);

    function stakedAmount(
        address _token,
        uint16 _index,
        address _account
    ) external view returns (uint);

    function poolsByToken(address _token) external view returns (address[] memory);

    function allPools() external view returns (address[] memory, address[] memory);

    function stakeAllowance(uint _amount) external;

    function stake(
        address _token,
        uint16 _index,
        uint _amount
    ) external;

    function withdraw(
        address _token,
        uint16 _index,
        uint _amount
    ) external;

    function withdrawAllowance(uint _amount) external;

    function allowanceInUse(
        address _token,
        uint16 _index,
        address _account
    ) external view returns (uint);

    function allowanceRequired(
        address _token,
        uint16 _index,
        uint256 _amount
    ) external view returns (uint);

    function availableStake(
        address _token,
        uint16 _index,
        address _account
    ) external view returns (uint);

    function maxAllowanceInUse(address _account) external view returns (uint256);
}
