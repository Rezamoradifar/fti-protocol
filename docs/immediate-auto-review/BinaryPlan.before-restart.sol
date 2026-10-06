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
    function priceMultiplier() external view returns(uint256);
    function quoteBuy(uint256) external view returns(uint256);
}
interface IClosedAutoToken {function lifecycleClosed() external view returns(bool);}
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
    // Local review: bounded optional buy subcall plus enough outer gas to persist progress.
    uint256 public constant AUTO_ATTEMPT_GAS=600000;
    uint256 public constant MIN_ALLOCATION_GAS=900000;
    IERC20 public immutable usd;
    IFTI public immutable token;
    address public immutable governance;
    address public immutable guardian;
    address public immutable development;
    struct Member {address parent;address left;address right;uint256 units;uint256 carryL;uint256 carryR;uint256 lifetimeL;uint256 lifetimeR;uint8 rank;bool exists;bool autoEnabled;uint256 maxAutoPrice;}
    mapping(address=>Member) public members;
    /// @notice Gross manual FTI purchases authorized by this binary plan; sales never restore quota.
    mapping(address=>uint256) public tokenBuySpent;
    /// @notice PROVISIONAL: rank counts capped points with an actual funded reward allocation,
    ///         not raw matched volume or later cash withdrawal. Claims never add rank points.
    mapping(address=>uint256) public cumulativePaidRankPoints;
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
    struct AutoSetting {bool enabled;uint256 effectiveAt;}
    mapping(address=>AutoSetting) public nextAutoSetting;
    address[] public pendingAutoAccounts;
    mapping(address=>uint256) private pendingAutoIndex;
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
    event RankPointsAllocated(address indexed wallet,uint256 points,uint256 cumulativePoints,uint8 rank);
    event PointPoolRoundingAllocated(uint256 indexed epoch,uint256 amount);
    event Claimed(address indexed wallet,uint256 amount);
    event BuilderMonthClosed(uint256 indexed month);
    event AutoExecuted(address indexed wallet,uint256 usdIn,uint256 tokens);
    event AutoSettingScheduled(address indexed wallet,bool enabled,uint256 effectiveAt);
    event ImmediateAutoDeferred(uint256 indexed epoch,address indexed wallet,uint256 amount);
    event ClosedAutoReleased(address indexed wallet,uint256 amount);
    event TokenBuyAuthorized(address indexed wallet,uint256 usdIn,uint256 cumulativeSpent);
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
    /// @notice Cumulative gross-buy capacity uses current permanent rank and all paid units.
    ///         Builders alone receive the token's latched 10x-price milestone multiplier.
    ///         Rank/top-up/milestone increases grant only extra capacity; spent is never reset.
    function tokenBuyLimit(address who) public view returns(uint256){
        Member storage m=members[who];
        uint256[5] memory limits=[uint256(500),600,700,800,1000];
        uint256 multiplier=m.rank==0?1:token.priceMultiplier();
        return m.units*limits[m.rank]*1e18*multiplier;
    }
    function remainingTokenBuyAllowance(address who) public view returns(uint256){
        uint256 limit=tokenBuyLimit(who);uint256 spent=tokenBuySpent[who];
        return limit>spent?limit-spent:0;
    }
    /// @dev The bound token consumes permission atomically with the manual purchase. Reward auto-buys do not call this.
    function authorizeTokenBuy(address who,uint256 amount) external nonReentrant {
        require(msg.sender==address(token),'token only');
        require(members[who].units>0&&amount>0,'buy input');
        require(amount<=remainingTokenBuyAllowance(who),'allowance');
        tokenBuySpent[who]+=amount;
        emit TokenBuyAuthorized(who,amount,tokenBuySpent[who]);
    }
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
        _backed();uint256 amount=units*UNIT;uint256 beforeBal=usd.balanceOf(address(this));uint256 beforeUser=usd.balanceOf(who);
        usd.safeTransferFrom(who,address(this),amount);require(usd.balanceOf(address(this))-beforeBal==amount&&beforeUser-usd.balanceOf(who)==amount,'unsupported USD');
        members[who].units+=units;epochUnits+=units;unitsSinceSettlement+=units;pointPool+=units*90e18;
        pendingReward[development]+=units*1e18;totalPending+=units*1e18;
        (uint256 monthKey,)=Calendar.month(block.timestamp);uint256[4] memory portions=[uint256(16e17),12e17,8e17,4e17];
        for(uint256 i;i<4;i++)monthFunding[monthKey][i]+=units*portions[i];builderAccounted+=units*4e18;
        address parent=members[who].parent;if(parent!=address(0))jobs.push(Job(who,parent,units));
        uint256 beforeInject=usd.balanceOf(address(this));uint256 beforeToken=usd.balanceOf(address(token));
        token.inject(units*5e18,newWallet);
        require(beforeInject-usd.balanceOf(address(this))==units*5e18&&usd.balanceOf(address(token))-beforeToken==units*5e18,'unsupported USD');
        _backed();
    }
    function processVolume(uint256 steps) external nonReentrant {require(phase==0&&steps>0&&steps<=MAX_BATCH,'batch');
        for(uint256 i;i<steps&&jobCursor<jobs.length;i++){
            Job storage j=jobs[jobCursor];Member storage p=members[j.ancestor];
            if(p.left==j.child){p.carryL+=j.units;p.lifetimeL+=j.units;}else{require(p.right==j.child,'tree');p.carryR+=j.units;p.lifetimeR+=j.units;}
            j.child=j.ancestor;j.ancestor=p.parent;if(j.ancestor==address(0))jobCursor++;
        }
    }
    function cap(uint8 rank,uint8 level) public pure returns(uint256){require(rank<5&&level<4,'cap');uint8[5][4] memory c=[[5,10,15,20,25],[5,10,12,16,20],[5,10,10,12,15],[5,10,10,10,10]];return c[level][rank];}
    function beginEpochClose() external nonReentrant {
        require(phase==0&&block.timestamp>=epochEnd&&jobCursor==jobs.length,'not ready');_backed();
        // Gate on this hour's paid registration units; old cash carries, old units do not qualify.
        if(epochUnits<5){_nextEpoch();return;}
        frozenMembers=memberList.length;frozenLevel=protectionLevel;cursor=0;totalPaidPoints=0;allocated=0;frozenPool=pointPool;pointValue=0;phase=1;
    }
    function processEpoch(uint256 batch) external nonReentrant {
        require(batch>0&&batch<=MAX_BATCH&&phase>0,'batch');_backed();
        uint256 end=cursor+batch;if(end>frozenMembers)end=frozenMembers;
        if(phase==1){
            for(;cursor<end;cursor++){
                address who=memberList[cursor];Member storage m=members[who];uint256 raw=m.carryL<m.carryR?m.carryL:m.carryR;
                if(m.units>0){
                    _rollAutoSetting(who,epochEnd-1);
                    uint256 c=cap(m.rank,frozenLevel);uint256 paid=raw<c?raw:c;paidPoints[epoch][who]=paid;totalPaidPoints+=paid;
                    autoSnapshot[epoch][who]=m.autoEnabled&&m.rank>0;
                }
                // Inactive Genesis positions retain volume; no unfunded reward privileges.
                if(m.units>0){m.carryL-=raw;m.carryR-=raw;}
            }
            if(cursor==frozenMembers){
                // PROVISIONAL: preserve an unmatched global pool until ownership is approved.
                // No eligible points means no distribution and no rounding allocation.
                if(totalPaidPoints==0){emit EpochClosed(epoch,frozenPool,0,0,protectionLevel);_nextEpoch();return;}
                pointValue=frozenPool/totalPaidPoints;phase=2;cursor=0;
            }
        }else{
            require(gasleft()>=MIN_ALLOCATION_GAS,'allocation gas');
            uint256 startCursor=cursor;
            for(;cursor<end;cursor++){
                // Finish this bounded batch before optional subcalls can starve later work.
                if(cursor>startCursor&&gasleft()<MIN_ALLOCATION_GAS)break;
                address who=memberList[cursor];require(!settled[epoch][who],'settled');settled[epoch][who]=true;
                // $20 is a protection target for the NEXT epoch, never a payout ceiling or gate.
                uint256 points=paidPoints[epoch][who];uint256 reward=Math.mulDiv(frozenPool,points,totalPaidPoints);
                uint256 automatic=autoSnapshot[epoch][who]?reward*5/100:0;
                pendingReward[who]+=reward-automatic;totalPending+=reward-automatic;pendingAuto[who]+=automatic;totalAuto+=automatic;allocated+=reward;pointPool-=reward;
                emit RewardAllocated(epoch,who,reward-automatic,automatic);
                if(automatic>0){
                    _trackPendingAuto(who);
                    // Only this newly allocated amount is attempted. Older pending funds
                    // retain their existing owner/keeper controls and are never swept here.
                    bytes memory input=abi.encodeCall(this.executeImmediateAuto,(who,automatic));
                    bool ok;uint256 allowanceGas=AUTO_ATTEMPT_GAS;
                    // Do not copy unbounded revert data from collateral callbacks.
                    assembly ("memory-safe") {ok := call(allowanceGas,address(),0,add(input,32),mload(input),0,0)}
                    if(!ok)emit ImmediateAutoDeferred(epoch,who,automatic);
                }
                // The current reward and auto split were fixed under the OLD rank.
                // Only a successfully funded allocation can advance permanent rank.
                if(reward>0){
                    uint256 cumulative=cumulativePaidRankPoints[who]+points;cumulativePaidRankPoints[who]=cumulative;
                    Member storage m=members[who];uint256[4] memory thresholds=[uint256(100),200,500,1000];
                    for(uint256 r=m.rank;r<4;r++){if(cumulative>=thresholds[r]){m.rank=uint8(r+1);rankReachedAt[who][r]=uint64(epochEnd);}else break;}
                    emit RankPointsAllocated(who,points,cumulative,m.rank);
                }
            }
            if(cursor==frozenMembers){
                // Each wallet receives floor(pool * points / totalPoints). Only the exact
                // sum-of-floors residual goes to development; it is not a fee or reserve.
                uint256 rounding=frozenPool-allocated;
                pointPool-=rounding;pendingReward[development]+=rounding;totalPending+=rounding;
                if(rounding>0)emit PointPoolRoundingAllocated(epoch,rounding);
                if(frozenPool<20e18*totalPaidPoints&&protectionLevel<3)protectionLevel++;
                else if(frozenPool>20e18*totalPaidPoints&&protectionLevel>0)protectionLevel--;
                unitsSinceSettlement=0;emit EpochClosed(epoch,frozenPool,totalPaidPoints,pointValue,protectionLevel);_nextEpoch();
            }
        }
        _backed();
    }
    function _nextEpoch() private {lastClosedAt=(block.timestamp/1 hours)*1 hours;epoch++;epochEnd=(block.timestamp/1 hours+1)*1 hours;epochUnits=0;phase=0;cursor=0;}
    /// @notice A change made in UTC hour H applies to rewards earned in H+1 onward.
    ///         Close an overdue hour before changing settings, so delayed settlement
    ///         cannot rewrite that hour's policy. Repeated H changes replace H+1 intent.
    function setAutoBuy(bool enabled) external nonReentrant {
        require(members[msg.sender].exists,'member');
        if(!enabled){
            // Opt-out stops retries immediately. Existing money remains claimable by its owner.
            members[msg.sender].autoEnabled=false;members[msg.sender].maxAutoPrice=0;
            delete nextAutoSetting[msg.sender];emit AutoSettingScheduled(msg.sender,false,block.timestamp);return;
        }
        require(phase==0&&block.timestamp<epochEnd,'settings frozen');
        _rollAutoSetting(msg.sender,block.timestamp);
        nextAutoSetting[msg.sender]=AutoSetting(true,epochEnd);
        emit AutoSettingScheduled(msg.sender,true,epochEnd);
    }
    function _rollAutoSetting(address who,uint256 at) private {
        AutoSetting memory next=nextAutoSetting[who];
        if(next.effectiveAt>0&&next.effectiveAt<=at){
            members[who].autoEnabled=next.enabled;members[who].maxAutoPrice=0;
            delete nextAutoSetting[who];
        }
    }
    /// @notice Effective wall-clock setting; allocation snapshots its own earned hour.
    function effectiveAutoEnabled(address who) public view returns(bool){
        AutoSetting memory next=nextAutoSetting[who];
        if(next.effectiveAt>0&&next.effectiveAt<=block.timestamp)return next.enabled;
        return members[who].autoEnabled;
    }
    function executeAuto(address who,uint256 amount) external nonReentrant {
        require(effectiveAutoEnabled(who),'auto disabled');
        require(msg.sender==who||amount==pendingAuto[who],'partial auto owner only');
        _performAuto(who,amount);
    }
    /// @dev Isolated child frame under processEpoch's outer reentrancy guard.
    ///      Only the outer allocator can select this newly allocated amount.
    function executeImmediateAuto(address who,uint256 amount) external {
        require(msg.sender==address(this)&&_reentrancyGuardEntered(),'self only');
        require(effectiveAutoEnabled(who),'auto disabled');
        _performAuto(who,amount);
    }
    function _performAuto(address who,uint256 amount) private {
        _backed();require(amount>0&&amount<=pendingAuto[who],'amount');
        // No user price cap. Quote and execution share this atomic transaction;
        // the full-precision token quote fixes the minimum actual output.
        uint256 minimum=token.quoteBuy(amount);require(minimum>0,'dust');
        pendingAuto[who]-=amount;totalAuto-=amount;if(pendingAuto[who]==0)_removePendingAuto(who);
        uint256 beforeBal=usd.balanceOf(address(this));uint256 beforeToken=usd.balanceOf(address(token));
        uint256 minted=token.autoBuy(who,amount,minimum,block.timestamp);
        require(beforeBal-usd.balanceOf(address(this))==amount&&usd.balanceOf(address(token))-beforeToken==amount,'unsupported USD');
        _backed();emit AutoExecuted(who,amount,minted);
    }
    function pendingAutoAccountCount() external view returns(uint256){return pendingAutoAccounts.length;}
    function _trackPendingAuto(address who) private {
        if(pendingAutoIndex[who]==0){pendingAutoAccounts.push(who);pendingAutoIndex[who]=pendingAutoAccounts.length;}
    }
    function _removePendingAuto(address who) private {
        uint256 at=pendingAutoIndex[who];if(at==0)return;
        address last=pendingAutoAccounts[pendingAutoAccounts.length-1];pendingAutoAccounts[at-1]=last;pendingAutoIndex[last]=at;
        pendingAutoAccounts.pop();delete pendingAutoIndex[who];
    }
    function _releaseAuto(address who) private returns(uint256 amount){
        amount=pendingAuto[who];pendingAuto[who]=0;totalAuto-=amount;pendingReward[who]+=amount;totalPending+=amount;_removePendingAuto(who);
    }
    function releaseAutoToCash() external nonReentrant {_releaseAuto(msg.sender);}
    /// @notice Irreversible buy closure already exists at terminal redemption;
    ///         it is distinct from later governance retirement of token residuals.
    ///         No cash leaves Binary and no beneficiary can be substituted.
    function releaseClosedTokenAutoToCash(uint256 start,uint256 limit) external nonReentrant {
        require(paused()&&phase==0,'binary not quiescent');
        require(IClosedAutoToken(address(token)).lifecycleClosed(),'token buys not closed');
        require(limit>0&&limit<=MAX_BATCH&&start<=memberList.length,'batch');_backed();
        uint256 end=start+limit;if(end>memberList.length)end=memberList.length;
        for(uint256 i=start;i<end;i++){address who=memberList[i];uint256 amount=_releaseAuto(who);if(amount>0)emit ClosedAutoReleased(who,amount);}
        _backed();
    }
    function claim() external nonReentrant {_backed();uint256 amount=pendingReward[msg.sender];require(amount>0,'no reward');pendingReward[msg.sender]=0;totalPending-=amount;uint256 beforeBal=usd.balanceOf(address(this));uint256 beforeUser=usd.balanceOf(msg.sender);usd.safeTransfer(msg.sender,amount);require(beforeBal-usd.balanceOf(address(this))==amount&&usd.balanceOf(msg.sender)-beforeUser==amount,'unsupported USD');_backed();emit Claimed(msg.sender,amount);}
    function beginBuilderMonth() external nonReentrant {
        uint256 end=Calendar.endOf(nextBuilderMonth);require(monthPhase==0&&block.timestamp>=end&&lastClosedAt>=end,'month not ready');
        monthMembers=memberList.length;monthCursor=0;monthPhase=1;
        for(uint256 p;p<4;p++){monthBalances[p]=builderCarry[p]+monthFunding[nextBuilderMonth][p];monthFunding[nextBuilderMonth][p]=0;builderCarry[p]=0;monthEligible[p]=0;monthPay[p]=0;}
    }
    function _eligible(address who,uint256 p,uint256 end) private view returns(bool){uint256 at=rankReachedAt[who][p];return at>0&&at<=end&&!builderClaimed[who][p];}
    function processBuilderMonth(uint256 batch) external nonReentrant {
        require(monthPhase>0&&batch>0&&batch<=MAX_BATCH,'batch');uint256 end=monthCursor+batch;if(end>monthMembers)end=monthMembers;uint256 cutoff=Calendar.endOf(nextBuilderMonth);
        if(monthPhase==1){
            for(;monthCursor<end;monthCursor++)for(uint256 p;p<4;p++)if(_eligible(memberList[monthCursor],p,cutoff))monthEligible[p]++;
            if(monthCursor==monthMembers){for(uint256 p;p<4;p++){uint256 count=monthEligible[p];if(count>0){uint256 equal=monthBalances[p]/count;uint256 limit=monthBalances[p]/5;monthPay[p]=equal<limit?equal:limit;}builderCarry[p]=monthBalances[p]-monthPay[p]*count;}monthCursor=0;monthPhase=2;}
        }else{
            for(;monthCursor<end;monthCursor++){address who=memberList[monthCursor];for(uint256 p;p<4;p++)if(_eligible(who,p,cutoff)&&monthPay[p]>0){builderClaimed[who][p]=true;pendingReward[who]+=monthPay[p];totalPending+=monthPay[p];builderAccounted-=monthPay[p];}}
            if(monthCursor==monthMembers){emit BuilderMonthClosed(nextBuilderMonth);nextBuilderMonth++;monthPhase=0;monthCursor=0;}
        }
    }
    function _backed() private view {require(usd.balanceOf(address(this))>=pointPool+builderAccounted+totalPending+totalAuto,'reserve deficit');}
    function accounting() external view returns(uint256 actual,uint256 accounted){return(usd.balanceOf(address(this)),pointPool+builderAccounted+totalPending+totalAuto);}
    function rescue(address asset,address to,uint256 amount) external nonReentrant {require(msg.sender==governance&&asset!=address(usd)&&asset!=address(token),'protected');IERC20(asset).safeTransfer(to,amount);}
}
