// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import {VRFV2WrapperConsumerBase} from "@chainlink/contracts/src/v0.8/VRFV2WrapperConsumerBase.sol";
import {VRFV2WrapperInterface} from "@chainlink/contracts/src/v0.8/interfaces/VRFV2WrapperInterface.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {LinkTokenInterface} from "@chainlink/contracts/src/v0.8/interfaces/LinkTokenInterface.sol";

contract AirdropRaffle is VRFV2WrapperConsumerBase, Ownable {
    RequestConfig public requestConfig;
    address public linkTokenAddress;
    address[] internal contestants;
    address[] internal winners;
    uint256 public vrfRandomness;
    uint8 public totalWinners;

    struct RequestConfig {
        uint32 callbackGasLimit;
        uint16 requestConfirmations;
        uint32 numWords;
    }

    constructor(
        address _wrapperAddress,
        address _linkAddress,
        uint16 _requestConfirmations,
        uint32 _callbackGasLimit,
        address[] memory _contestants,
        uint8 _totalWinners
    ) VRFV2WrapperConsumerBase(_linkAddress, _wrapperAddress) {
        require(_linkAddress != address(0), "Link Token address cannot be 0x0");
        require(_wrapperAddress != address(0), "Wrapper address cannot be 0x0");
        linkTokenAddress = _linkAddress;
        contestants = _contestants;
        totalWinners = _totalWinners;
        requestConfig = RequestConfig({
            callbackGasLimit: _callbackGasLimit,
            requestConfirmations: _requestConfirmations,
            numWords: 1
        });
    }

    function getContestants() external view returns (address[] memory) {
        return contestants;
    }

    function getWinners() external view returns (address[] memory) {
        return winners;
    }

    function isWinner(address _address) external view returns (bool) {
        for (uint256 i = 0; i < winners.length; i++) {
            if (winners[i] == _address) {
                return true;
            }
        }
        return false;
    }

    function _pickWinners() internal {
        address[] memory shuffled = _shuffle(contestants, vrfRandomness);

        address[] memory _winners = new address[](totalWinners);
        for (uint256 i = 0; i < _winners.length; i++) {
            _winners[i] = shuffled[i];
        }
        winners = _winners;
    }

    function onTokenTransfer(
        address sender,
        uint256 value,
        bytes calldata
    ) external {
        require(sender == owner(), "Sender must be owner");
        require(msg.sender == address(linkTokenAddress), "Sender must be LINK address");
        require(value > 0, "Value must be greater than 0");
        _requestRandomWords();
    }

    function withdrawLink() external onlyOwner {
        LinkTokenInterface link = LinkTokenInterface(linkTokenAddress);
        require(link.transfer(msg.sender, link.balanceOf(address(this))), "Unable to transfer");
    }

    function _requestRandomWords() internal returns (uint256) {
        uint256 requestId = requestRandomness(
            requestConfig.callbackGasLimit,
            requestConfig.requestConfirmations,
            requestConfig.numWords
        );

        return requestId;
    }

    function fulfillRandomWords(uint256, uint256[] memory randomWords) internal override {
        vrfRandomness = randomWords[0];
        _pickWinners();
    }

    function _shuffle(address[] memory array, uint256 random) internal pure returns (address[] memory) {
        uint256 lastIndex = array.length - 1;
        bytes32 n_random = keccak256(abi.encodePacked(random));
        while (lastIndex > 0) {
            uint256 r_index = uint256(keccak256(abi.encode(n_random))) % lastIndex;
            address temp = array[lastIndex];
            array[lastIndex] = array[r_index];
            array[r_index] = temp;
            n_random = keccak256(abi.encodePacked(n_random));
            lastIndex--;
        }
        return array;
    }
}
