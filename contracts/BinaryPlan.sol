// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {IERC20Metadata} from '@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {Pausable} from '@openzeppelin/contracts/utils/Pausable.sol';
import {Math} from '@openzeppelin/contracts/utils/math/Math.sol';
interface IFTI {
    function inject(uint256,bool) external;
    function autoBuy(address,uint256,uint256,uint256) external returns(uint256);
    function price() external view returns(uint256);
    function quoteBuy(uint256) external view returns(uint256);
}
library Calendar {
    function leap(uint256 y) internal pure returns(bool){return y%4==0&&(y%100!=0||y%400==0);}
    function month(uint256 timestamp) internal pure returns(uint256 key,uint256 end){
        uint256 daysLeft=timestamp/1 days;uint256 y=1970;uint256 start;
        // Deployment range is deliberately bounded. No user-provided calendar input.
        require(timestamp<4102444800,'calendar range');
        while(daysLeft>=(leap(y)?366:365)){uint256 n=leap(y)?366:365;daysLeft-=n;start+=n;y++;}
        uint256[12] memory lengths=[uint256(31),28,31,30,31,30,31,31,30,31,30,31];if(leap(y))lengths[1]=29;
        uint256 m;while(daysLeft>=lengths[m]){daysLeft-=lengths[m];start+=lengths[m];m++;}
        key=y*12+m;end=(start+lengths[m])*1 days;
    }
    function endOf(uint256 key) internal pure returns(uint256){uint256 year=key/12;uint256 m=key%12;require(year>=1970&&year<2100,'calendar range');uint256 d;for(uint256 y=1970;y<year;y++)d+=leap(y)?366:365;uint256[12] memory a=[uint256(31),28,31,30,31,30,31,31,30,31,30,31];if(leap(year))a[1]=29;for(uint256 i;i<=m;i++)d+=a[i];return d*1 days;}
}
/// @notice Experimental pull-payment plan; processing is bounded, all work is permissionless.
contract BinaryPlan is ReentrancyGuard,Pausable {
    using SafeERC20 for IERC20;
    uint256 public constant UNIT=100e18;
    uint256 public constant MAX_BATCH=100;
    IERC20 public immutable usd;
    IFTI public immutable token;
    address public immutable governance;
    address public immutable guardian;
    address public immutable development;
    struct Member {address parent;address left;address right;uint256 units;uint256 carryL;uint256 carryR;uint256 lifetimeL;uint256 lifetimeR;uint8 rank;bool exists;bool autoEnabled;uint256 maxAutoPrice;}
    mapping(address=>Member) public members;
    address[] public memberList;
    mapping(address=>uint64[4]) public rankReachedAt;
    struct Job {address child;address ancestor;uint256 units;}
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
    uint256 public builderAccounted;
    mapping(uint256=>uint256[4]) public monthFunding;
    uint256[4] public builderCarry;
    mapping(address=>bool[4]) public builderClaimed;
    uint256 public nextBuilderMonth;uint8 public monthPhase;uint256 public monthCursor;uint256 public monthMembers;
    uint256[4] public monthBalances;uint256[4] public monthEligible;uint256[4] public monthPay;
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
        usd=IERC20(stable);token=IFTI(fti);governance=gov;guardian=emergency;development=dev;
        epochEnd=(block.timestamp/1 hours+1)*1 hours;(nextBuilderMonth,)=Calendar.month(block.timestamp);
        for(uint256 i;i<31;i++){
            address who=genesis[i];require(who!=address(0)&&!members[who].exists,'genesis');
            members[who].exists=true;memberList.push(who);
            if(i>0){address parent=genesis[(i-1)/2];members[who].parent=parent;if(i%2==1)members[parent].left=who;else members[parent].right=who;}
        }
        usd.forceApprove(fti,type(uint256).max);
    }
    function memberCount() external view returns(uint256){return memberList.length;}
    function jobCount() external view returns(uint256){return jobs.length;}
    function unitsOf(address who) external view returns(uint256){return members[who].units;}
    function rankOf(address who) external view returns(uint8){return members[who].rank;}
    function registered(address who) external view returns(bool){return members[who].exists;}
    function pause() external {require(msg.sender==guardian||msg.sender==governance,'role');_pause();}
    function unpause() external {require(msg.sender==governance,'governance');_unpause();}
    function register(address sponsor,uint256 units) external nonReentrant whenNotPaused {
        require(!members[msg.sender].exists&&members[sponsor].exists&&sponsor!=msg.sender,'registration');
        Member storage p=members[sponsor];require(p.right==address(0),'sponsor full');
        members[msg.sender].exists=true;members[msg.sender].parent=sponsor;memberList.push(msg.sender);
        if(p.left==address(0))p.left=msg.sender;else p.right=msg.sender;
        _fund(msg.sender,units,true);emit Registered(msg.sender,sponsor,units);
    }
    function addUnits(uint256 units) external nonReentrant whenNotPaused {require(members[msg.sender].exists,'member');_fund(msg.sender,units,false);emit UnitsAdded(msg.sender,units);}
    function _fund(address who,uint256 units,bool newWallet) private {
        require(phase==0&&block.timestamp<epochEnd,'settlement required');require(units>0&&units<=1000000,'unit range');
        uint256 amount=units*UNIT;uint256 beforeBal=usd.balanceOf(address(this));usd.safeTransferFrom(who,address(this),amount);require(usd.balanceOf(address(this))-beforeBal==amount,'unsupported USD');
        members[who].units+=units;epochUnits+=units;unitsSinceSettlement+=units;pointPool+=units*90e18;
        pendingReward[development]+=units*1e18;totalPending+=units*1e18;
        (uint256 monthKey,)=Calendar.month(block.timestamp);uint256[4] memory portions=[uint256(16e17),12e17,8e17,4e17];
        for(uint256 i;i<4;i++)monthFunding[monthKey][i]+=units*portions[i];builderAccounted+=units*4e18;
        address parent=members[who].parent;if(parent!=address(0))jobs.push(Job(who,parent,units));
        token.inject(units*5e18,newWallet);
    }
    function processVolume(uint256 steps) external {require(phase==0&&steps>0&&steps<=MAX_BATCH,'batch');
        for(uint256 i;i<steps&&jobCursor<jobs.length;i++){
            Job storage j=jobs[jobCursor];Member storage p=members[j.ancestor];
            if(p.left==j.child){p.carryL+=j.units;p.lifetimeL+=j.units;}else{require(p.right==j.child,'tree');p.carryR+=j.units;p.lifetimeR+=j.units;}
            j.child=j.ancestor;j.ancestor=p.parent;if(j.ancestor==address(0))jobCursor++;
        }
    }
    function cap(uint8 rank,uint8 level) public pure returns(uint256){require(rank<5&&level<4,'cap');uint8[5][4] memory c=[[5,10,15,20,25],[5,10,12,16,20],[5,10,10,12,15],[5,10,10,10,10]];return c[level][rank];}
    function beginEpochClose() external {
        require(phase==0&&block.timestamp>=epochEnd&&jobCursor==jobs.length,'not ready');
        if(unitsSinceSettlement<5){_nextEpoch();return;}
        frozenMembers=memberList.length;frozenLevel=protectionLevel;cursor=0;totalPaidPoints=0;allocated=0;phase=1;
    }
    function processEpoch(uint256 batch) external {
        require(batch>0&&batch<=MAX_BATCH&&phase>0,'batch');
        uint256 end=cursor+batch;if(end>frozenMembers)end=frozenMembers;
        if(phase==1){
            for(;cursor<end;cursor++){
                address who=memberList[cursor];Member storage m=members[who];uint256 raw=m.carryL<m.carryR?m.carryL:m.carryR;
                if(m.units>0){uint256 c=cap(m.rank,frozenLevel);uint256 paid=raw<c?raw:c;paidPoints[epoch][who]=paid;totalPaidPoints+=paid;autoSnapshot[epoch][who]=m.autoEnabled&&m.rank>0;}
                // Inactive Genesis positions retain volume; no unfunded reward privileges.
                if(m.units>0){m.carryL-=raw;m.carryR-=raw;}
                uint256 lifetime=m.lifetimeL<m.lifetimeR?m.lifetimeL:m.lifetimeR;uint256[4] memory thresholds=[uint256(100),200,500,1000];
                if(m.units>0)for(uint256 r=m.rank;r<4;r++){if(lifetime>=thresholds[r]){m.rank=uint8(r+1);rankReachedAt[who][r]=uint64(epochEnd);}else break;}
            }
            if(cursor==frozenMembers){
                if(totalPaidPoints==0){_nextEpoch();return;}
                frozenPool=pointPool;pointValue=frozenPool/totalPaidPoints;phase=2;cursor=0;
            }
        }else{
            for(;cursor<end;cursor++){
                address who=memberList[cursor];require(!settled[epoch][who],'settled');settled[epoch][who]=true;
                uint256 reward=paidPoints[epoch][who]*pointValue;uint256 automatic=autoSnapshot[epoch][who]?reward*5/100:0;
                pendingReward[who]+=reward-automatic;totalPending+=reward-automatic;pendingAuto[who]+=automatic;totalAuto+=automatic;allocated+=reward;pointPool-=reward;
                emit RewardAllocated(epoch,who,reward-automatic,automatic);
            }
            if(cursor==frozenMembers){
                if(frozenPool<20e18*totalPaidPoints&&protectionLevel<3)protectionLevel++;
                else if(frozenPool>20e18*totalPaidPoints&&protectionLevel>0)protectionLevel--;
                unitsSinceSettlement=0;emit EpochClosed(epoch,frozenPool,totalPaidPoints,pointValue,protectionLevel);_nextEpoch();
            }
        }
    }
    function _nextEpoch() private {lastClosedAt=(block.timestamp/1 hours)*1 hours;epoch++;epochEnd=(block.timestamp/1 hours+1)*1 hours;epochUnits=0;phase=0;cursor=0;}
    function setAutoBuy(bool enabled,uint256 maxPrice) external {require(phase==0,'settings frozen');require(members[msg.sender].exists,'member');require(!enabled||maxPrice>0,'price limit');members[msg.sender].autoEnabled=enabled;members[msg.sender].maxAutoPrice=maxPrice;}
    function executeAuto(address who,uint256 amount) external nonReentrant {
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
        uint256 minted=token.autoBuy(who,amount,minimum,block.timestamp);emit AutoExecuted(who,amount,minted);
    }
    function releaseAutoToCash() external {uint256 amount=pendingAuto[msg.sender];pendingAuto[msg.sender]=0;totalAuto-=amount;pendingReward[msg.sender]+=amount;totalPending+=amount;}
    function claim() external nonReentrant {uint256 amount=pendingReward[msg.sender];require(amount>0,'no reward');pendingReward[msg.sender]=0;totalPending-=amount;usd.safeTransfer(msg.sender,amount);emit Claimed(msg.sender,amount);}
    function beginBuilderMonth() external {
        uint256 end=Calendar.endOf(nextBuilderMonth);require(monthPhase==0&&block.timestamp>=end&&lastClosedAt>=end,'month not ready');
        monthMembers=memberList.length;monthCursor=0;monthPhase=1;
        for(uint256 p;p<4;p++){monthBalances[p]=builderCarry[p]+monthFunding[nextBuilderMonth][p];monthFunding[nextBuilderMonth][p]=0;builderCarry[p]=0;monthEligible[p]=0;monthPay[p]=0;}
    }
    function _eligible(address who,uint256 p,uint256 end) private view returns(bool){uint256 at=rankReachedAt[who][p];return at>0&&at<=end&&!builderClaimed[who][p];}
    function processBuilderMonth(uint256 batch) external {
        require(monthPhase>0&&batch>0&&batch<=MAX_BATCH,'batch');uint256 end=monthCursor+batch;if(end>monthMembers)end=monthMembers;uint256 cutoff=Calendar.endOf(nextBuilderMonth);
        if(monthPhase==1){
            for(;monthCursor<end;monthCursor++)for(uint256 p;p<4;p++)if(_eligible(memberList[monthCursor],p,cutoff))monthEligible[p]++;
            if(monthCursor==monthMembers){for(uint256 p;p<4;p++){uint256 count=monthEligible[p];if(count>0){uint256 equal=monthBalances[p]/count;uint256 limit=monthBalances[p]/5;monthPay[p]=equal<limit?equal:limit;}builderCarry[p]=monthBalances[p]-monthPay[p]*count;}monthCursor=0;monthPhase=2;}
        }else{
            for(;monthCursor<end;monthCursor++){address who=memberList[monthCursor];for(uint256 p;p<4;p++)if(_eligible(who,p,cutoff)&&monthPay[p]>0){builderClaimed[who][p]=true;pendingReward[who]+=monthPay[p];totalPending+=monthPay[p];builderAccounted-=monthPay[p];}}
            if(monthCursor==monthMembers){emit BuilderMonthClosed(nextBuilderMonth);nextBuilderMonth++;monthPhase=0;monthCursor=0;}
        }
    }
    function accounting() external view returns(uint256 actual,uint256 accounted){return(usd.balanceOf(address(this)),pointPool+builderAccounted+totalPending+totalAuto);}
    function rescue(address asset,address to,uint256 amount) external {require(msg.sender==governance&&asset!=address(usd)&&asset!=address(token),'protected');IERC20(asset).safeTransfer(to,amount);}
}
