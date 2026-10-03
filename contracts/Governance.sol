// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {TimelockController} from '@openzeppelin/contracts/governance/TimelockController.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';

/// @notice Fixed seven-owner council with five independent approvals required.
/// @dev Used as emergency guardian and sole proposer for the timelock.
///      The emergency path may activate redemption-only mode, but cannot transfer
///      the token reserve to an arbitrary administrator address.
contract Council is ReentrancyGuard {
    uint8 public constant OWNER_COUNT=7;
    uint8 public constant THRESHOLD=5;

    address[7] public owners;
    mapping(address=>bool) public isOwner;

    struct Proposal {address target;bytes data;uint8 approvals;bool executed;}
    Proposal[] private proposals;
    mapping(uint256=>mapping(address=>bool)) public approved;

    event Proposed(uint256 indexed id,address indexed target,bytes data);
    event Approved(uint256 indexed id,address indexed owner);
    event Executed(uint256 indexed id);\n    event OwnerReplaced(address indexed oldOwner,address indexed newOwner,uint256 indexed slot);

    constructor(address[7] memory initial){
        for(uint256 i;i<OWNER_COUNT;i++){
            require(initial[i]!=address(0)&&!isOwner[initial[i]],'owner');
            owners[i]=initial[i];
            isOwner[initial[i]]=true;
        }
    }

    function count() external view returns(uint256){return proposals.length;}
    function proposal(uint256 id) external view returns(address,bytes memory,uint8,bool){
        Proposal storage p=proposals[id];
        return(p.target,p.data,p.approvals,p.executed);
    }

    function propose(address target,bytes calldata data) external returns(uint256 id){
        require(isOwner[msg.sender]&&target.code.length>0,'owner/target');
        id=proposals.length;
        proposals.push(Proposal(target,data,1,false));
        approved[id][msg.sender]=true;
        emit Proposed(id,target,data);
        emit Approved(id,msg.sender);
    }

    function approve(uint256 id) external {
        require(isOwner[msg.sender]&&!approved[id][msg.sender]&&!proposals[id].executed,'approval');
        approved[id][msg.sender]=true;
        proposals[id].approvals++;
        emit Approved(id,msg.sender);
    }

    function execute(uint256 id) external nonReentrant returns(bytes memory result){
        Proposal storage p=proposals[id];
        require(p.approvals>=THRESHOLD&&!p.executed,'threshold');
        p.executed=true;
        (bool ok,bytes memory ret)=p.target.call(p.data);
        if(!ok){assembly{revert(add(ret,32),mload(ret))}}
        emit Executed(id);
        return ret;
    }

    /// @notice Key rotation requires a normal 5-of-7 proposal targeting the Council itself.
    function replaceOwner(address oldOwner,address newOwner) external {
        require(msg.sender==address(this),'self only');
        require(oldOwner!=address(0)&&newOwner!=address(0)&&isOwner[oldOwner]&&!isOwner[newOwner],'owner');
        uint256 slot=type(uint256).max;
        for(uint256 i;i<OWNER_COUNT;i++)if(owners[i]==oldOwner){slot=i;break;}
        require(slot<OWNER_COUNT,'slot');
        owners[slot]=newOwner;
        isOwner[oldOwner]=false;
        isOwner[newOwner]=true;
        emit OwnerReplaced(oldOwner,newOwner,slot);
    }
}

/// @notice Normal governance operations retain the existing 72-hour initial timelock.
/// @dev Emergency redemption-only activation is performed by the 5-of-7 Council directly.
contract FTITimelock is TimelockController {
    uint256 public constant FIXED_MIN_DELAY=72 hours;
    constructor(address council)
        TimelockController(FIXED_MIN_DELAY,_one(council),_one(address(0)),address(0))
    {}

    /// @notice V2 governance delay cannot be reduced after deployment.
    function updateDelay(uint256) external pure override {
        revert('fixed 72h delay');
    }

    function _one(address a) private pure returns(address[] memory r){
        r=new address[](1);
        r[0]=a;
    }
}
