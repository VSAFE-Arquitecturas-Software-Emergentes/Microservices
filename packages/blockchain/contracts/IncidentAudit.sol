// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Stores opaque commitments only. It does not verify real-world incidents.
contract IncidentAudit {
    address public immutable writer;
    bytes32 public immutable deploymentId;
    mapping(bytes32 => bytes32) public commitments;
    event Anchored(bytes32 indexed recordRef, bytes32 commitment);
    constructor(bytes32 instanceId) { writer = msg.sender; deploymentId = instanceId; }
    function anchor(bytes32 recordRef, bytes32 commitment) external {
        require(msg.sender == writer, "WRITER_ONLY");
        require(commitment != bytes32(0), "EMPTY_COMMITMENT");
        bytes32 previous = commitments[recordRef];
        require(previous == bytes32(0) || previous == commitment, "VERSION_ALREADY_ANCHORED");
        if (previous == bytes32(0)) { commitments[recordRef] = commitment; emit Anchored(recordRef, commitment); }
    }
}
