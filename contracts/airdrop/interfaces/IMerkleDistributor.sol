// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

interface IMerkleDistributor {
    /**
     * @notice check whether a given distribution with the index has been claimed
     * @param _distribution distribution index
     * @param _index index of the claim within the distribution
     **/
    function isClaimed(uint256 _distribution, uint256 _index) external view returns (bool);

    /**
     * @notice claim a token distribution
     * @param _distribution distribution index
     * @param _index index of the claim within the distribution
     * @param _account address of the account to claim for
     * @param _amount amount of the token to claim
     * @param _merkleProof the merkle proof for the token claim
     **/
    function claim(
        uint256 _distribution,
        uint256 _index,
        address _account,
        uint256 _amount,
        bytes32[] calldata _merkleProof
    ) external;

    event Claimed(uint256 distribution, uint256 index, address account, uint256 amount);
    event DistributionAdded(uint256 indexed distribution, address indexed token);
}
