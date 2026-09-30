// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {TimelockController} from '@openzeppelin/contracts/governance/TimelockController.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
/// @notice Fixed five owners, three independent approvals. No owner replacement shortcut.
contract Council is ReentrancyGuard {
    address[5] public owners;mapping(address=>bool) public isOwner;
    struct Proposal{address target;bytes data;uint8 approvals;bool executed;}
    Proposal[] private proposals;mapping(uint256=>mapping(address=>bool)) public approved;
    event Proposed(uint256 indexed id,address indexed target,bytes data);
    event Approved(uint256 indexed id,address indexed owner);
    event Executed(uint256 indexed id);
    constructor(address[5] memory initial){for(uint256 i;i<5;i++){require(initial[i]!=address(0)&&!isOwner[initial[i]],'owner');owners[i]=initial[i];isOwner[initial[i]]=true;}}
    function count() external view returns(uint256){return proposals.length;}
    function proposal(uint256 id) external view returns(address,bytes memory,uint8,bool){Proposal storage p=proposals[id];return(p.target,p.data,p.approvals,p.executed);}
    function propose(address target,bytes calldata data) external returns(uint256 id){require(isOwner[msg.sender]&&target.code.length>0,'owner/target');id=proposals.length;proposals.push(Proposal(target,data,1,false));approved[id][msg.sender]=true;emit Proposed(id,target,data);emit Approved(id,msg.sender);}
    function approve(uint256 id) external {require(isOwner[msg.sender]&&!approved[id][msg.sender]&&!proposals[id].executed,'approval');approved[id][msg.sender]=true;proposals[id].approvals++;emit Approved(id,msg.sender);}
    function execute(uint256 id) external nonReentrant returns(bytes memory result){Proposal storage p=proposals[id];require(p.approvals>=3&&!p.executed,'threshold');p.executed=true;(bool ok,bytes memory ret)=p.target.call(p.data);if(!ok){assembly{revert(add(ret,32),mload(ret))}}emit Executed(id);return ret;}
}
contract FTITimelock is TimelockController {
    constructor(address council) TimelockController(72 hours,_one(council),_one(address(0)),address(0)){}
    function _one(address a) private pure returns(address[] memory r){r=new address[](1);r[0]=a;}
}
