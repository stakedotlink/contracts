// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


/**
 * @title MerkleDistributor
 * @notice Handles token airdrops with version-controlled distributions
 * @dev Allows for multiple versiond of a token ditribution and the ability to pause and withdraw unclaimed tokens
 */
contract MerkleDistributor is Ownable {

    using SafeERC20 for IERC20;

    struct Distribution {
        uint256 version;
        address token;
        bool isPaused;
        bytes32 merkleRoot;
        uint256 totalAmount;
        bool isWithdrawn;
    }

    struct Claim {
        uint256 claimedAmount;
        uint256 versionClaimed;
    }

    address[] public tokens;

    mapping(address => mapping(uint256 => Distribution)) public distributions;
    mapping(address => mapping(address => mapping(uint256 => Claim))) public claims;
    mapping(address => uint256) public latestVersion;

    event Claimed(address indexed token, uint256 version, address indexed account, uint256 amount);
    event DistributionAdded(address indexed token, uint256 version, uint256 totalAmount);
    event DistributionUpdated(address indexed token, uint256 version, uint256 additionalAmount);
    event DistributionWithdrawn(address indexed token, uint256 version, uint256 amount);

    /** 
        * @notice modifier to check if a distribution exists
        * @param _token token address
     **/
    modifier distributionExists(address _token) {
        // check if distribution exists with latest version of it
        require(latestVersion[_token] > 0, "MerkleDistributor: No distributions exist for this token.");
        require(distributions[_token][latestVersion[_token]].token != address(0), "MerkleDistributor: No distributions exist for this token.");
        _;
    }

    /**
     * @notice returns the total claimed amount for a token
     * @param _token token address
     * @param _account account to check
     **/
    function getTotalClaimed(address _token, address _account) public view returns (uint256) {
        uint256 _latestVersion = latestVersion[_token];
        uint256 totalClaimed;
        for (uint256 i = 1; i <= _latestVersion; i++) {
            totalClaimed += claims[_token][_account][i].claimedAmount;
        }
        return totalClaimed;
    }

    /**
     * @notice returns the distribution details for a specific version of a token distribution
     * @param _token token address
     * @param _version version of the distribution
     **/
    function getDistribution(address _token, uint256 _version) public view returns (Distribution memory) {
        return distributions[_token][_version];
    }

    /**
     * @notice adds multiple distributions at once
     * @param _tokens token addresses
     * @param _merkleRoots merkle roots of the distributions
     * @param _totalAmounts total amounts of tokens to be distributed
     **/
    function addDistributions(
        address[] memory _tokens,
        bytes32[] memory _merkleRoots,
        uint256[] memory _totalAmounts
    ) external onlyOwner {
        require(_tokens.length == _merkleRoots.length, "MerkleDistributor: Invalid input length.");
        require(_tokens.length == _totalAmounts.length, "MerkleDistributor: Invalid input length.");
        for (uint256 i = 0; i < _tokens.length; i++) {
            addDistribution(_tokens[i], _merkleRoots[i], _totalAmounts[i]);
        }
    }
    
    /**
     * @notice updates multiple distributions at once
     * @param _tokens token addresses
     * @param _merkleRoots merkle roots of the distributions
     * @param _additionalAmounts additional amounts of tokens to be distributed
     **/
    function updateDistributions(
        address[] memory _tokens,
        bytes32[] memory _merkleRoots,
        uint256[] memory _additionalAmounts
    ) external onlyOwner {
        require(_tokens.length == _merkleRoots.length, "MerkleDistributor: Invalid input length.");
        require(_tokens.length == _additionalAmounts.length, "MerkleDistributor: Invalid input length.");
        for (uint256 i = 0; i < _tokens.length; i++) {
            updateDistribution(_tokens[i], _merkleRoots[i], _additionalAmounts[i]);
        }
    }

    /**
     * @notice adds multiple distribution versions at once
     * @param _tokens token addresses
     * @param _merkleRoots merkle roots of the distributions
     * @param _totalAmounts total amounts of tokens to be distributed
     **/
    function addDistributionVersions(
        address[] memory _tokens,
        bytes32[] memory _merkleRoots,
        uint256[] memory _totalAmounts
    ) external onlyOwner {
        require(_tokens.length == _merkleRoots.length, "MerkleDistributor: Invalid input length.");
        require(_tokens.length == _totalAmounts.length, "MerkleDistributor: Invalid input length.");
        for (uint256 i = 0; i < _tokens.length; i++) {
            addDistributionVersion(_tokens[i], _merkleRoots[i], _totalAmounts[i]);
        }
    }
    
    /**
     * @notice adds a new distribution
     * @param _token token address
     * @param _merkleRoot merkle root of the distribution
     * @param _totalAmount total amount of tokens to be distributed
     **/
    function addDistribution(
        address _token,
        bytes32 _merkleRoot,
        uint256 _totalAmount
    ) public onlyOwner {
        require(distributions[_token][1].token == address(0), "MerkleDistributor: Distribution already exists.");
        require(IERC20(_token).balanceOf(address(this)) >= _totalAmount, "MerkleDistributor: Insufficient balance.");

        uint256 _version = 1;

        Distribution storage distribution = distributions[_token][_version];
        distribution.token = _token;
        distribution.version = _version;
        distribution.merkleRoot = _merkleRoot;
        distribution.totalAmount = _totalAmount;
        latestVersion[_token] = _version;

        emit DistributionAdded(_token, _version, _totalAmount);
    }

    /**
    * @notice Claims tokens from the latest distribution version for a given token
    * @param _token token address
    * @param _index index of the claim
    * @param _account account to claim tokens for
    * @param _amount amount of tokens to claim
    * @param _merkleProof merkle proof
    **/
    function claimDistribution(
        address _token,
        uint256 _index,
        address _account,
        uint256 _amount,
        bytes32[] calldata _merkleProof
    ) external {
        uint256 _latestVersion = latestVersion[_token];
        require(_latestVersion > 0, "MerkleDistributor: No distributions exist for this token.");
        Distribution storage distribution = distributions[_token][_latestVersion];
        require(!distribution.isPaused, "MerkleDistributor: Distribution is paused.");
        Claim storage claim = claims[_token][_account][_latestVersion];
        bytes32 node = keccak256(abi.encodePacked(_index, _account, _amount));
        require(MerkleProof.verify(_merkleProof, distribution.merkleRoot, node), "MerkleDistributor: Invalid proof.");
        require(claim.claimedAmount < _amount, "MerkleDistributor: Tokens claimed for the latest version.");
        uint256 claimableAmount = _amount - claim.claimedAmount;
        claim.claimedAmount = _amount;
        claim.versionClaimed = _latestVersion;
        IERC20(_token).safeTransfer(_account, claimableAmount);
        emit Claimed(_token, _latestVersion, _account, claimableAmount);
    }


    /*
    * @notice updates an existing distribution on its current version
    * @param _token token address
    * @param _merkleRoot merkle root of the distribution
    * @param _additionalAmount additional amount of tokens to be distributed
    **/
    function updateDistribution(
        address _token,
        bytes32 _merkleRoot,
        uint256 _additionalAmount
    ) public onlyOwner distributionExists(_token) {
        uint256 _latestVersion = latestVersion[_token];
        require(IERC20(_token).balanceOf(address(this)) >= _additionalAmount, "MerkleDistributor: Insufficient balance.");
     Distribution storage distribution = distributions[_token][_latestVersion];
        distribution.totalAmount += _additionalAmount;
      distribution.merkleRoot = _merkleRoot;

        emit DistributionUpdated(_token, _latestVersion, _additionalAmount);
    }

    /**
    * @notice Adds a new version of a token distribution automatically incrementing the version
    * @param _token token address
    * @param _merkleRoot merkle root of the distribution
    * @param _totalAmount total amount of tokens to be distributed
    **/
    function addDistributionVersion(
        address _token,
        bytes32 _merkleRoot,
        uint256 _totalAmount
    ) public onlyOwner distributionExists(_token) {
        require(distributions[_token][latestVersion[_token]].isWithdrawn, "MerkleDistributor: Latest version is not withdrawn.");
        uint256 _version = latestVersion[_token] + 1;
        require(IERC20(_token).balanceOf(address(this)) >= _totalAmount, "MerkleDistributor: Insufficient balance.");

        Distribution storage distribution = distributions[_token][_version];
        distribution.token = _token;
        distribution.version = _version;
        distribution.merkleRoot = _merkleRoot;
        distribution.totalAmount = _totalAmount;

        latestVersion[_token] = _version;

        emit DistributionAdded(_token, _version, _totalAmount);
    }

    /**
     * @notice withdraws unclaimed tokens
     * @dev merkle root should be updated to reflect current state of claims - the amount for each
     * account should be equal to it's claimed amount
     * @param _token token address
     **/
    function withdrawUnclaimedTokens(
        address _token
    ) external onlyOwner distributionExists(_token) {
        uint256 _version = latestVersion[_token];

        require(!distributions[_token][_version].isWithdrawn, "MerkleDistributor: Distribution is already withdrawn.");
        require(distributions[_token][_version].isPaused, "MerkleDistributor: Distribution is not paused.");

        IERC20 token = IERC20(_token);
        uint256 balance = token.balanceOf(address(this));
        if (balance > 0) {
            token.safeTransfer(msg.sender, balance);
        }
        distributions[_token][_version].isWithdrawn = true;

        emit DistributionWithdrawn(_token, _version, balance);
    }


    /**
     * @notice pauses a token distribution for withdrawal of unclaimed tokens
     * @dev must be called before withdrawUnlclaimedTokens to ensure state doesn't change
     * while the new merkle root is calculated
     * @param _token token address
     **/
     function pauseForWithdrawal(address _token) external onlyOwner distributionExists(_token) {
        uint256 _version = latestVersion[_token];

        require(!distributions[_token][_version].isPaused, "MerkleDistributor: Distribution is already paused.");

        distributions[_token][_version].isPaused = true;
    }

    /**
     * @notice unpauses a token distribution
     * @param _token token address
     **/
    function unpause(address _token) external onlyOwner distributionExists(_token) {
        uint256 _version = latestVersion[_token];

        require(distributions[_token][_version].isPaused, "MerkleDistributor: Distribution is not paused.");

        distributions[_token][_version].isPaused = false;
    }

       
}

