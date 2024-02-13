// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import {MerkleDistributor} from "../../../contracts/airdrop/MerkleDistributor.sol";
import {BaseTest} from "../Base.t.sol";
import {ERC677} from "../../../contracts/core/tokens/base/ERC677.sol";
import "forge-std/console.sol";


contract MerkleDistributorTest is BaseTest {
    bool internal _fork = false;
    bytes32 _merkleRoot_1 = 0xca99ea02947aea2b4e36e85b6f48ee9bda45ad8a7c13460a30642b131557434a;
    uint256 _totalAmount = 14337996000000007761321915;

    address account1 = 0x0000000000002D534FF79e9C69e7Fcc742f0BE83;
    uint256 index1 = 0;
    uint256 amount1 = 14813531288235778;
    bytes32[] validProof1 = [
    bytes32(0xf7b20929116e3c7302692e96bafa244dafa5caceb5577d906648fd399a5ff7bf),
    bytes32(0xf41c8fbc357d7ef386de1dfacf7e0021a4c3761bc036ea971f9686a58455fad7),
    bytes32(0x1608c0ceba9ec48bf1d1d247d9bec0b23df765759576507814f73fcf74071878),
    bytes32(0x5900dd8a9a5b8c1bc6b3fe5427e66ad095bfc8c3f91edf5060921732c297490f),
    bytes32(0x2c1e0b76aef43bebef5252e0ebe2d0b748a4dc1a1ca5a1dd222a7636f9cd6d5d),
    bytes32(0x4bd1864308465547ac58aae2c6a5a2280440ff685fd646e94038edae57064523),
    bytes32(0x2b66dec807f531149f860a0b08643355a7b478140383defed8f4e7017e87aaf2),
    bytes32(0xb397cde1180e15d034bd2f7199b204d20db212962fffd5e6a2c7a9ce0c081efc),
    bytes32(0xb811da3159e2fd9604a749951af9bf9949341775787f5ede1a933191531a78c7),
    bytes32(0x973eca14272bc83b99355e1f7902f15e4dbd97711b788358afd0900b7bde9b3b)
    ];

    address account2 = 0x0000000000007F150Bd6f54c40A34d7C3d5e9f56;
    uint256 index2 = 1;
    uint256 amount2 = 23035;
    bytes32[] validProof2 = [
        bytes32(0x112589f019ac15c6ec94f62fd7d4328ccac3a463da609d32fb582721d817fef8),
        bytes32(0x01ffa77fc27fc339e7026a6d2c01227f8e6d066cde2f01d9611f3a589dcbefe7),
        bytes32(0x9092c60f0cb2295aa969cbf3a9d33ce8a7ace9f07e3913f133a1c6bb5299cc1c),
        bytes32(0x9a11c9d8787464f3fc4787d69205f0229872b2e77f82984c9a33e4e512f1ba58),
        bytes32(0xb5e5534c0c35caf0aabaa93d1e5741381b15894aa49174e0e2a80474c1547dce),
        bytes32(0x30e1ac74c2856c807e6b05508da347450d44b2a6ecd71b7d1763c41482352f2f),
        bytes32(0x3ec7e4400e750832247c5d7d4bd320610aef76c91d9114c5aa0c93183219aef2),
        bytes32(0x53a34af34e8826d4d5c24b75a026bbb5bac5a0ac7eea7e1df28e683397f95691),
        bytes32(0x123ccedfe2e059b503b08f2cbfc76156cc27bfc0f609b39ec53455bb99cc1629),
        bytes32(0x411a1a030a9b4c0462c4b1cb9b10506a7488eea01db61f9d49055aa501f1d3a7),
        bytes32(0xcdb1fad7f35ac9b56ea7d04044d9c2e7e47551fa1e3b2bac80472f322c5b89b9),
        bytes32(0x4ad3fc2220a0a5bb66a43a5dfa9e04b0df7f357d28944d40f88ddc1e3084bdfa)
    ];




    bytes32 _merkleRoot_2 = 0x52ec042bbcf8a478270012ae0e4a658ff3921314df95f0487b1f05b6a46c3af8;
    uint256 _totalAmount_2 = 1065156117468259689325813;

    address account1_2 = 0x00393D62F17B07e64f7cdcDF9BdC2fd925b20Bba;
    uint256 index1_2 = 0;
    uint256 amount1_2 = 1840233889215604467618;
    bytes32[] validProof1_2 = [
        bytes32(0x8f69123df82b69d232b7ad69c5d95b77ab0f8d4525d3544bbae543c629f32408),
        bytes32(0x24c37992ee0700c6c1d640cd5233f3949dca5a543f1b5fa6ba776b3e669c629a),
        bytes32(0xf78ab8f97474318c199ac417bac751a62c1e1cd7b03613782b5a66ba9225e379),
        bytes32(0x539821bea843ee787e20860247831f7824608ac9ba72afeb3fcadad36640c58c),
        bytes32(0x96f883d35c39bb71c6a30c68159cc151bb5c7528d9bd8010797736126d7b46ef),
        bytes32(0x3db7b50759069a96c99303b5a5cdbdab240a83f1c98372efbe09cd9fdc6e02f6),
        bytes32(0xcfb78726e966fe4d350da6ec55a084f45dd8bb3cc9ce257e2cc62a206bc7037d),
        bytes32(0x44c8dfb10fac55138806452ecdf93237c0e3ee7213d40780e4d1d8e3c678fde8),
        bytes32(0x357c7629bf032666620838427aba400dff312480f88e276b5f0c77cd2aa67e1c)
    ];


    uint256 tokenSupply = 1000000000;
    uint256 _version1 = 1;
    uint256 _version2 = 2;
    uint256 _version3 = 3;

    ERC677 _testToken = new ERC677("Token", "TKN", tokenSupply);
    ERC677 _testToken2 = new ERC677("Coin", "COI", tokenSupply);
    

    function setUp() public {
        BaseTest.init(_fork);
        owner = address(this);
    }

    // Setup the MerkleDistributor contract
     function _setupTokenDistribution(bytes32 _merkleRoot) internal {
        _testToken.transfer(address(merkleDistributor), _totalAmount);
        merkleDistributor.addDistribution(address(_testToken), _merkleRoot, _totalAmount);
    }


    function test_Success_addDistribution() public {
        _testToken.transfer(address(merkleDistributor), _totalAmount);
        merkleDistributor.addDistribution(address(_testToken), _merkleRoot_1, _totalAmount);
        assertEq(
            merkleDistributor.getDistribution(address(_testToken), _version1).version,
            _version1
        );
        _testToken2.transfer(address(merkleDistributor), _totalAmount);
        merkleDistributor.addDistribution(address(_testToken2), _merkleRoot_2, _totalAmount);
        assertEq(
            merkleDistributor.getDistribution(address(_testToken2), _version1).version,
            _version1
        );
    }

    function test_Revert_addDistribution_NotOwner() public {
        _testToken.transfer(address(merkleDistributor), _totalAmount);
        vm.startPrank(account1);
        vm.expectRevert("Ownable: caller is not the owner");
        merkleDistributor.addDistribution(address(_testToken), _merkleRoot_1, _totalAmount);
    }

    function test_Revert_addDistribution_InsufficientBalance() public {
        vm.expectRevert("MerkleDistributor: Insufficient balance.");
        merkleDistributor.addDistribution(address(_testToken), _merkleRoot_1, _totalAmount);
    }

    function test_Revert_addDistribution_DistributionExists() public {
        _testToken.transfer(address(merkleDistributor), _totalAmount);
        merkleDistributor.addDistribution(address(_testToken), _merkleRoot_1, _totalAmount);
        vm.expectRevert("MerkleDistributor: Distribution already exists.");
        merkleDistributor.addDistribution(address(_testToken), _merkleRoot_1, _totalAmount);
    }
    
 
    function test_Success_claimDistribution() public {
        _setupTokenDistribution(_merkleRoot_1);
        // Attempt to claim with the mock proof
        vm.startPrank(account1);
        merkleDistributor.claimDistribution(address(_testToken), index1, account1, amount1, validProof1); // Removed version parameter
        vm.stopPrank();
        vm.startPrank(account2);
        // Verify claim for the latest version (which is 1 in this case)
        uint256 claimedAmount = merkleDistributor.getTotalClaimed(address(_testToken), account1); // Explicitly check version 1
        assertEq(claimedAmount, amount1);
        // Verify token balance
        assertEq(_testToken.balanceOf(account1), amount1);
        assertEq(_testToken.balanceOf(address(merkleDistributor)), _totalAmount - amount1);
    }

    // function test_Success_claimDistribution_merkleRoot_2() public {
    //     _setupTokenDistribution(_merkleRoot_2);
    //     // Attempt to claim with the mock proof
    //     vm.startPrank(account1_2);
    //     merkleDistributor.claimDistribution(address(_testToken), index1_2, account1_2, amount1_2, validProof1_2); // Removed version parameter
    //     vm.stopPrank();
    //     // Verify claim for the latest version (which is 1 in this case)
    //     uint256 claimedAmount = merkleDistributor.getTotalClaimed(address(_testToken), account1_2); // Explicitly check version 1
    //     assertEq(claimedAmount, amount1_2);
    //     // Verify token balance
    //     assertEq(_testToken.balanceOf(account1_2), amount1_2);
    //     assertEq(_testToken.balanceOf(address(merkleDistributor)), _totalAmount - amount1_2);
    // }

    function test_Revert_claimDistribution_InvalidProof() public {
        _setupTokenDistribution(_merkleRoot_1);
        vm.expectRevert("MerkleDistributor: Invalid proof.");
        merkleDistributor.claimDistribution(address(_testToken), index1, account1, amount1, validProof2);
    }

    function test_Revert_claimDistribution_DistributionPaused() public {
        _setupTokenDistribution(_merkleRoot_1);
        merkleDistributor.pauseForWithdrawal(address(_testToken));
        vm.expectRevert("MerkleDistributor: Distribution is paused.");
        merkleDistributor.claimDistribution(address(_testToken), index1, account1, amount1, validProof1);
    }

    function test_Revert_claimDistribution_TokensClaimed() public {
        _setupTokenDistribution(_merkleRoot_1);
        vm.startPrank(account1);
        merkleDistributor.claimDistribution(address(_testToken), index1, account1, amount1, validProof1);
        vm.stopPrank();
        vm.expectRevert("MerkleDistributor: Tokens claimed for the latest version.");
        merkleDistributor.claimDistribution(address(_testToken), index1, account1, amount1, validProof1);
    }


    // addDistributionVersion
    function test_addDistributionVersion() public {
        _setupTokenDistribution(_merkleRoot_1);
        // Verify the version
        assertEq(
            merkleDistributor.getDistribution(address(_testToken), _version1).version,
            _version1
        );
        //Pause distribution first
        merkleDistributor.pauseForWithdrawal(address(_testToken));
        // Withdraw the tokens first
        merkleDistributor.withdrawUnclaimedTokens(
            address(_testToken)
        );
        // Make sure that the tokens were withdrawn
        assertEq(
            _testToken.balanceOf(address(merkleDistributor)),
            0
        );
        // Make sure distribution is withdrawn
        assertEq(
            merkleDistributor.getDistribution(address(_testToken), _version1).isWithdrawn,
            true
        );
        // send more tokens to create a new version
        _testToken.transfer(address(merkleDistributor), _totalAmount);
        // Add a new version
        merkleDistributor.addDistributionVersion(address(_testToken), _merkleRoot_1, _totalAmount);
        // Verify the version
        assertEq(
            merkleDistributor.getDistribution(address(_testToken), _version2).version,
            _version2
        );
    }

    function test_Revert_addDistributionVersion_InsufficientBalance() public {
        _setupTokenDistribution(_merkleRoot_1);
        //Pause distribution first
        merkleDistributor.pauseForWithdrawal(address(_testToken));
        // Withdraw the tokens first
        merkleDistributor.withdrawUnclaimedTokens(
            address(_testToken)
        );
        // Make sure that the tokens were withdrawn
        assertEq(
            _testToken.balanceOf(address(merkleDistributor)),
            0
        );
        // Make sure distribution is withdrawn
        assertEq(
            merkleDistributor.getDistribution(address(_testToken), _version1).isWithdrawn,
            true
        );
        // send more tokens to create a new version
        vm.expectRevert("MerkleDistributor: Insufficient balance.");
        merkleDistributor.addDistributionVersion(address(_testToken), _merkleRoot_1, _totalAmount);
    }

    function test_Revert_addDistributionVersion_LatestVersionNotWithdrawn() public {
        _setupTokenDistribution(_merkleRoot_1);

        vm.expectRevert("MerkleDistributor: Latest version is not withdrawn.");
        merkleDistributor.addDistributionVersion(address(_testToken), _merkleRoot_1, _totalAmount);
    }

    function test_Revert_addDistributionversion_DistributionDoesNotExist() public {
        vm.expectRevert("MerkleDistributor: No distributions exist for this token.");
        merkleDistributor.addDistributionVersion(address(_testToken), _merkleRoot_1, _totalAmount);
    }



    function test_Success_updateDistribution() public {
    _setupTokenDistribution(_merkleRoot_1);
    bytes32 _newMerkleRoot = 0x0;
    uint256 _additionalAmount = 100000000000000000000000000;
    _testToken.transfer(address(merkleDistributor), _additionalAmount);
    merkleDistributor.updateDistribution(address(_testToken), _newMerkleRoot, _additionalAmount);
    // verify new distribution details
    assertEq(
        merkleDistributor.getDistribution(address(_testToken), _version1).merkleRoot,
        _newMerkleRoot
    );
    assertEq(
        merkleDistributor.getDistribution(address(_testToken), _version1).totalAmount,
        _totalAmount + _additionalAmount
    );
    assertEq(
        merkleDistributor.getDistribution(address(_testToken), _version1).version,
        _version1
    );
    }

    function test_Revert_updateDistribution_revertInsufficientBalance() public {
        _setupTokenDistribution(_merkleRoot_1);
        bytes32 _newMerkleRoot = 0x0;
        uint256 _additionalAmount = 100000000000000000000000000;
        vm.expectRevert("MerkleDistributor: Insufficient balance.");
        merkleDistributor.updateDistribution(address(_testToken), _newMerkleRoot, _additionalAmount);  
    }

    function test_Success_pauseForWithdrawl() public {
        _setupTokenDistribution(_merkleRoot_1);
        merkleDistributor.pauseForWithdrawal(address(_testToken));
        assertEq(
            merkleDistributor.getDistribution(address(_testToken), _version1).isPaused,
            true
        );
    }

    function test_Revert_pauseForWithdrawl_DistributionDoesNotExist() public {
        vm.expectRevert("MerkleDistributor: No distributions exist for this token.");
        merkleDistributor.pauseForWithdrawal(address(_testToken));
    }

    function test_Revert_pauseForWithdrawl_AlreadyPaused() public {
        _setupTokenDistribution(_merkleRoot_1);
        merkleDistributor.pauseForWithdrawal(address(_testToken));
        vm.expectRevert("MerkleDistributor: Distribution is already paused.");
        merkleDistributor.pauseForWithdrawal(address(_testToken));
    }

    function test_Success_unpause() public {
        _setupTokenDistribution(_merkleRoot_1);
        merkleDistributor.pauseForWithdrawal(address(_testToken));
        merkleDistributor.unpause(address(_testToken));
        assertEq(
            merkleDistributor.getDistribution(address(_testToken), _version1).isPaused,
            false
        );
    }

    function test_Revert_unpause_DistributionNotPaused() public {
        _setupTokenDistribution(_merkleRoot_1);
        vm.expectRevert("MerkleDistributor: Distribution is not paused.");
        merkleDistributor.unpause(address(_testToken));
    }

    function test_Sucess_withdrawUnclaimedTokens() public {
        uint256 _tokenSupply_3 = 1000000000;
        ERC677 _testToken_3 = new ERC677("Test", "TST", _tokenSupply_3);
        uint256 _start_owner_token_balance = _testToken_3.balanceOf(owner);
        console.log("Owner start balance: ", _testToken_3.balanceOf(owner));
        _testToken_3.transfer(address(merkleDistributor), _totalAmount);
        console.log("Owner balance after transfer to merkledistributor: ", _testToken_3.balanceOf(owner));
        console.log("Merkle distributor balance after transfer to it",_testToken_3.balanceOf(address(merkleDistributor)));
        merkleDistributor.addDistribution(address(_testToken_3), _merkleRoot_1, _totalAmount);

        assertEq(
            _testToken_3.balanceOf(address(merkleDistributor)),
            _totalAmount
        );

        merkleDistributor.pauseForWithdrawal(address(_testToken_3));
        merkleDistributor.withdrawUnclaimedTokens(address(_testToken_3));

        assertEq(
            _testToken_3.balanceOf(address(merkleDistributor)),
            0
        );
        assertEq(
            _testToken_3.balanceOf(owner),
            _start_owner_token_balance
        );
    }

    function test_Revert_withdrawUnclaimedTokens_NotOwner() public {
        _setupTokenDistribution(_merkleRoot_1);
        merkleDistributor.pauseForWithdrawal(address(_testToken));
        vm.startPrank(account1);
        vm.expectRevert("Ownable: caller is not the owner");
        merkleDistributor.withdrawUnclaimedTokens(address(_testToken));
    }
  
}
