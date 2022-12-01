// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "../../interfaces/IERC677Receiver.sol";
import "../../interfaces/IERC677.sol";

contract ERC677 is IERC677, ERC20 {
    constructor(
        string memory _tokenName,
        string memory _tokenSymbol,
        uint256 _totalSupply
    ) ERC20(_tokenName, _tokenSymbol) {
        _mint(msg.sender, _totalSupply * (10**uint256(decimals())));
    }

    function transferAndCall(
        address _to,
        uint256 _value,
        bytes calldata _data
    ) public override returns (bool) {
        super.transfer(_to, _value);
        if (isContract(_to)) {
            contractFallback(msg.sender, _to, _value, _data);
        }
        return true;
    }

    function contractFallback(
        address _sender,
        address _to,
        uint256 _value,
        bytes calldata _data
    ) internal {
        IERC677Receiver receiver = IERC677Receiver(_to);
        receiver.onTokenTransfer(_sender, _value, _data);
    }

    function isContract(address _addr) internal view returns (bool hasCode) {
        uint256 length;
        assembly {
            length := extcodesize(_addr)
        }
        return length > 0;
    }
}
