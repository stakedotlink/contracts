// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

interface IPolygonStaking {
    function buyVoucher(uint256 _amount, uint256 _minSharesToMint) external;

    function sellVoucher(uint256 _minClaimAmount) external;

    function unstakeClaimTokens() external;

    function restake() external;

    function withdrawRewards() external;

    function getLiquidRewards(address _user) external view returns (uint256);

    function balanceOf(address _user) external view returns (uint256);

    function exchangeRate() external view returns (uint256);

    function withdrawExchangeRate() external view returns (uint256);

    function delegators(address _user) external view returns (uint256, uint256);
}
