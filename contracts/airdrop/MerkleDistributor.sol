// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MerkleDistributor
 * @notice Handles token airdrops from an unlimited amount of token rewards
 * @dev Based on https://github.com/Uniswap/merkle-distributor but modified to handle multiple airdrops concurrently
 */
contract MerkleDistributor is Ownable {
    using SafeERC20 for IERC20;

    struct Distribution {
        address token;
        bytes32 merkleRoot;
        mapping(address => uint256) claimed;
    }
    address[] public tokens;
    mapping(address => Distribution) public distributions;

    event Claimed(address indexed token, uint256 index, address indexed account, uint256 amount);
    event DistributionAdded(uint256 indexed tokenIndex, address indexed token);
    event DistributionUpdated(address indexed token);

    modifier distributionExists(address _token) {
        require(distributions[_token].merkleRoot != bytes32(0), "MerkleDistributor: Distribution does not exist.");
        _;
    }

    /**
     * @notice add multiple token distributions
     * @param _tokens the list of token addresses to add
     * @param _merkleRoots subsequent list of merkle roots for the distributions
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
        require(distributions[_token].merkleRoot == bytes32(0), "MerkleDistributor: Distribution is already added.");

        tokens.push(_token);

        distributions[_token].token = _token;
        distributions[_token].merkleRoot = _merkleRoot;

        emit DistributionAdded(tokens.length - 1, _token);
    }

    /**
     * @notice update multiple token distributions
     * @param _tokens the list of token addresses to update
     * @param _merkleRoots subsequent list of updated merkle roots for the distributions
     **/
    function updateDistributions(address[] memory _tokens, bytes32[] memory _merkleRoots) external onlyOwner {
        require(_tokens.length == _merkleRoots.length, "MerkleDistributor: Array lengths need to match.");

        for (uint i = 0; i < _tokens.length; i++) {
            updateDistribution(_tokens[i], _merkleRoots[i]);
        }
    }

    /**
     * @notice update a token distribution
     * @param _token token address
     * @param _merkleRoot updated merkle root for token distribution
     **/
    function updateDistribution(address _token, bytes32 _merkleRoot) public onlyOwner distributionExists(_token) {
        distributions[_token].merkleRoot = _merkleRoot;

        emit DistributionUpdated(_token);
    }

    /**
     * @notice claim multiple token distributions
     * @param _tokens list of token address
     * @param _indexes list of indexes of the claims within the distributions
     * @param _account address of the account to claim for
     * @param _amounts list of lifetime amounts of the tokens allocated to account
     * @param _merkleProofs list of merkle proofs for the token claims
     **/
    function claimDistributions(
        address[] calldata _tokens,
        uint256[] calldata _indexes,
        address _account,
        uint256[] calldata _amounts,
        bytes32[][] calldata _merkleProofs
    ) external {
        require(
            _tokens.length == _indexes.length && _tokens.length == _amounts.length && _tokens.length == _merkleProofs.length,
            "MerkleDistributor: Array lengths need to match."
        );

        for (uint i = 0; i < _tokens.length; i++) {
            claimDistribution(_tokens[i], _indexes[i], _account, _amounts[i], _merkleProofs[i]);
        }
    }

    /**
     * @notice claim a token distribution
     * @param _token token address
     * @param _index index of the claim within the distribution
     * @param _account address of the account to claim for
     * @param _amount lifetime amount of the token allocated to account
     * @param _merkleProof the merkle proof for the token claim
     **/
    function claimDistribution(
        address _token,
        uint256 _index,
        address _account,
        uint256 _amount,
        bytes32[] calldata _merkleProof
    ) public distributionExists(_token) {
        Distribution storage distribution = distributions[_token];

        bytes32 node = keccak256(abi.encodePacked(_index, _account, _amount));
        require(MerkleProof.verify(_merkleProof, distribution.merkleRoot, node), "MerkleDistributor: Invalid proof.");

        require(distribution.claimed[_account] < _amount, "MerkleDistributor: Tokens already claimed.");

        uint amount = _amount - distribution.claimed[_account];
        IERC20(_token).safeTransfer(_account, amount);

        emit Claimed(_token, _index, _account, amount);
    }
}
