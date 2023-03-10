// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../interfaces/IDelegatorPool.sol";

/**
 * @title Pool Router Mock
 * @dev Mocks contract for testing
 */
contract PoolRouterMock {
    using SafeERC20 for IERC20;

    address public delegatorPool;
    address public allowanceToken;
    address public token;

    uint16 public index;
    uint256 public totalRewards;

    bool public reservedMode;

    constructor(
        address _allowanceToken,
        address _token,
        uint16 _index,
        address _delegatorPool
    ) {
        allowanceToken = _allowanceToken;
        token = _token;
        index = _index;
        delegatorPool = _delegatorPool;
    }

    function maxAllowanceInUse() public view returns (uint256) {
        return 20 ether;
    }

    function allowanceInUse(address _token, uint16 _index) public view returns (uint256) {
        if (_token != token || _index != index) {
            return 0;
        }

        return 10 ether;
    }

    function setReservedMode(bool _reservedMode) external {
        reservedMode = _reservedMode;
    }

    function isReservedMode() external view returns (bool) {
        return reservedMode;
    }

    function getReservedMultiplier() external view returns (uint256) {
        return 10000;
    }

    function onTokenTransfer(
        address _sender,
        uint256 _value,
        bytes calldata
    ) external {
        require(msg.sender == allowanceToken, "Unauthorized");
        IDelegatorPool(delegatorPool).stakeAllowance(_sender, _value);
    }
}
