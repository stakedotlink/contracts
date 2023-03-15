// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "../base/WithdrawalAdapter.sol";

/**
 * @title Withdrawal Adapter Mock
 * @notice Mocks contract for testing
 */
contract WithdrawalAdapterMock is WithdrawalAdapter {
    uint256 private totalDeposits;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _controller) public initializer {
        __WithdrawalAdapter_init(_controller, address(1), 9000, 0.1 ether);
    }

    function withdrawFromController(uint256 _amount) external {
        totalDeposits += _amount;
        controller.adapterWithdraw(address(this), _amount);
    }

    function depositToController(uint256 _amount) external {
        totalDeposits -= _amount;
        controller.adapterDeposit{value: _amount}();
    }

    function setTotalDeposits(uint256 _totalDeposits) external {
        totalDeposits = _totalDeposits;
    }

    function getTotalDeposits() external view override returns (uint256) {
        return totalDeposits;
    }
}
