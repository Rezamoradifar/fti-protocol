// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ContinuityGovernance} from "./ContinuityGovernance.sol";
import {Initializable} from '@openzeppelin/contracts/proxy/utils/Initializable.sol';
import {UUPSUpgradeable} from '@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol';

import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {IERC20Metadata} from '@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {Pausable} from '@openzeppelin/contracts/utils/Pausable.sol';
import {Math} from '@openzeppelin/contracts/utils/math/Math.sol';
import {IFTI, Calendar} from './BinaryPlan.sol';
/// @notice Hourly pooled rewards and reusable monthly rank pools, paid only from funded books.
contract FundedBinaryPlanUpgradeable is ReentrancyGuard,Pausable,Initializable,UUPSUpgradeable {
    using SafeERC20 for IERC20;
    error InvalidOperation();
    uint256 public constant UNIT=100e18;
    uint256 public constant MAX_BATCH=100;
    uint256 public constant MAX_DEPTH=64;
    // Historical legacy cap; V3 uses the same amount as a protection target.
    uint256 public constant MAX_POINT_VALUE=20e18;
    uint256 public constant TARGET_POINT_VALUE=20e18;
    bool public pointValueIsTarget;
    bytes32 public constant rewardModel='HOURLY_POOL_SHARE_V2';
    uint256 public constant hourlyCapFlushVersion=1;
    IERC20 public usd;
    IFTI public token;
    address public governance;
    address public guardian;
    address public development;
    struct Member {address parent;address left;address right;uint256 units;uint256 carryL;uint256 carryR;uint256 lifetimeL;uint256 lifetimeR;uint8 rank;bool exists;bool autoEnabled;uint256 maxAutoPrice;}
    mapping(address=>Member) public members;
    address[] public memberList;
    mapping(address=>uint64[4]) public rankReachedAt;
    mapping(address=>uint256) public depth;
    mapping(address=>uint256) public activatedAtSerial;
    uint256 public fundingSerial;
    mapping(address=>uint256) public creditL;
    mapping(address=>uint256) public creditR;
    uint256 public queuedPointCredit;
    uint256 public assignedPointCredit;
    uint256 public retainedPointReserve;
    uint256 public queuedBuilderCredit;
    uint256 public assignedBuilderCredit;
    uint256 public retainedBuilderReserve;
    mapping(uint256=>address) public dirtyMembers;
    mapping(address=>bool) private dirty;
    uint256 public dirtyCount;
    uint256 private matchedFunding;
    uint256 private carriedDirtyCount;
    bool private fundingShortfall;
    struct Job {address child;address ancestor;uint256 units;uint256 pointShare;uint256[4] builderShares;uint256 month;uint256 serial;}
    Job[] public jobs;uint256 public jobCursor;
    uint256 public epoch=1;uint256 public epochEnd;uint256 public lastClosedAt;
    uint256 public epochUnits;uint256 public unitsSinceSettlement;uint256 public pointPool;
    uint8 public protectionLevel;uint8 public frozenLevel;
    uint8 public phase; // 0 deposits, 1 matching, 2 allocation
    uint256 public cursor;uint256 public frozenMembers;uint256 public totalPaidPoints;uint256 public pointValue;uint256 public frozenPool;uint256 public allocated;
    mapping(uint256=>mapping(address=>uint256)) public paidPoints;
    mapping(uint256=>mapping(address=>bool)) public autoSnapshot;
    mapping(uint256=>mapping(address=>bool)) public settled;
    mapping(address=>uint256) public pendingReward;
    mapping(address=>uint256) public pendingAuto;
    uint256 public totalPending;uint256 public totalAuto;
    address[] public rewardAccounts;
    mapping(address=>uint256) private rewardIndex;
    event RewardBatchPaid(uint256 accounts,uint256 amount);
    uint256 public builderAccounted;
    mapping(uint256=>uint256[4]) public monthFunding;
    uint256[4] public builderCarry;
    mapping(address=>bool[4]) public builderClaimed;
    uint256 public nextBuilderMonth;uint8 public monthPhase;uint256 public monthCursor;uint256 public monthMembers;
    uint256[4] public monthBalances;uint256[4] public monthEligible;uint256[4] public monthPay;
    mapping(uint256=>mapping(address=>uint256[4])) public builderCredit;
    mapping(uint256=>address[]) private builderAccounts;
    mapping(uint256=>mapping(address=>bool)) private builderSeen;
    uint256[4] public monthPaid;
    address[] public autoAccounts;
    mapping(address=>uint256) private autoIndex;
    event Registered(address indexed wallet,address indexed sponsor,uint256 units);
    event UnitsAdded(address indexed wallet,uint256 units);
    event EpochClosed(uint256 indexed epoch,uint256 pool,uint256 points,uint256 pointValue,uint8 nextProtection);
    event RewardAllocated(uint256 indexed epoch,address indexed wallet,uint256 cash,uint256 automatic);
    event HourlyCapFlushed(uint256 indexed epoch,address indexed wallet,uint256 points,uint256 retainedCredit);
    event Claimed(address indexed wallet,uint256 amount);
    event BuilderMonthClosed(uint256 indexed month);
    event AutoExecuted(address indexed wallet,uint256 usdIn,uint256 tokens);
    constructor(){_disableInitializers();}
    bytes32 public constant COMPONENT_ID=keccak256("FTI_BINARY_CONTINUITY_V1");
    function _authorizeUpgrade(address implementation) internal view override {
        ContinuityGovernance.validate(governance,guardian);
        require(msg.sender==governance,'governance');require(recoveryFrozen,'freeze first');
        _requireTokenFrozen();_backed();
        (bool ok,bytes memory data)=implementation.staticcall(abi.encodeWithSignature("COMPONENT_ID()"));
        require(ok&&data.length==32&&abi.decode(data,(bytes32))==COMPONENT_ID,'component');
    }
    function initialize(address stable,address fti,address gov,address emergency,address dev,address[31] memory genesis) external initializer nonReentrant {
        ContinuityGovernance.validate(gov,emergency);epoch=1;
        if(!(IERC20Metadata(stable).decimals()==18))revert InvalidOperation();
        if(!(fti.code.length>0&&gov!=address(0)&&emergency!=address(0)&&dev!=address(0)))revert InvalidOperation();
        (bool targetOk,bytes memory targetData)=fti.staticcall(abi.encodeWithSignature("POINT_VALUE_TARGET()"));
        pointValueIsTarget=targetOk&&targetData.length==32&&abi.decode(targetData,(uint256))==TARGET_POINT_VALUE;
        if(!(pointValueIsTarget))revert InvalidOperation();
        usd=IERC20(stable);token=IFTI(fti);governance=gov;guardian=emergency;development=dev;poolDistributionState=3;
        epochEnd=(block.timestamp/1 hours+1)*1 hours;(nextBuilderMonth,)=Calendar.month(block.timestamp);
        for(uint256 i;i<31;i++){
            address who=genesis[i];if(!(who!=address(0)&&!members[who].exists))revert InvalidOperation();
            members[who].exists=true;memberList.push(who);
            if(i>0){
                // Six rows: 1/2/4/8/8/8, preserving the supplied wallet order.
                // Here 1 <= i < 31; the second branch has i >= 15. Both
                // subtractions are safe and always select an earlier parent.
                uint256 parentIndex;unchecked{parentIndex=i<15?(i-1)/2:i-8;}
                address parent=genesis[parentIndex];members[who].parent=parent;depth[who]=depth[parent]+1;
                if(i%2==1)members[parent].left=who;else members[parent].right=who;
            }
        }
        usd.forceApprove(fti,type(uint256).max);
    }
    bool public recoveryFrozen;
    uint256 public recoveryCheckpointSerial;
    bytes32 public recoverySnapshotRoot;
    // Append-only epoch totals measured before the funded $20 payout filter.
    uint256 public candidatePoints;
    uint256 public candidateFunding;
    uint256 public calculatedPointValue;
    uint256 public constant PROTECTION_TRIGGER=16e18;
    // Append-only. Existing enabled wallets default to 5%; never reinterpret maxAutoPrice.
    mapping(address=>uint8) private _autoBuyPercent;
    // V2 append-only storage. The existing Member layout, parent tree and payout
    // accounting are deliberately unchanged for an upgradeable proxy.
    // For genesis / pre-upgrade members, directReferrerOf() falls back to parent.
    mapping(address=>address) public directReferrer;
    mapping(address=>uint256) public directReferralCount;
    // Append-only transition state. Old proxies cannot use new economics until
    // governance freezes both components and converts the unallocated credit books.
    // 0 legacy, 1 point-credit conversion, 2 builder-credit conversion, 3 active.
    uint8 public poolDistributionState;
    uint256 public poolMigrationCursor;
    uint256 public poolMigrationMonth;
    uint256 public poolMigrationLastMonth;
    event PoolDistributionActivated(uint256 pointFunds,uint256 builderFunds);
    function poolDistributionVersion() external view returns(uint256){return poolDistributionState==3?1:0;}
    function beginPoolDistribution() external {
        require(msg.sender==governance,'governance');
        if(!(recoveryFrozen&&poolDistributionState==0&&phase==0&&monthPhase==0&&jobCursor==jobs.length))revert InvalidOperation();
        _requireTokenFrozen();_backed();
        poolDistributionState=1;poolMigrationMonth=nextBuilderMonth;
        (poolMigrationLastMonth,)=Calendar.month(block.timestamp);
    }
    /// @notice Bounded conversion of unallocated credits only; cash, auto-buy,
    /// volume, ranks, claims and collateral are unchanged. No transfer is sent.
    function processPoolMigration(uint256 batch) external nonReentrant {
        if(!(recoveryFrozen&&poolDistributionState>0&&poolDistributionState<3&&batch>0&&batch<=MAX_BATCH))revert InvalidOperation();
        for(uint256 i;i<batch&&poolDistributionState<3;i++){
            if(poolDistributionState==1){
                if(poolMigrationCursor<memberList.length){
                    address who=memberList[poolMigrationCursor++];uint256 amount=creditL[who]+creditR[who];
                    delete creditL[who];delete creditR[who];assignedPointCredit-=amount;retainedPointReserve+=amount;
                }else{poolDistributionState=2;poolMigrationCursor=0;}
            }else if(poolMigrationMonth<=poolMigrationLastMonth){
                if(poolMigrationCursor<builderAccounts[poolMigrationMonth].length){
                    address who=builderAccounts[poolMigrationMonth][poolMigrationCursor++];
                    for(uint256 p;p<4;p++){uint256 amount=builderCredit[poolMigrationMonth][who][p];delete builderCredit[poolMigrationMonth][who][p];assignedBuilderCredit-=amount;retainedBuilderReserve+=amount;}
                }else{poolMigrationMonth++;poolMigrationCursor=0;}
            }else{
                if(!(queuedPointCredit==0&&assignedPointCredit==0&&queuedBuilderCredit==0&&assignedBuilderCredit==0&&retainedPointReserve==pointPool&&retainedBuilderReserve==builderAccounted))revert InvalidOperation();
                poolDistributionState=3;_backed();emit PoolDistributionActivated(pointPool,builderAccounted);
            }
        }
    }
    event ReferralPlacement(address indexed wallet,address indexed referrer,address indexed placementParent,uint8 side);
    event AutoBuyPreference(address indexed wallet,bool enabled,uint8 percent);
    event BuilderMonthCloseRequested(uint256 indexed month,uint256 effectiveAt);
    function autoBuyPercent(address who) public view returns(uint8){uint8 p=_autoBuyPercent[who];return p==0?5:p;}
    event RecoveryFreezeChanged(bool frozen);
    event RecoveryCheckpoint(uint256 indexed serial,bytes32 indexed root,uint256 blockNumber,bytes32 blockHash);
    modifier whenRecoveryOpen(){if(!(poolDistributionState==3&&!recoveryFrozen))revert InvalidOperation();_;}
    function setRecoveryFrozen(bool frozen) external {
        if(frozen){if(!(msg.sender==guardian||msg.sender==governance))revert InvalidOperation();}
        else {require(msg.sender==governance,'governance');if(poolDistributionState!=3)revert InvalidOperation();_backed();}
        recoveryFrozen=frozen;emit RecoveryFreezeChanged(frozen);
    }
    // This attests an export only. It grants no right to drain or mint assets.
    function recordRecoveryCheckpoint(bytes32 root,uint256 snapshotBlock) external {
        require(msg.sender==governance,'governance');require(recoveryFrozen,'freeze first');
        if(!(root!=bytes32(0)&&snapshotBlock<block.number&&block.number-snapshotBlock<=256))revert InvalidOperation();
        _requireTokenFrozen();
        _backed();recoverySnapshotRoot=root;recoveryCheckpointSerial++;
        emit RecoveryCheckpoint(recoveryCheckpointSerial,root,snapshotBlock,blockhash(snapshotBlock));
    }
    function rewardAccountCount() external view returns(uint256){return rewardAccounts.length;}
    function memberCount() external view returns(uint256){return memberList.length;}
    function jobCount() external view returns(uint256){return jobs.length;}
    function autoAccountCount() external view returns(uint256){return autoAccounts.length;}
    function builderAccountCount(uint256 month) external view returns(uint256){return builderAccounts[month].length;}
    function unitsOf(address who) external view returns(uint256){return members[who].units;}
    function rankOf(address who) external view returns(uint8){return members[who].rank;}
    function registered(address who) external view returns(bool){return members[who].exists;}
    function pause() external {if(!(msg.sender==guardian||msg.sender==governance))revert InvalidOperation();_pause();}
    function unpause() external {require(msg.sender==governance,'governance');_unpause();}
    /// @notice Legacy one-hop registration remains available to existing clients.
    /// The Registered event's sponsor argument is always the physical binary parent.
    function register(address sponsor,uint256 units) external nonReentrant whenRecoveryOpen whenNotPaused {
        _registerWithReferral(sponsor,sponsor,units);
    }
    /// @notice Unlimited direct invitations in the referral layer, while each
    /// binary position retains at most two physical child slots.
    /// @dev A UI/indexer proposes a free placement; the contract validates its
    /// ancestry and vacancy. No expensive unbounded tree search occurs on-chain.
    function registerWithPlacement(address referrer,address placementParent,uint256 units)
        external nonReentrant whenRecoveryOpen whenNotPaused
    {
        if(!(members[referrer].exists&&members[placementParent].exists))revert InvalidOperation();
        address ancestor=placementParent;
        // Depth is bounded by MAX_DEPTH, so ancestry verification is bounded.
        for(uint256 i=0;i<=MAX_DEPTH&&ancestor!=referrer;i++)ancestor=members[ancestor].parent;
        if(ancestor!=referrer)revert InvalidOperation();
        _registerWithReferral(referrer,placementParent,units);
    }
    function directReferrerOf(address who) external view returns(address){
        address r=directReferrer[who];return r!=address(0)?r:members[who].parent;
    }
    function _registerWithReferral(address referrer,address placementParent,uint256 units) private {
        if(!(!members[msg.sender].exists&&members[referrer].exists&&members[placementParent].exists&&
             referrer!=msg.sender&&placementParent!=msg.sender))revert InvalidOperation();
        Member storage p=members[placementParent];
        if(!((p.left==address(0)||p.right==address(0))&&depth[placementParent]<MAX_DEPTH))revert InvalidOperation();
        uint8 side=p.left==address(0)?0:1;
        depth[msg.sender]=depth[placementParent]+1;
        members[msg.sender].exists=true;members[msg.sender].parent=placementParent;memberList.push(msg.sender);
        if(side==0)p.left=msg.sender;else p.right=msg.sender;
        directReferrer[msg.sender]=referrer;directReferralCount[referrer]++;
        _fund(msg.sender,units,true);
        emit Registered(msg.sender,placementParent,units);
        emit ReferralPlacement(msg.sender,referrer,placementParent,side);
    }
    function addUnits(uint256 units) external nonReentrant whenRecoveryOpen whenNotPaused {if(!(members[msg.sender].exists))revert InvalidOperation();_fund(msg.sender,units,false);emit UnitsAdded(msg.sender,units);}
    function _fund(address who,uint256 units,bool newWallet) private {
        if(!(phase==0&&block.timestamp<epochEnd))revert InvalidOperation();if(!(units>0))revert InvalidOperation();
        _backed();uint256 amount=units*UNIT;uint256 beforeBal=usd.balanceOf(address(this));uint256 beforeUser=usd.balanceOf(who);
        usd.safeTransferFrom(who,address(this),amount);if(!(usd.balanceOf(address(this))-beforeBal==amount&&beforeUser-usd.balanceOf(who)==amount))revert InvalidOperation();
        fundingSerial++;if(members[who].units==0)activatedAtSerial[who]=fundingSerial;
        members[who].units+=units;epochUnits+=units;unitsSinceSettlement+=units;pointPool+=units*90e18;
        pendingReward[development]+=units*1e18;totalPending+=units*1e18;_trackReward(development);
        (uint256 monthKey,)=Calendar.month(block.timestamp);uint256[4] memory portions=[uint256(16e17),12e17,8e17,4e17];
        for(uint256 i;i<4;i++)monthFunding[monthKey][i]+=units*portions[i];builderAccounted+=units*4e18;
        address parent=members[who].parent;uint256[4] memory shares;
        retainedPointReserve+=units*90e18;retainedBuilderReserve+=units*4e18;
        if(parent!=address(0))jobs.push(Job(who,parent,units,0,shares,monthKey,fundingSerial));
        token.inject(units*5e18,newWallet);
        _backed();
    }
    function _touch(address who) private {if(!dirty[who]){dirty[who]=true;dirtyMembers[dirtyCount++]=who;}}
    function processVolume(uint256 steps) external nonReentrant whenRecoveryOpen {if(!(phase==0&&steps>0&&steps<=MAX_BATCH))revert InvalidOperation();
        for(uint256 i;i<steps&&jobCursor<jobs.length;i++){
            Job storage j=jobs[jobCursor];Member storage p=members[j.ancestor];
            bool left=p.left==j.child;if(!(left||p.right==j.child))revert InvalidOperation();
            // Eligibility is fixed at purchase serial, not at an arbitrary keeper execution time.
            bool active=activatedAtSerial[j.ancestor]>0&&activatedAtSerial[j.ancestor]<=j.serial;
            if(active){
                if(left){p.carryL+=j.units;p.lifetimeL+=j.units;}
                else{p.carryR+=j.units;p.lifetimeR+=j.units;}
                _touch(j.ancestor);
            }
            j.child=j.ancestor;j.ancestor=p.parent;if(j.ancestor==address(0))jobCursor++;
        }
    }
    function cap(uint8 rank,uint8 level) public pure returns(uint256){if(!(rank<5&&level<4))revert InvalidOperation();uint8[5][4] memory c=[[5,10,15,20,25],[5,10,12,16,20],[5,10,10,12,15],[5,10,10,10,10]];return c[level][rank];}
    function beginEpochClose() external nonReentrant whenRecoveryOpen {
        if(!(phase==0&&block.timestamp>=epochEnd&&jobCursor==jobs.length))revert InvalidOperation();
        _backed();candidatePoints=0;candidateFunding=pointPool;frozenMembers=dirtyCount;frozenLevel=protectionLevel;cursor=0;totalPaidPoints=0;allocated=0;frozenPool=pointPool;phase=1;
        if(frozenMembers==0)_finishEpoch();
    }
    function processEpoch(uint256 batch) external nonReentrant whenRecoveryOpen {
        if(!(batch>0&&batch<=MAX_BATCH&&phase>0))revert InvalidOperation();
        uint256 end=cursor+batch;if(end>frozenMembers)end=frozenMembers;
        if(phase==1){
            for(;cursor<end;cursor++){
                address who=dirtyMembers[cursor];Member storage m=members[who];uint256 raw=m.carryL<m.carryR?m.carryL:m.carryR;
                uint256 paid=raw<cap(m.rank,frozenLevel)?raw:cap(m.rank,frozenLevel);
                uint256 flushed=raw-paid;
                if(flushed>0)emit HourlyCapFlushed(epoch,who,flushed,0);
                // The entire smaller leg is consumed: capped points pay and
                // excess matches flush. Unmatched stronger-leg volume survives.
                m.carryL-=raw;m.carryR-=raw;paidPoints[epoch][who]=paid;totalPaidPoints+=paid;
                autoSnapshot[epoch][who]=m.autoEnabled&&m.rank>0;
                dirty[who]=false;
                uint256 lifetime=m.lifetimeL<m.lifetimeR?m.lifetimeL:m.lifetimeR;uint256[4] memory thresholds=[uint256(100),200,500,1000];
                if(m.units>0)for(uint256 r=m.rank;r<4;r++){if(lifetime>=thresholds[r]){m.rank=uint8(r+1);rankReachedAt[who][r]=uint64(epochEnd);}else break;}
            }
            if(cursor==frozenMembers){candidatePoints=totalPaidPoints;pointValue=totalPaidPoints==0?0:frozenPool/totalPaidPoints;cursor=0;phase=2;}
        }else{
            for(;cursor<end;cursor++){
                address who=dirtyMembers[cursor];
                // Divide once per wallet, rather than rounding every point.
                // With eligible points, remaining dust is < one wei per recipient.
                uint256 reward=totalPaidPoints==0?0:Math.mulDiv(frozenPool,paidPoints[epoch][who],totalPaidPoints);
                uint256 automatic=autoSnapshot[epoch][who]?Math.mulDiv(reward,autoBuyPercent(who),100):0;
                pendingReward[who]+=reward-automatic;totalPending+=reward-automatic;_trackReward(who);pendingAuto[who]+=automatic;totalAuto+=automatic;
                if(automatic>0)_trackAuto(who);allocated+=reward;pointPool-=reward;retainedPointReserve-=reward;settled[epoch][who]=true;
                emit RewardAllocated(epoch,who,reward-automatic,automatic);
            }
            if(cursor==frozenMembers)_finishEpoch();
        }
    }
    // Strictly below $16 increases protection; $16 through $20 holds it.
    // No candidate points means no price observation, not a zero-value point.
    function protectionForValue(uint8 level,uint256 budget,uint256 points) public pure returns(uint8){
        if(!(level<4))revert InvalidOperation();
        if(points==0)return level;
        uint256 value=budget/points;
        if(value<PROTECTION_TRIGGER&&level<3)return level+1;
        if(value>TARGET_POINT_VALUE&&level>0)return level-1;
        return level;
    }
    function _finishEpoch() private {
        pointValue=totalPaidPoints==0?0:frozenPool/totalPaidPoints;
        calculatedPointValue=pointValue;
        protectionLevel=protectionForValue(protectionLevel,candidateFunding,candidatePoints);
        unitsSinceSettlement=0;
        // Reuse indexed slots: deleting an unbounded storage array would itself be an O(N) close.
        dirtyCount=0;emit EpochClosed(epoch,frozenPool,totalPaidPoints,pointValue,protectionLevel);_nextEpoch();
    }
    function _nextEpoch() private {lastClosedAt=(block.timestamp/1 hours)*1 hours;epoch++;epochEnd=(block.timestamp/1 hours+1)*1 hours;epochUnits=0;phase=0;cursor=0;}
    // Legacy ABI retained. Its former maximum-price argument is ignored, not repurposed.
    function setAutoBuy(bool enabled,uint256) external nonReentrant whenRecoveryOpen {_setAutoBuy(enabled,autoBuyPercent(msg.sender));}
    function setAutoBuyPercent(bool enabled,uint8 percent) external nonReentrant whenRecoveryOpen {_setAutoBuy(enabled,percent);}
    function _setAutoBuy(bool enabled,uint8 percent) private {
        if(!(phase==0&&members[msg.sender].exists&&percent>=5&&percent<=100))revert InvalidOperation();
        members[msg.sender].autoEnabled=enabled;_autoBuyPercent[msg.sender]=percent;
        if(enabled&&pendingAuto[msg.sender]>0)_trackAuto(msg.sender);else _removeAuto(msg.sender);
        emit AutoBuyPreference(msg.sender,enabled,percent);
    }
    function _trackAuto(address who) private {if(autoIndex[who]==0){autoAccounts.push(who);autoIndex[who]=autoAccounts.length;}}
    function _removeAuto(address who) private {uint256 at=autoIndex[who];if(at==0)return;address last=autoAccounts[autoAccounts.length-1];autoAccounts[at-1]=last;autoIndex[last]=at;autoAccounts.pop();delete autoIndex[who];}
    function executeAuto(address who,uint256 amount) external nonReentrant whenRecoveryOpen {
        _backed();
        if(!(amount>0&&amount<=pendingAuto[who]))revert InvalidOperation();
        if(!(members[who].autoEnabled))revert InvalidOperation();
        // Keeper uses a full bounded tranche, never arbitrary dust. The existing
        // token's 128 x $500 transaction bound and wallet purchase allowance still apply.
        uint256 batch=pendingAuto[who]>64000e18?64000e18:pendingAuto[who];
        if(!(msg.sender==who||amount==batch))revert InvalidOperation();
        // No user maximum-price gate. Quote and buy occur in the same transaction;
        // exact minimum output, fees and ordinary allowance checks remain enforced.
        uint256 minimum=token.quoteBuy(amount);if(!(minimum>0))revert InvalidOperation();
        pendingAuto[who]-=amount;totalAuto-=amount;
        if(pendingAuto[who]==0)_removeAuto(who);
        uint256 beforeBal=usd.balanceOf(address(this));uint256 minted=token.autoBuy(who,amount,minimum,block.timestamp);
        if(!(beforeBal-usd.balanceOf(address(this))==amount))revert InvalidOperation();_backed();emit AutoExecuted(who,amount,minted);
    }
    function releaseAutoToCash() external nonReentrant whenRecoveryOpen {uint256 amount=pendingAuto[msg.sender];pendingAuto[msg.sender]=0;totalAuto-=amount;pendingReward[msg.sender]+=amount;totalPending+=amount;_trackReward(msg.sender);_removeAuto(msg.sender);}
    function _trackReward(address who) private {
        if(pendingReward[who]>0&&rewardIndex[who]==0){rewardAccounts.push(who);rewardIndex[who]=rewardAccounts.length;}
    }
    function _removeReward(address who) private {
        uint256 at=rewardIndex[who];if(at==0)return;
        address last=rewardAccounts[rewardAccounts.length-1];
        rewardAccounts[at-1]=last;rewardIndex[last]=at;rewardAccounts.pop();delete rewardIndex[who];
    }
    function _payReward(address who) private returns(uint256 amount) {
        amount=pendingReward[who];if(!(amount>0))revert InvalidOperation();
        pendingReward[who]=0;totalPending-=amount;_removeReward(who);
        uint256 beforeBal=usd.balanceOf(address(this));uint256 beforeUser=usd.balanceOf(who);
        usd.safeTransfer(who,amount);
        if(!(beforeBal-usd.balanceOf(address(this))==amount&&usd.balanceOf(who)-beforeUser==amount))revert InvalidOperation();
        emit Claimed(who,amount);
    }
    /// @notice Permissionless bounded payout; caller cannot choose a recipient or amount.
    /// Remaining queue entries persist for the next transaction/keeper iteration.
    function payRewards(uint256 batch) external nonReentrant whenRecoveryOpen returns(uint256 accounts,uint256 amount) {
        if(!(batch>0&&batch<=MAX_BATCH))revert InvalidOperation();
        if(!(phase==0&&monthPhase==0))revert InvalidOperation();_backed();
        while(accounts<batch&&rewardAccounts.length>0){
            amount+=_payReward(rewardAccounts[rewardAccounts.length-1]);accounts++;
        }
        _backed();emit RewardBatchPaid(accounts,amount);
    }
    function claim() external nonReentrant whenRecoveryOpen {_backed();_payReward(msg.sender);_backed();}
    function beginBuilderMonth() external nonReentrant whenRecoveryOpen {
        uint256 end=Calendar.endOf(nextBuilderMonth);if(!(monthPhase==0))revert InvalidOperation();
        // Early requests never drain, snapshot or reset this month's funding.
        // Keeper starts work at/after 00:00 UTC on the first of the next month,
        // once hourly settlement reaches that boundary. A request is not a payout.
        if(block.timestamp<end||lastClosedAt<end){emit BuilderMonthCloseRequested(nextBuilderMonth,end);return;}
        if(phase!=0||jobCursor!=jobs.length)revert InvalidOperation();
        monthMembers=memberList.length;monthCursor=0;monthPhase=1;
        for(uint256 p;p<4;p++){monthBalances[p]=builderCarry[p]+monthFunding[nextBuilderMonth][p];monthFunding[nextBuilderMonth][p]=0;builderCarry[p]=0;monthEligible[p]=0;monthPaid[p]=0;monthPay[p]=0;}
    }
    function _eligible(address who,uint256 p,uint256 end) private view returns(bool){uint256 at=rankReachedAt[who][p];return at>0&&at<=end&&!builderClaimed[who][p];}
    function processBuilderMonth(uint256 batch) external nonReentrant whenRecoveryOpen {
        if(!(monthPhase>0&&batch>0&&batch<=MAX_BATCH))revert InvalidOperation();uint256 end=monthCursor+batch;if(end>monthMembers)end=monthMembers;uint256 cutoff=Calendar.endOf(nextBuilderMonth);
        if(monthPhase==1){
            for(;monthCursor<end;monthCursor++)for(uint256 p;p<4;p++)if(_eligible(memberList[monthCursor],p,cutoff))monthEligible[p]++;
            if(monthCursor==monthMembers){for(uint256 p;p<4;p++)monthPay[p]=monthBalances[p]/(monthEligible[p]>5?monthEligible[p]:5);monthCursor=0;monthPhase=2;}
        }else{
            for(;monthCursor<end;monthCursor++){
                address who=memberList[monthCursor];
                for(uint256 p;p<4;p++)if(_eligible(who,p,cutoff)&&monthPay[p]>0){
                    uint256 pay=monthPay[p];builderClaimed[who][p]=true;pendingReward[who]+=pay;totalPending+=pay;_trackReward(who);builderAccounted-=pay;retainedBuilderReserve-=pay;monthPaid[p]+=pay;
                }
            }
            if(monthCursor==monthMembers)_finishBuilderMonth();
        }
    }
    function _finishBuilderMonth() private {for(uint256 p;p<4;p++)builderCarry[p]+=monthBalances[p]-monthPaid[p];emit BuilderMonthClosed(nextBuilderMonth);nextBuilderMonth++;monthPhase=0;monthCursor=0;}
    function fundingAccounting() external view returns(uint256 pointCredits,uint256 pointBook,uint256 builderCredits,uint256 builderBook){return(queuedPointCredit+assignedPointCredit+retainedPointReserve,pointPool,queuedBuilderCredit+assignedBuilderCredit+retainedBuilderReserve,builderAccounted);}
    function _requireTokenFrozen() private view {
        (bool ok,bytes memory data)=address(token).staticcall(abi.encodeWithSignature('recoveryFrozen()'));
        if(!(ok&&data.length==32&&abi.decode(data,(bool))))revert InvalidOperation();
    }
    function _backed() private view {if(!(usd.balanceOf(address(this))>=pointPool+builderAccounted+totalPending+totalAuto))revert InvalidOperation();}
    function accounting() external view returns(uint256 actual,uint256 accounted){return(usd.balanceOf(address(this)),pointPool+builderAccounted+totalPending+totalAuto);}
    function rescue(address asset,address to,uint256 amount) external nonReentrant whenRecoveryOpen {if(!(msg.sender==governance&&asset!=address(usd)&&asset!=address(token)))revert InvalidOperation();IERC20(asset).safeTransfer(to,amount);}
}
