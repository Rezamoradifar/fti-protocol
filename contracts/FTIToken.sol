// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {Pausable} from '@openzeppelin/contracts/utils/Pausable.sol';
interface IBinary {
    function unitsOf(address) external view returns(uint256);
    function rankOf(address) external view returns(uint8);
    function registered(address) external view returns(bool);
}
/// @notice Experimental bounded-integer implementation. NOT audited for mainnet.
contract FTIToken is ERC20, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    uint256 public constant WAD=1e18;
    uint256 public constant V=20000e18;
    uint256 public constant S0=1000000e18;
    uint256 public constant P0=1e17;
    uint256 public constant MAX_RESERVE=1e30;
    IERC20 public immutable usd;
    address public immutable governance;
    address public immutable guardian;
    address public immutable deployer;
    IBinary public binary;
    uint256 public reserve;
    uint256 public buybackFund;
    uint256 public floorFund;
    uint256 public ath=P0;
    uint256 public walletClock;
    uint256 public priceMultiplier=1;
    uint256 public milestonePrice=P0;
    uint256 public cumulativeBuy;
    uint256 public cumulativeSell;
    mapping(uint256=>uint256) public startBuy;
    mapping(uint256=>uint256) public startSell;
    mapping(address=>uint256) public lifetimeManualBuys;
    struct Lock {uint256 amount; uint64 clock; uint64 deadline;}
    mapping(address=>Lock[]) private locks;
    event Bound(address indexed binary);
    event Bought(address indexed wallet,uint256 usdIn,uint256 tokens,bool automatic);
    event Sold(address indexed wallet,uint256 tokens,uint256 usdOut,uint256 feeBps);
    event ReserveInjected(uint256 amount);
    event Supported(uint256 buyback,uint256 floor);
    event MultiplierUpdated(uint256 multiplier);
    modifier onlyBinary(){require(msg.sender==address(binary),'binary only');_;}
    constructor(address stable,address gov,address emergency) ERC20('FTI Protocol','FTI') {
        require(stable!=address(0)&&gov!=address(0)&&emergency!=address(0),'zero');
        usd=IERC20(stable); governance=gov; guardian=emergency; deployer=msg.sender;
    }
    function bind(address c1) external {require(msg.sender==deployer&&address(binary)==address(0)&&c1.code.length>0,'bind');binary=IBinary(c1);emit Bound(c1);}
    function pause() external {require(msg.sender==guardian||msg.sender==governance,'role');_pause();}
    function unpause() external {require(msg.sender==governance,'governance');_unpause();}
    function curveSupply() public view returns(uint256){return S0+totalSupply();}
    function price() public view returns(uint256){return (reserve+V)*5*WAD/curveSupply();}
    function _ceil(uint256 a,uint256 b) private pure returns(uint256){return a/b+(a%b==0?0:1);}
    function _pow5Up(uint256 ratio) private pure returns(uint256 r){r=WAD;for(uint256 i;i<5;i++)r=_ceil(r*ratio,WAD);}
    function _cost(uint256 s,uint256 m) private view returns(uint256){uint256 ratio=_ceil((s+m)*WAD,s);return _ceil((reserve+V)*(_pow5Up(ratio)-WAD),WAD);}
    function buyLimit(address who) public view returns(uint256){uint256[5] memory limits=[uint256(500),600,700,800,1000];return binary.unitsOf(who)*limits[binary.rankOf(who)]*WAD*priceMultiplier;}
    function remainingAllowance(address who) public view returns(uint256){uint256 lim=buyLimit(who);return lim>lifetimeManualBuys[who]?lim-lifetimeManualBuys[who]:0;}
    function buyFeeBps() public view returns(uint256){return price()*100<=ath*90?120:300;}
    function quoteBuy(uint256 amount) public view returns(uint256 minted){
        require(amount<=MAX_RESERVE,'amount limit');
        uint256 net=amount-amount*buyFeeBps()/10000;
        uint256 s=curveSupply(); uint256 lo; uint256 hi=s;
        while(_cost(s,hi)<=net){hi*=2;}
        // Bounds: reserve <= 1e30, supply <= S0+1e30. 128 bisections cover the entire allowed range.
        while(lo<hi){uint256 mid=lo+(hi-lo+1)/2;if(_cost(s,mid)<=net)lo=mid;else hi=mid-1;}
        return lo;
    }
    function inject(uint256 amount,bool newWallet) external onlyBinary nonReentrant {
        if(newWallet){walletClock++;startBuy[walletClock]=cumulativeBuy;startSell[walletClock]=cumulativeSell;}
        require(reserve+buybackFund+floorFund+amount<=MAX_RESERVE,'reserve range');
        uint256 beforeBal=usd.balanceOf(address(this));usd.safeTransferFrom(msg.sender,address(this),amount);
        require(usd.balanceOf(address(this))-beforeBal==amount,'unsupported USD');
        buybackFund+=amount*80/100;floorFund+=amount-amount*80/100;_defend();emit ReserveInjected(amount);
    }
    function buy(uint256 amount,uint256 minTokens,uint256 deadline) external nonReentrant whenNotPaused returns(uint256){return _buy(msg.sender,msg.sender,amount,minTokens,deadline,false);}
    function autoBuy(address who,uint256 amount,uint256 minTokens,uint256 deadline) external onlyBinary nonReentrant whenNotPaused returns(uint256){return _buy(msg.sender,who,amount,minTokens,deadline,true);}
    function _buy(address payer,address who,uint256 amount,uint256 minTokens,uint256 deadline,bool automatic) private returns(uint256 minted){
        require(block.timestamp<=deadline&&amount>0&&binary.unitsOf(who)>0,'buy input');
        if(!automatic)require(amount<=remainingAllowance(who),'allowance');
        minted=quoteBuy(amount);require(minted>0&&minted>=minTokens,'slippage/dust');
        require((balanceOf(who)+minted)*100<=curveSupply()+minted,'holding cap');
        uint256 fee=amount*buyFeeBps()/10000;
        require(reserve+buybackFund+floorFund+amount<=MAX_RESERVE&&curveSupply()+minted<=1e30,'range');
        uint256 beforeBal=usd.balanceOf(address(this));usd.safeTransferFrom(payer,address(this),amount);
        require(usd.balanceOf(address(this))-beforeBal==amount,'unsupported USD');
        reserve+=amount-fee;buybackFund+=fee;
        if(!automatic)lifetimeManualBuys[who]+=amount;
        _mint(who,minted);_prune(who);
        bool vest=!automatic&&lifetimeManualBuys[who]>=500e18;
        require(locks[who].length+(vest?4:1)<=64,'claim mature locks first');
        if(vest){uint256 part=minted/4;for(uint256 i;i<4;i++)locks[who].push(Lock(i==3?minted-3*part:part,uint64(walletClock+20000+8000*i),uint64(block.timestamp+90 days)));}
        else locks[who].push(Lock(minted,uint64(walletClock+5000),uint64(block.timestamp+30 days)));
        cumulativeBuy+=amount;_defend();emit Bought(who,amount,minted,automatic);
    }
    function lockInfo(address who) external view returns(Lock[] memory){return locks[who];}
    function locked(address who) public view returns(uint256 amount){for(uint256 i;i<locks[who].length;i++){Lock memory l=locks[who][i];if(walletClock<l.clock&&block.timestamp<l.deadline)amount+=l.amount;}}
    function unlocked(address who) public view returns(uint256){return balanceOf(who)-locked(who);}
    function _prune(address who) private {uint256 i;while(i<locks[who].length){Lock memory l=locks[who][i];if(walletClock>=l.clock||block.timestamp>=l.deadline){locks[who][i]=locks[who][locks[who].length-1];locks[who].pop();}else i++;}}
    function pruneLocks() external {_prune(msg.sender);}
    function sustainedActive() public view returns(bool){uint256 from=walletClock>=4999?walletClock-4999:0;uint256 s=cumulativeSell-startSell[from];uint256 b=cumulativeBuy-startBuy[from];return s>=1000e18&&s*10>=b*13;}
    function quoteSell(uint256 tokens) public view returns(uint256 payout,uint256 feeBps,uint256 gross){
        require(tokens<=totalSupply(),'supply');uint256 s=curveSupply();uint256 remaining=_ceil((s-tokens)*WAD,s);
        gross=(reserve+V)*(WAD-_pow5Up(remaining))/WAD;
        uint256 rho=gross*10000/(reserve+V);feeBps=300;
        if(rho>100){uint256 slope=rho>=1000?900:rho-100;feeBps+=5700*slope/900;}
        if(sustainedActive()&&feeBps<1500)feeBps=1500;
        payout=gross*(10000-feeBps)/10000;
    }
    function sell(uint256 tokens,uint256 minUSD,uint256 deadline) external nonReentrant whenNotPaused returns(uint256 payout){
        require(block.timestamp<=deadline&&tokens>0&&tokens<=unlocked(msg.sender),'sell input/lock');
        (uint256 out,uint256 fee,uint256 gross)=quoteSell(tokens);payout=out;require(out>=minUSD&&out>0,'slippage/dust');
        uint256 excess=gross*(fee-300)/10000;require(out+excess<=reserve,'reserve');
        reserve-=out+excess;buybackFund+=excess;cumulativeSell+=gross;_burn(msg.sender,tokens);
        _defend();usd.safeTransfer(msg.sender,out);emit Sold(msg.sender,tokens,out,fee);
    }
    function _update(address from,address to,uint256 value) internal override {
        if(from!=address(0)&&to!=address(0)){
            require(!paused()&&from!=to&&binary.unitsOf(to)>0,'transfer');require(value<=unlocked(from),'locked');
            uint256 burn=value*300/10000;uint256 received=value-burn;
            require((balanceOf(to)+received)*100<=curveSupply()-burn,'holding cap');
            super._update(from,address(0),burn);super._update(from,to,received);_defend();
        }else super._update(from,to,value);
    }
    function _defend() private {
        uint256 p=price();if(p>ath){ath=p;return;}uint256 bb;uint256 fl;
        if(p*100<=ath*99){uint256 target=ath*curveSupply()/(5*WAD);if(target>reserve+V){bb=target-reserve-V;if(bb>buybackFund)bb=buybackFund;buybackFund-=bb;reserve+=bb;}}
        if(price()*100<ath*92){uint256 target=ath*92*curveSupply()/(500*WAD);if(target>reserve+V){fl=target-reserve-V;if(fl>floorFund)fl=floorFund;floorFund-=fl;reserve+=fl;}}
        if(bb+fl>0)emit Supported(bb,fl);
    }
    function advancePriceMilestone() external {require(msg.sender==governance,'governance');require(price()>=milestonePrice*10&&priceMultiplier<1024,'milestone');milestonePrice*=10;priceMultiplier*=2;emit MultiplierUpdated(priceMultiplier);}
    function accounting() external view returns(uint256 actual,uint256 accounted){return(usd.balanceOf(address(this)),reserve+buybackFund+floorFund);}
    function rescue(address asset,address to,uint256 amount) external {require(msg.sender==governance&&asset!=address(usd)&&asset!=address(this),'protected');IERC20(asset).safeTransfer(to,amount);}
}
