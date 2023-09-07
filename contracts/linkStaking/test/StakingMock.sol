// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "../../core/interfaces/IERC677.sol";
import "../../core/interfaces/IERC677Receiver.sol";

/**
 * @title Staking Mock
 * @dev Mocks contract for testing
 */
contract StakingMock is IERC677Receiver {
    IERC677 public token;

    mapping(address => uint256) public principalBalances;
    mapping(address => uint256) public removedPrincipal;

    bool public active;

    constructor(address _token) {
        token = IERC677(_token);
        active = true;
    }

    function onTokenTransfer(
        address _sender,
        uint256 _value,
        bytes calldata
    ) external {
        require(msg.sender == address(token), "has to be token");
        principalBalances[_sender] += _value;
    }

    function getStakerLimits() external pure returns (uint256, uint256) {
        return (10 ether, 7000 ether);
    }

    function getMaxPoolSize() external pure returns (uint256) {
        return 25000000 ether;
    }

    function getTotalPrincipal() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function getStakerPrincipal(address _staker) external view returns (uint256) {
        return principalBalances[_staker];
    }

    function getRemovedPrincipal(address _staker) external view returns (uint256) {
        return removedPrincipal[_staker];
    }

    function removePrincipal(address _staker, uint256 _amount) external {
        principalBalances[_staker] -= _amount;
        removedPrincipal[_staker] += _amount;
    }

    function isActive() external view returns (bool) {
        return active;
    }

    function setActive(bool _active) external {
        active = _active;
    }
}
