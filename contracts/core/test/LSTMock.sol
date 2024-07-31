// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "../tokens/base/ERC677.sol";

contract LSTMock is ERC677 {
    uint256 public mulitplierBasisPoints;

    constructor(
        string memory _tokenName,
        string memory _tokenSymbol,
        uint256 _totalSupply
    ) ERC677(_tokenName, _tokenSymbol, _totalSupply) {
        mulitplierBasisPoints = 10000;
    }

    function balanceOf(address _account) public view override returns (uint256) {
        return (super.balanceOf(_account) * mulitplierBasisPoints) / 10000;
    }

    function getSharesByStake(uint256 _amount) external view returns (uint256) {
        return (_amount * 10000) / mulitplierBasisPoints;
    }

    function getStakeByShares(uint256 _sharesAmount) external view returns (uint256) {
        return (_sharesAmount * mulitplierBasisPoints) / 10000;
    }

    function setMultiplierBasisPoints(uint256 _multiplierBasisPoints) external {
        mulitplierBasisPoints = _multiplierBasisPoints;
    }
}
