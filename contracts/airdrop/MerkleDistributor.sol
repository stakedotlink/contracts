// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/IMerkleDistributor.sol";

/**
 * @title MerkleDistributor
 * @notice Handles token airdrops from an unlimited amount of token rewards
 * @dev Copied from https://github.com/Uniswap/merkle-distributor but modified to handle multiple airdrops concurrently
 */
contract MerkleDistributor is IMerkleDistributor, Ownable {
    using SafeERC20 for IERC20;

    struct Distribution {
        address token;
        bytes32 merkleRoot;
        // This is a packed array of booleans.
        mapping(uint256 => uint256) claimedBitMap;
    }
    Distribution[] public distributions;

    modifier distributionExists(uint256 _distribution) {
        require(_distribution < distributions.length, "MerkleDistributor: Distribution does not exist.");
        _;
    }

    /**
     * @notice add multiple token distributions
     * @param _tokens the list of token addresses to add
     * @param _merkleRoots subsequent list of merkle roots for the distribution
     **/
    function addDistributions(address[] memory _tokens, bytes32[] memory _merkleRoots) external onlyOwner {
        require(_tokens.length == _merkleRoots.length, "MerkleDistributor: Array lengths need to match.");

        for (uint i = 0; i < _tokens.length; i++) {
            addDistribution(_tokens[i], _merkleRoots[i]);
        }
    }

    /**
     * @notice add a token distribution
     * @param _token token address
     * @param _merkleRoot merkle root for token distribution
     **/
    function addDistribution(address _token, bytes32 _merkleRoot) public onlyOwner {
        uint distributionIndex = distributions.length;

        distributions.push();
        distributions[distributionIndex].token = _token;
        distributions[distributionIndex].merkleRoot = _merkleRoot;

        emit DistributionAdded(distributionIndex, _token);
    }

    /**
     * @notice check whether a given distribution with the index has been claimed
     * @param _distribution distribution index
     * @param _index index of the claim within the distribution
     **/
    function isClaimed(uint256 _distribution, uint256 _index)
        public
        view
        override
        distributionExists(_distribution)
        returns (bool)
    {
        uint256 claimedWordIndex = _index / 256;
        uint256 claimedBitIndex = _index % 256;
        uint256 claimedWord = distributions[_distribution].claimedBitMap[claimedWordIndex];
        uint256 mask = (1 << claimedBitIndex);
        return claimedWord & mask == mask;
    }

    /**
     * @notice internal function to mark an index within a distribution as claimed
     * @param _distribution distribution index
     * @param _index index of the claim within the distribution
     **/
    function _setClaimed(uint256 _distribution, uint256 _index) private {
        Distribution storage distribution = distributions[_distribution];
        uint256 claimedWordIndex = _index / 256;
        uint256 claimedBitIndex = _index % 256;
        distribution.claimedBitMap[claimedWordIndex] = distribution.claimedBitMap[claimedWordIndex] | (1 << claimedBitIndex);
    }

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
    ) external override distributionExists(_distribution) {
        require(!isClaimed(_distribution, _index), "MerkleDistributor: Drop already claimed.");
        Distribution storage distribution = distributions[_distribution];

        // Verify the merkle proof.
        bytes32 node = keccak256(abi.encodePacked(_index, _account, _amount));
        require(MerkleProof.verify(_merkleProof, distribution.merkleRoot, node), "MerkleDistributor: Invalid proof.");

        // Mark it claimed and send the token.
        _setClaimed(_distribution, _index);
        IERC20(distribution.token).safeTransfer(_account, _amount);

        emit Claimed(_distribution, _index, _account, _amount);
    }
}
