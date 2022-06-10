// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;

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
            contractFallback(_to, _value, _data);
        }
        return true;
    }

    function contractFallback(
        address _to,
        uint256 _value,
        bytes calldata _data
    ) private {
        IERC677Receiver receiver = IERC677Receiver(_to);
        receiver.onTokenTransfer(msg.sender, _value, _data);
    }

    function isContract(address _addr) private view returns (bool hasCode) {
        uint256 length;
        assembly {
            length := extcodesize(_addr)
        }
        return length > 0;
    }
}
