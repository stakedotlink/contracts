// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "./VirtualERC20.sol";
import "../../interfaces/IERC677.sol";
import "../../interfaces/IERC677Receiver.sol";

contract VirtualERC677 is IERC677, VirtualERC20 {
    constructor(string memory tokenName, string memory tokenSymbol) VirtualERC20(tokenName, tokenSymbol) {}

    function transferAndCall(
        address _to,
        uint256 _value,
        bytes calldata _data
    ) public override returns (bool success) {
        super.transfer(_to, _value);
        if (isContract(_to)) {
            contractFallback(msg.sender, _to, _value, _data);
        }
        return true;
    }

    function transferAndCallFrom(
        address _sender,
        address _to,
        uint256 _value,
        bytes memory _data
    ) internal returns (bool) {
        _transfer(_sender, _to, _value);
        if (isContract(_to)) {
            contractFallback(_sender, _to, _value, _data);
        }
        return true;
    }

    function contractFallback(
        address _sender,
        address _to,
        uint256 _value,
        bytes memory _data
    ) private {
        IERC677Receiver receiver = IERC677Receiver(_to);
        receiver.onTokenTransfer(_sender, _value, _data);
    }

    function isContract(address _addr) private view returns (bool hasCode) {
        uint256 length;
        assembly {
            length := extcodesize(_addr)
        }
        return length > 0;
    }
}
