// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {IERC20Metadata} from '@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {Pausable} from '@openzeppelin/contracts/utils/Pausable.sol';
import {Math} from '@openzeppelin/contracts/utils/math/Math.sol';
import {IFTI, Calendar} from './BinaryPlan.sol';
/// @notice Candidate with source-attributed funding; global carried funds cannot fund unrelated rewards.
contract FundedBinaryPlanFloor is ReentrancyGuard,Pausable {
    using SafeERC20 for IERC20;
    uint256 public constant UNIT=100e18;
    uint256 public constant MAX_BATCH=100;
    uint256 public constant MAX_DEPTH=64;
    // Historical legacy cap; V3 uses the same amount as a protection target.
    uint256 public constant MAX_POINT_VALUE=20e18;
    uint256 public constant TARGET_POINT_VALUE=20e18;
    bool public immutable pointValueIsTarget;
    bytes32 public constant rewardModel='FUNDED_POINT_FLOOR_V1';
    IERC20 public immutable usd;
    IFTI public immutable token;
    address public immutable governance;
    address public immutable guardian;
    address public immutable development;
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
    event Claimed(address indexed wallet,uint256 amount);
    event BuilderMonthClosed(uint256 indexed month);
    event AutoExecuted(address indexed wallet,uint256 usdIn,uint256 tokens);
    constructor(address stable,address fti,address gov,address emergency,address dev,address[31] memory genesis){
        require(IERC20Metadata(stable).decimals()==18,'requires 18 decimal USD');
        require(fti.code.length>0&&gov!=address(0)&&emergency!=address(0)&&dev!=address(0),'addresses');
        (bool targetOk,bytes memory targetData)=fti.staticcall(abi.encodeWithSignature("POINT_VALUE_TARGET()"));
        pointValueIsTarget=targetOk&&targetData.length==32&&abi.decode(targetData,(uint256))==TARGET_POINT_VALUE;
        require(pointValueIsTarget,"V3 target required");
        usd=IERC20(stable);token=IFTI(fti);governance=gov;guardian=emergency;development=dev;
        epochEnd=(block.timestamp/1 hours+1)*1 hours;(nextBuilderMonth,)=Calendar.month(block.timestamp);
        for(uint256 i;i<31;i++){
            address who=genesis[i];require(who!=address(0)&&!members[who].exists,'genesis');
            members[who].exists=true;memberList.push(who);
            if(i>0){address parent=genesis[(i-1)/2];members[who].parent=parent;depth[who]=depth[parent]+1;if(i%2==1)members[parent].left=who;else members[parent].right=who;}
        }
        usd.forceApprove(fti,type(uint256).max);
    }
    function rewardAccountCount() external view returns(uint256){return rewardAccounts.length;}
    function memberCount() external view returns(uint256){return memberList.length;}
    function jobCount() external view returns(uint256){return jobs.length;}
    function autoAccountCount() external view returns(uint256){return autoAccounts.length;}
    function builderAccountCount(uint256 month) external view returns(uint256){return builderAccounts[month].length;}
    function unitsOf(address who) external view returns(uint256){return members[who].units;}
    function rankOf(address who) external view returns(uint8){return members[who].rank;}
    function registered(address who) external view returns(bool){return members[who].exists;}
    function pause() external {require(msg.sender==guardian||msg.sender==governance,'role');_pause();}
    function unpause() external {require(msg.sender==governance,'governance');_unpause();}
    function register(address sponsor,uint256 units) external nonReentrant whenNotPaused {
        require(!members[msg.sender].exists&&members[sponsor].exists&&sponsor!=msg.sender,'registration');
        Member storage p=members[sponsor];require(p.right==address(0),'sponsor full');
        require(depth[sponsor]<MAX_DEPTH,'maximum tree depth');depth[msg.sender]=depth[sponsor]+1;
        members[msg.sender].exists=true;members[msg.sender].parent=sponsor;memberList.push(msg.sender);
        if(p.left==address(0))p.left=msg.sender;else p.right=msg.sender;
        _fund(msg.sender,units,true);emit Registered(msg.sender,sponsor,units);
    }
    function addUnits(uint256 units) external nonReentrant whenNotPaused {require(members[msg.sender].exists,'member');_fund(msg.sender,units,false);emit UnitsAdded(msg.sender,units);}
    function _fund(address who,uint256 units,bool newWallet) private {
        require(phase==0&&block.timestamp<epochEnd,'settlement required');require(units>0&&units<=1000000,'unit range');
        _backed();uint256 amount=units*UNIT;uint256 beforeBal=usd.balanceOf(address(this));uint256 beforeUser=usd.balanceOf(who);
        usd.safeTransferFrom(who,address(this),amount);require(usd.balanceOf(address(this))-beforeBal==amount&&beforeUser-usd.balanceOf(who)==amount,'unsupported USD');
        fundingSerial++;if(members[who].units==0)activatedAtSerial[who]=fundingSerial;
        members[who].units+=units;epochUnits+=units;unitsSinceSettlement+=units;pointPool+=units*90e18;
        pendingReward[development]+=units*1e18;totalPending+=units*1e18;_trackReward(development);
        (uint256 monthKey,)=Calendar.month(block.timestamp);uint256[4] memory portions=[uint256(16e17),12e17,8e17,4e17];
        for(uint256 i;i<4;i++)monthFunding[monthKey][i]+=units*portions[i];builderAccounted+=units*4e18;
        address parent=members[who].parent;uint256 d=depth[who];uint256 pointShare=d==0?0:units*90e18/d;uint256[4] memory shares;
        queuedPointCredit+=pointShare*d;retainedPointReserve+=units*90e18-pointShare*d;
        for(uint256 i;i<4;i++){shares[i]=d==0?0:units*portions[i]/d;queuedBuilderCredit+=shares[i]*d;retainedBuilderReserve+=units*portions[i]-shares[i]*d;}
        if(parent!=address(0))jobs.push(Job(who,parent,units,pointShare,shares,monthKey,fundingSerial));
        token.inject(units*5e18,newWallet);
        _backed();
    }
    function _touch(address who) private {if(!dirty[who]){dirty[who]=true;dirtyMembers[dirtyCount++]=who;}}
    function processVolume(uint256 steps) external nonReentrant {require(phase==0&&steps>0&&steps<=MAX_BATCH,'batch');
        for(uint256 i;i<steps&&jobCursor<jobs.length;i++){
            Job storage j=jobs[jobCursor];Member storage p=members[j.ancestor];
            bool left=p.left==j.child;require(left||p.right==j.child,'tree');
            // Eligibility is fixed at purchase serial, not at an arbitrary keeper execution time.
            bool active=activatedAtSerial[j.ancestor]>0&&activatedAtSerial[j.ancestor]<=j.serial;
            queuedPointCredit-=j.pointShare;
            if(active){
                if(left){p.carryL+=j.units;p.lifetimeL+=j.units;creditL[j.ancestor]+=j.pointShare;}
                else{p.carryR+=j.units;p.lifetimeR+=j.units;creditR[j.ancestor]+=j.pointShare;}
                assignedPointCredit+=j.pointShare;_touch(j.ancestor);
                if(!builderSeen[j.month][j.ancestor]){builderSeen[j.month][j.ancestor]=true;builderAccounts[j.month].push(j.ancestor);}
            }else retainedPointReserve+=j.pointShare;
            for(uint256 tier;tier<4;tier++){
                uint256 amount=j.builderShares[tier];queuedBuilderCredit-=amount;
                if(active){builderCredit[j.month][j.ancestor][tier]+=amount;assignedBuilderCredit+=amount;}
                else retainedBuilderReserve+=amount;
            }
            j.child=j.ancestor;j.ancestor=p.parent;if(j.ancestor==address(0))jobCursor++;
        }
    }
    function cap(uint8 rank,uint8 level) public pure returns(uint256){require(rank<5&&level<4,'cap');uint8[5][4] memory c=[[5,10,15,20,25],[5,10,12,16,20],[5,10,10,12,15],[5,10,10,10,10]];return c[level][rank];}
    function beginEpochClose() external nonReentrant {
        require(phase==0&&block.timestamp>=epochEnd&&jobCursor==jobs.length,'not ready');
        if(unitsSinceSettlement<5&&dirtyCount==0){_nextEpoch();return;}
        carriedDirtyCount=0;fundingShortfall=false;frozenMembers=dirtyCount;frozenLevel=protectionLevel;cursor=0;totalPaidPoints=0;allocated=0;matchedFunding=0;frozenPool=pointPool;phase=1;
        if(frozenMembers==0)_finishEpoch();
    }
    function processEpoch(uint256 batch) external nonReentrant {
        require(batch>0&&batch<=MAX_BATCH&&phase>0,'batch');
        uint256 end=cursor+batch;if(end>frozenMembers)end=frozenMembers;
            for(;cursor<end;cursor++){
                address who=dirtyMembers[cursor];Member storage m=members[who];uint256 raw=m.carryL<m.carryR?m.carryL:m.carryR;
                uint256 paid=raw<cap(m.rank,frozenLevel)?raw:cap(m.rank,frozenLevel);
                uint256 takenL=raw==0?0:Math.mulDiv(creditL[who],raw,m.carryL);
                uint256 takenR=raw==0?0:Math.mulDiv(creditR[who],raw,m.carryR);
                uint256 taken=takenL+takenR;uint256 budget=raw==0?0:Math.mulDiv(taken,paid,raw);
                // Count only points backed by at least $20 of this wallet's credit.
                // Keep unpaid matching volume and unspent credit for later epochs.
                uint256 funded=budget/TARGET_POINT_VALUE;
                if(funded<paid){paid=funded;fundingShortfall=true;}
                uint256 reward=paid==0?0:budget;
                uint256 spentL=taken==0?0:Math.mulDiv(reward,takenL,taken);
                uint256 spentR=reward-spentL;
                creditL[who]-=spentL;creditR[who]-=spentR;assignedPointCredit-=reward;
                m.carryL-=paid;m.carryR-=paid;paidPoints[epoch][who]=paid;totalPaidPoints+=paid;matchedFunding+=reward;
                autoSnapshot[epoch][who]=m.autoEnabled&&m.rank>0;
                uint256 automatic=autoSnapshot[epoch][who]?reward*5/100:0;
                pendingReward[who]+=reward-automatic;totalPending+=reward-automatic;_trackReward(who);pendingAuto[who]+=automatic;totalAuto+=automatic;
                if(automatic>0)_trackAuto(who);allocated+=reward;pointPool-=reward;settled[epoch][who]=true;
                dirty[who]=m.carryL>0&&m.carryR>0;
                if(dirty[who])dirtyMembers[carriedDirtyCount++]=who;
                emit RewardAllocated(epoch,who,reward-automatic,automatic);
                uint256 lifetime=m.lifetimeL<m.lifetimeR?m.lifetimeL:m.lifetimeR;uint256[4] memory thresholds=[uint256(100),200,500,1000];
                if(m.units>0)for(uint256 r=m.rank;r<4;r++){if(lifetime>=thresholds[r]){m.rank=uint8(r+1);rankReachedAt[who][r]=uint64(epochEnd);}else break;}
            }
            if(cursor==frozenMembers)_finishEpoch();
    }
    function _finishEpoch() private {
        pointValue=totalPaidPoints==0?0:allocated/totalPaidPoints;
        if(fundingShortfall&&protectionLevel<3)protectionLevel++;
        if(totalPaidPoints>0){
            if(!fundingShortfall&&matchedFunding<TARGET_POINT_VALUE*totalPaidPoints&&protectionLevel<3)protectionLevel++;
            else if(!fundingShortfall&&matchedFunding>TARGET_POINT_VALUE*totalPaidPoints&&protectionLevel>0)protectionLevel--;
            unitsSinceSettlement=0;
        }
        // Reuse indexed slots: deleting an unbounded storage array would itself be an O(N) close.
        dirtyCount=carriedDirtyCount;emit EpochClosed(epoch,frozenPool,totalPaidPoints,pointValue,protectionLevel);_nextEpoch();
    }
    function _nextEpoch() private {lastClosedAt=(block.timestamp/1 hours)*1 hours;epoch++;epochEnd=(block.timestamp/1 hours+1)*1 hours;epochUnits=0;phase=0;cursor=0;}
    function setAutoBuy(bool enabled,uint256 maxPrice) external nonReentrant {require(phase==0,'settings frozen');require(members[msg.sender].exists,'member');require(!enabled||maxPrice>0,'price limit');members[msg.sender].autoEnabled=enabled;members[msg.sender].maxAutoPrice=maxPrice;if(enabled&&pendingAuto[msg.sender]>0)_trackAuto(msg.sender);else _removeAuto(msg.sender);}
    function _trackAuto(address who) private {if(autoIndex[who]==0){autoAccounts.push(who);autoIndex[who]=autoAccounts.length;}}
    function _removeAuto(address who) private {uint256 at=autoIndex[who];if(at==0)return;address last=autoAccounts[autoAccounts.length-1];autoAccounts[at-1]=last;autoIndex[last]=at;autoAccounts.pop();delete autoIndex[who];}
    function executeAuto(address who,uint256 amount) external nonReentrant {
        _backed();
        require(amount>0&&amount<=pendingAuto[who],'amount');
        require(members[who].autoEnabled,'auto disabled');
        // A keeper may not split someone else's reward into dust-sized lock tranches.
        // The beneficiary can still request a deliberate partial purchase.
        require(msg.sender==who||amount==pendingAuto[who],'partial auto owner only');
        uint256 maxPrice=members[who].maxAutoPrice;
        require(maxPrice>0&&token.price()<=maxPrice,'auto price limit');
        uint256 minimum=token.quoteBuy(amount);require(minimum>0,'dust');
        // Max price is the total USD paid per FTI received, including fees/curve impact.
        require(minimum>=Math.mulDiv(amount,1e18,maxPrice,Math.Rounding.Ceil),'auto execution price');
        pendingAuto[who]-=amount;totalAuto-=amount;
        if(pendingAuto[who]==0)_removeAuto(who);
        uint256 beforeBal=usd.balanceOf(address(this));uint256 minted=token.autoBuy(who,amount,minimum,block.timestamp);
        require(beforeBal-usd.balanceOf(address(this))==amount,'unsupported USD');_backed();emit AutoExecuted(who,amount,minted);
    }
    function releaseAutoToCash() external nonReentrant {uint256 amount=pendingAuto[msg.sender];pendingAuto[msg.sender]=0;totalAuto-=amount;pendingReward[msg.sender]+=amount;totalPending+=amount;_trackReward(msg.sender);_removeAuto(msg.sender);}
    function _trackReward(address who) private {
        if(pendingReward[who]>0&&rewardIndex[who]==0){rewardAccounts.push(who);rewardIndex[who]=rewardAccounts.length;}
    }
    function _removeReward(address who) private {
        uint256 at=rewardIndex[who];if(at==0)return;
        address last=rewardAccounts[rewardAccounts.length-1];
        rewardAccounts[at-1]=last;rewardIndex[last]=at;rewardAccounts.pop();delete rewardIndex[who];
    }
    function _payReward(address who) private returns(uint256 amount) {
        amount=pendingReward[who];require(amount>0,'no reward');
        pendingReward[who]=0;totalPending-=amount;_removeReward(who);
        uint256 beforeBal=usd.balanceOf(address(this));uint256 beforeUser=usd.balanceOf(who);
        usd.safeTransfer(who,amount);
        require(beforeBal-usd.balanceOf(address(this))==amount&&usd.balanceOf(who)-beforeUser==amount,'unsupported USD');
        emit Claimed(who,amount);
    }
    /// @notice Permissionless bounded payout; caller cannot choose a recipient or amount.
    /// Remaining queue entries persist for the next transaction/keeper iteration.
    function payRewards(uint256 batch) external nonReentrant returns(uint256 accounts,uint256 amount) {
        require(batch>0&&batch<=MAX_BATCH,'batch');
        require(phase==0&&monthPhase==0,'settlement incomplete');_backed();
        while(accounts<batch&&rewardAccounts.length>0){
            amount+=_payReward(rewardAccounts[rewardAccounts.length-1]);accounts++;
        }
        _backed();emit RewardBatchPaid(accounts,amount);
    }
    function claim() external nonReentrant {_backed();_payReward(msg.sender);_backed();}
    function beginBuilderMonth() external nonReentrant {
        uint256 end=Calendar.endOf(nextBuilderMonth);require(monthPhase==0&&block.timestamp>=end&&lastClosedAt>=end,'month not ready');
        monthMembers=builderAccounts[nextBuilderMonth].length;monthCursor=0;monthPhase=1;
        for(uint256 p;p<4;p++){monthBalances[p]=monthFunding[nextBuilderMonth][p];monthFunding[nextBuilderMonth][p]=0;monthEligible[p]=0;monthPaid[p]=0;monthPay[p]=monthBalances[p]/5;}
        if(monthMembers==0)_finishBuilderMonth();
    }
    function _eligible(address who,uint256 p,uint256 end) private view returns(bool){uint256 at=rankReachedAt[who][p];return at>0&&at<=end&&!builderClaimed[who][p];}
    function processBuilderMonth(uint256 batch) external nonReentrant {
        require(monthPhase>0&&batch>0&&batch<=MAX_BATCH,'batch');uint256 end=monthCursor+batch;if(end>monthMembers)end=monthMembers;uint256 cutoff=Calendar.endOf(nextBuilderMonth);
        for(;monthCursor<end;monthCursor++){
            address who=builderAccounts[nextBuilderMonth][monthCursor];
            for(uint256 p;p<4;p++){
                uint256 credit=builderCredit[nextBuilderMonth][who][p];delete builderCredit[nextBuilderMonth][who][p];assignedBuilderCredit-=credit;
                uint256 pay;
                if(credit>0&&_eligible(who,p,cutoff)){
                    monthEligible[p]++;pay=credit<monthPay[p]?credit:monthPay[p];
                    if(pay>0){builderClaimed[who][p]=true;pendingReward[who]+=pay;totalPending+=pay;_trackReward(who);builderAccounted-=pay;monthPaid[p]+=pay;}
                }
                retainedBuilderReserve+=credit-pay;
            }
        }
        if(monthCursor==monthMembers)_finishBuilderMonth();
    }
    function _finishBuilderMonth() private {for(uint256 p;p<4;p++)builderCarry[p]+=monthBalances[p]-monthPaid[p];emit BuilderMonthClosed(nextBuilderMonth);nextBuilderMonth++;monthPhase=0;monthCursor=0;}
    function fundingAccounting() external view returns(uint256 pointCredits,uint256 pointBook,uint256 builderCredits,uint256 builderBook){return(queuedPointCredit+assignedPointCredit+retainedPointReserve,pointPool,queuedBuilderCredit+assignedBuilderCredit+retainedBuilderReserve,builderAccounted);}
    function _backed() private view {require(usd.balanceOf(address(this))>=pointPool+builderAccounted+totalPending+totalAuto,'reserve deficit');}
    function accounting() external view returns(uint256 actual,uint256 accounted){return(usd.balanceOf(address(this)),pointPool+builderAccounted+totalPending+totalAuto);}
    function rescue(address asset,address to,uint256 amount) external nonReentrant {require(msg.sender==governance&&asset!=address(usd)&&asset!=address(token),'protected');IERC20(asset).safeTransfer(to,amount);}
}
