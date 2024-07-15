// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import "../../interfaces/IERC677Receiver.sol";

contract ERC677Upgradeable is ERC20Upgradeable {
    function __ERC677_init(
        string memory _tokenName,
        string memory _tokenSymbol,
        uint256 _totalSupply
    ) public onlyInitializing {
        __ERC20_init(_tokenName, _tokenSymbol);
        if (_totalSupply != 0) {
            _mint(msg.sender, _totalSupply * (10 ** uint256(decimals())));
        }
    }

    function transferAndCall(
        address _to,
        uint256 _value,
        bytes memory _data
    ) public returns (bool) {
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
