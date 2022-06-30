// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "./IERC677.sol";

interface IRewardsPoolController {
    /**
     * @notice returns an account's stake balance for use by reward pools
     * controlled by this contract
     * @return account's balance
     */
    function rpcStaked(address _account) external view returns (uint);

    /**
     * @notice returns the total staked amount for use by reward pools
     * controlled by this contract
     * @return total staked amount
     */
    function rpcTotalStaked() external view returns (uint);
}
