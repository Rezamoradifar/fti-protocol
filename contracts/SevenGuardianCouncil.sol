// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * Fixed 7-wallet emergency council.
 * 5 of 7 approvals are required.
 * The council does not custody reserve funds.
 */
contract SevenGuardianCouncil is ReentrancyGuard {
    uint8 public constant THRESHOLD = 5;

    address[7] public guardians;
    mapping(address => bool) public isGuardian;

    struct Proposal {
        address target;
        bytes data;
        uint8 approvals;
        bool executed;
    }

    Proposal[] private proposals;
    mapping(uint256 => mapping(address => bool)) public approved;

    event Proposed(uint256 indexed id, address indexed target, bytes data);
    event Approved(uint256 indexed id, address indexed guardian);
    event Executed(uint256 indexed id);

    constructor(address[7] memory initialGuardians) {
        for (uint256 i; i < 7; ++i) {
            address g = initialGuardians[i];

            require(g != address(0), "zero guardian");
            require(!isGuardian[g], "duplicate guardian");

            guardians[i] = g;
            isGuardian[g] = true;
        }
    }

    function proposalCount() external view returns (uint256) {
        return proposals.length;
    }

    function proposal(uint256 id)
        external
        view
        returns (
            address target,
            bytes memory data,
            uint8 approvals,
            bool executed
        )
    {
        Proposal storage p = proposals[id];
        return (p.target, p.data, p.approvals, p.executed);
    }

    function propose(address target, bytes calldata data)
        external
        returns (uint256 id)
    {
        require(isGuardian[msg.sender], "guardian");
        require(target.code.length > 0, "target");

        id = proposals.length;

        proposals.push(
            Proposal({
                target: target,
                data: data,
                approvals: 1,
                executed: false
            })
        );

        approved[id][msg.sender] = true;

        emit Proposed(id, target, data);
        emit Approved(id, msg.sender);
    }

    function approve(uint256 id) external {
        require(isGuardian[msg.sender], "guardian");

        Proposal storage p = proposals[id];

        require(!p.executed, "executed");
        require(!approved[id][msg.sender], "already approved");

        approved[id][msg.sender] = true;
        p.approvals++;

        emit Approved(id, msg.sender);
    }

    function execute(uint256 id)
        external
        nonReentrant
        returns (bytes memory result)
    {
        Proposal storage p = proposals[id];

        require(!p.executed, "executed");
        require(p.approvals >= THRESHOLD, "5 of 7 required");

        p.executed = true;

        (bool ok, bytes memory ret) = p.target.call(p.data);

        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }

        emit Executed(id);
        return ret;
    }
}
