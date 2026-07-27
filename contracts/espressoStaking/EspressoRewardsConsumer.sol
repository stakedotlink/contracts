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
 * @notice Receives reward reports from an authorized Chainlink CRE forwarder and forwards lifetime
 * reward updates to the Espresso staking strategy
 * @dev The forwarder verifies DON signatures over the report bytes only and will deliver any
 * DON-signed report to any receiver, so checking `msg.sender == forwarder` is not sufficient to
 * authenticate a report: the same shared DON signs reports for every workflow running on it. The
 * only field that identifies which workflow produced a report is the Keystone report metadata
 * (workflow owner and workflow name). This contract therefore validates that metadata against the
 * authorized workflow before acting on a report. Without this check, any party able to run a
 * workflow on the same DON could forge a report and inflate lifetime rewards, minting unbacked stESP.
 */
contract EspressoRewardsConsumer is IReceiver {
    // Address of the authorized forwarder that can deliver reports
    address public immutable forwarder;
    // Espresso staking strategy that receives lifetime reward updates
    IEspressoStrategy public immutable strategy;
    // Owner of the CRE workflow that is authorized to produce reports
    address public immutable workflowOwner;
    // Name of the CRE workflow that is authorized to produce reports
    bytes10 public immutable workflowName;

    error OnlyForwarder(address sender);
    error UnauthorizedWorkflow(address reportWorkflowOwner, bytes10 reportWorkflowName);

    /**
     * @param _forwarder Address of the authorized forwarder
     * @param _strategy Address of the Espresso staking strategy
     * @param _workflowOwner Owner of the CRE workflow authorized to produce reports
     * @param _workflowName Name of the CRE workflow authorized to produce reports
     */
    constructor(
        address _forwarder,
        address _strategy,
        address _workflowOwner,
        bytes10 _workflowName
    ) {
        forwarder = _forwarder;
        strategy = IEspressoStrategy(_strategy);
        workflowOwner = _workflowOwner;
        workflowName = _workflowName;
    }

    /**
     * @notice Receives a report from the forwarder and updates lifetime rewards on the strategy
     * @dev Validates that the report originates from the authorized forwarder and was produced by
     * the authorized CRE workflow before decoding it as (uint256[] vaultIds, uint256[] lifetimeRewards)
     * @param _metadata Keystone report metadata, laid out as
     * workflow_cid(32) || workflow_name(10) || workflow_owner(20) || report_id(2)
     * @param _report ABI-encoded vault IDs and their corresponding lifetime rewards
     */
    function onReport(bytes calldata _metadata, bytes calldata _report) external override {
        if (msg.sender != forwarder) revert OnlyForwarder(msg.sender);

        (bytes10 reportWorkflowName, address reportWorkflowOwner) = _getWorkflowMetadata(_metadata);
        if (reportWorkflowOwner != workflowOwner || reportWorkflowName != workflowName)
            revert UnauthorizedWorkflow(reportWorkflowOwner, reportWorkflowName);

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

    /**
     * @notice Extracts the workflow name and workflow owner from the Keystone report metadata
     * @dev The forwarder strips its own 45-byte header and passes the remaining 64 bytes laid out as:
     *   [0:32]  workflow_cid
     *   [32:42] workflow_name (10 bytes)
     *   [42:62] workflow_owner (20 bytes)
     *   [62:64] report_id (2 bytes)
     * @param _metadata report metadata supplied by the forwarder
     * @return reportWorkflowName name of the workflow that produced the report
     * @return reportWorkflowOwner owner of the workflow that produced the report
     */
    function _getWorkflowMetadata(
        bytes calldata _metadata
    ) internal pure returns (bytes10 reportWorkflowName, address reportWorkflowOwner) {
        assembly {
            // workflow_name occupies the 10 high-order bytes of the word at offset 32; mask off the rest
            reportWorkflowName := and(calldataload(add(_metadata.offset, 32)), shl(176, not(0)))
            // workflow_owner occupies the 20 high-order bytes of the word at offset 42; shift to right-align
            reportWorkflowOwner := shr(96, calldataload(add(_metadata.offset, 42)))
        }
    }
}
