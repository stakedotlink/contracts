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

    /**
     * @notice adds a new token
     * @param _token token to add
     * @param _rewardsPool token rewards pool to add
     **/
    function addToken(address _token, address _rewardsPool) external;

    /**
     * @notice returns a list of all fees
     * @return list of fees
     */
    function getFees() external view returns (address[] memory, uint[] memory);
}
