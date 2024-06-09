// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

interface IConceroPool {
    function depositToken(address _token, uint256 _amount) external;

    function depositEther() external payable;

    function withdrawLiquidityRequest(address _token, uint256 _amount) external;

    function availableToWithdraw(address _token) external view returns (uint256);

    function s_userBalances(address _token, address _account) external view returns (uint256);
}
