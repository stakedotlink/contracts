// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.22;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "./interfaces/IEspressoStrategy.sol";

/**
 * @title IReceiver
 * @notice Interface for contracts that receive reports from a forwarder
 */
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/**
 * @title EspressoRewardsConsumer
 * @notice Receives reward reports from an authorized forwarder and forwards lifetime reward
 * updates to the Espresso staking strategy
 */
contract EspressoRewardsConsumer is IReceiver {
    // Address of the authorized forwarder that can deliver reports
    address public immutable forwarder;
    // Espresso staking strategy that receives lifetime reward updates
    IEspressoStrategy public immutable strategy;

    error OnlyForwarder(address sender);

    /**
     * @param _forwarder Address of the authorized forwarder
     * @param _strategy Address of the Espresso staking strategy
     */
    constructor(address _forwarder, address _strategy) {
        forwarder = _forwarder;
        strategy = IEspressoStrategy(_strategy);
    }

    /**
     * @notice Receives a report from the forwarder and updates lifetime rewards on the strategy
     * @dev Decodes the report as (uint256[] vaultIds, uint256[] lifetimeRewards)
     * @param _report ABI-encoded vault IDs and their corresponding lifetime rewards
     */
    function onReport(bytes calldata, bytes calldata _report) external override {
        if (msg.sender != forwarder) revert OnlyForwarder(msg.sender);

        (uint256[] memory vaultIds, uint256[] memory lifetimeRewards) = abi.decode(
            _report,
            (uint256[], uint256[])
        );

        strategy.updateLifetimeRewards(vaultIds, lifetimeRewards);
    }

    /**
     * @notice Checks whether this contract supports a given interface
     * @param _interfaceId The interface identifier to check
     * @return True if the interface is supported
     */
    function supportsInterface(bytes4 _interfaceId) external pure override returns (bool) {
        return
            _interfaceId == type(IReceiver).interfaceId ||
            _interfaceId == type(IERC165).interfaceId;
    }
}
