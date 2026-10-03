// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {IERC20Metadata} from '@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {Pausable} from '@openzeppelin/contracts/utils/Pausable.sol';
import {Math} from '@openzeppelin/contracts/utils/math/Math.sol';

interface IReserveMembership {
    function unitsOf(address) external view returns (uint256);
    function rankOf(address) external view returns (uint8);
}

/// @notice Zero-supply real-reserve FTI candidate.
/// @dev Starts with zero FTI. Binary support adds collateral but NEVER mints FTI.
///      Buy/sell base fee is 3% of gross value: 1% is represented by fully-backed
///      FTI minted to two immutable animal-support wallets, 2% remains reserve-accretive.
///      User tokens have no time/wallet-count locks. User minOut/deadline plus protocol
///      anti-whale price impact and an hourly outflow guard replace vesting locks.
contract FTIReserveToken is ERC20, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint256 public constant WAD = 1e18;
    uint256 public constant FEE_BPS = 300;
    uint256 public constant ANIMAL_BPS = 100;
    uint256 public constant RETAINED_BPS = 200;
    uint256 public constant MAX_EXTRA_SELL_IMPACT_BPS = 700;
    uint256 public constant MAX_SINGLE_SELL_BPS = 500; // 5% of user circulation per transaction
    uint256 public constant MAX_HOURLY_GROSS_SELL_BPS = 1500; // 15% of reserve snapshot per hour
    uint256 public constant MAX_RESERVE = 1e30;
    uint256 public constant MAX_SUPPLY = 1e36;
    uint256 public constant MIN_MINT = 1e6;
    uint256 public constant CAP_REFERENCE_SUPPLY = 1000000e18;
    bytes32 public constant pricingModel = 'REAL_RESERVE_V2_ZERO_START';

    IERC20 public immutable usd;
    address public immutable governance;
    address public immutable guardian;
    address public immutable deployer;
    address public immutable animalSupportA;
    address public immutable animalSupportB;
    IReserveMembership public binary;

    uint256 public reserve;
    uint256 public launchPrice;
    uint256 public milestonePrice;
    uint256 public ath; // status/compatibility metric; zero before first token price
    uint256 public walletClock; // registration metric only; never used for token locks
    uint256 public priceMultiplier = 1;
    uint256 public cumulativeBuy;
    uint256 public cumulativeSell;

    struct Lock {uint256 amount;uint64 clock;uint64 deadline;}

    uint256 public sellWindowStart;
    uint256 public sellWindowStartReserve;
    uint256 public sellWindowGross;
    bool public emergencyExit;

    mapping(address => uint256) public lifetimeManualBuys;

    event Bound(address indexed binary);
    event Bought(address indexed wallet,uint256 usdIn,uint256 userTokens,uint256 animalTokens,bool automatic);
    event Sold(address indexed wallet,uint256 tokens,uint256 usdOut,uint256 baseFeeBps,uint256 impactBps,uint256 animalTokens);
    event ReserveInjected(uint256 amount);
    event AnimalSupportMinted(address indexed wallet,uint256 tokens,uint256 attributedUSD);
    event MultiplierUpdated(uint256 multiplier,uint256 nextMilestone);
    event ReservePriceUpdated(uint256 reserve,uint256 shares,uint256 price);
    event EmergencyExitActivated(address indexed caller);
    event EmergencyExitDeactivated();
    event SellWindowReset(uint256 indexed start,uint256 reserveSnapshot);

    modifier onlyBinary(){require(msg.sender==address(binary),'binary only');_;}

    constructor(address stable,address gov,address emergency,address animalA,address animalB)
        ERC20('FTI Protocol','FTI')
    {
        require(stable.code.length>0&&gov!=address(0)&&emergency!=address(0),'addresses');
        require(animalA!=address(0)&&animalB!=address(0)&&animalA!=animalB,'animal wallets');
        require(IERC20Metadata(stable).decimals()==18,'requires 18 decimal USD');
        usd=IERC20(stable);
        governance=gov;
        guardian=emergency;
        deployer=msg.sender;
        animalSupportA=animalA;
        animalSupportB=animalB;
    }

    function bind(address c1) external {
        require(msg.sender==deployer&&address(binary)==address(0)&&c1.code.length>0,'bind');
        binary=IReserveMembership(c1);
        emit Bound(c1);
    }

    /// @dev Pause blocks buys and wallet-to-wallet transfers. Sells remain open.
    function pause() external {require(msg.sender==guardian||msg.sender==governance,'role');_pause();}
    function unpause() external {require(msg.sender==governance,'governance');_unpause();}

    /// @notice 7-wallet council (guardian) may activate after its on-chain threshold vote.
    ///         This does not transfer reserve to administrators; it makes the protocol redemption-only.
    function activateEmergencyExit() external {
        require(msg.sender==guardian||msg.sender==governance,'role');
        emergencyExit=true;
        if(!paused())_pause();
        emit EmergencyExitActivated(msg.sender);
    }
    function deactivateEmergencyExit() external {
        require(msg.sender==governance,'governance');
        emergencyExit=false;
        if(paused())_unpause();
        emit EmergencyExitDeactivated();
    }

    function circulatingSupply() public view returns(uint256){return totalSupply();}
    function price() public view returns(uint256){
        return totalSupply()==0?0:Math.mulDiv(reserve,WAD,totalSupply());
    }
    function buybackFund() external pure returns(uint256){return 0;}
    function floorFund() external pure returns(uint256){return 0;}
    function anchorSupply() external pure returns(uint256){return 0;}
    function buyFeeBps() external pure returns(uint256){return FEE_BPS;}

    function buyLimit(address who) public view returns(uint256){
        uint256[5] memory limits=[uint256(500),600,700,800,1000];
        uint8 rank=binary.rankOf(who);
        uint256 mult=rank==0?1:priceMultiplier;
        return binary.unitsOf(who)*limits[rank]*WAD*mult;
    }
    function remainingAllowance(address who) public view returns(uint256){
        uint256 limit=buyLimit(who);
        return limit>lifetimeManualBuys[who]?limit-lifetimeManualBuys[who]:0;
    }

    function _fee(uint256 amount,uint256 bps) private pure returns(uint256){
        return Math.mulDiv(amount,bps,10000,Math.Rounding.Ceil);
    }
    function _animalValue(uint256 amount) private pure returns(uint256){
        return _fee(amount,ANIMAL_BPS);
    }
    function _userNetBuy(uint256 amount) private pure returns(uint256){
        uint256 fee=_fee(amount,FEE_BPS);
        require(amount>fee,'dust');
        return amount-fee;
    }

    /// @notice Returns user FTI only; animal-support FTI is separately minted from 1% gross value.
    function quoteBuy(uint256 amount) public view returns(uint256){
        require(amount>0&&amount<=MAX_RESERVE,'amount');
        uint256 userAssets=_userNetBuy(amount);
        if(totalSupply()==0)return userAssets;
        require(reserve>0,'reserve');
        return Math.mulDiv(userAssets,totalSupply(),reserve);
    }
    function quoteAnimalBuy(uint256 amount) public view returns(uint256){
        uint256 assets=_animalValue(amount);
        if(totalSupply()==0)return assets;
        require(reserve>0,'reserve');
        return Math.mulDiv(assets,totalSupply(),reserve);
    }

    function sellImpactBps(uint256 tokens) public view returns(uint256){
        uint256 supply=circulatingSupply();
        if(tokens==0||supply==0)return 0;
        uint256 sizeBps=Math.mulDiv(tokens,10000,supply,Math.Rounding.Ceil);
        if(sizeBps<=100)return 0; // first 1% has no extra impact
        if(sizeBps<=500)return Math.mulDiv(sizeBps-100,300,400); // 0 -> 3%
        uint256 extra=300+Math.mulDiv(sizeBps-500,400,500);
        return extra>MAX_EXTRA_SELL_IMPACT_BPS?MAX_EXTRA_SELL_IMPACT_BPS:extra;
    }

    function quoteSell(uint256 tokens) public view returns(uint256 payout,uint256 feeBps,uint256 gross){
        require(tokens<=circulatingSupply(),'supply');
        if(tokens==0||totalSupply()==0)return(0,FEE_BPS,0);
        gross=Math.mulDiv(tokens,reserve,totalSupply());
        if(emergencyExit){
            require(gross>0,'dust');
            return(gross,0,gross);
        }
        uint256 impact=sellImpactBps(tokens);
        uint256 baseFee=_fee(gross,FEE_BPS);
        uint256 impactFee=_fee(gross,impact);
        require(gross>baseFee+impactFee,'dust');
        payout=gross-baseFee-impactFee;
        feeBps=FEE_BPS+impact;
    }

    /// @notice Binary funding is support only; it never creates FTI, including the first registration.
    function inject(uint256 amount,bool newWallet) external onlyBinary nonReentrant {
        require(amount>0&&reserve+amount<=MAX_RESERVE,'reserve range');
        _receive(msg.sender,amount);
        reserve+=amount;
        if(newWallet)walletClock++;
        _backed();
        _syncMilestone();
        _recordPrice();
        emit ReserveInjected(amount);
    }

    function buy(uint256 amount,uint256 minTokens,uint256 deadline)
        external nonReentrant whenNotPaused returns(uint256)
    {
        require(!emergencyExit,'redemption only');
        return _buy(msg.sender,msg.sender,amount,minTokens,deadline,false);
    }
    function autoBuy(address who,uint256 amount,uint256 minTokens,uint256 deadline)
        external onlyBinary nonReentrant whenNotPaused returns(uint256)
    {
        require(!emergencyExit,'redemption only');
        return _buy(msg.sender,who,amount,minTokens,deadline,true);
    }

    function _buy(address payer,address who,uint256 amount,uint256 minTokens,uint256 deadline,bool automatic)
        private returns(uint256 minted)
    {
        require(block.timestamp<=deadline&&amount>0&&binary.unitsOf(who)>0,'buy input');
        if(!automatic)require(amount<=remainingAllowance(who),'allowance');

        uint256 previousR=reserve;
        uint256 previousS=totalSupply();
        minted=quoteBuy(amount);
        uint256 animalMint=quoteAnimalBuy(amount);
        require(minted>=MIN_MINT&&minted>=minTokens,'slippage/dust');
        require(reserve+amount<=MAX_RESERVE&&previousS+minted+animalMint<=MAX_SUPPLY,'range');

        _receive(payer,amount);
        reserve+=amount;
        if(!automatic)lifetimeManualBuys[who]+=amount;

        _mint(who,minted);
        _mintAnimal(animalMint,_animalValue(amount));
        cumulativeBuy+=amount;

        if(previousS>0)_requireGrowth(previousR,previousS);
        if(launchPrice==0){
            launchPrice=price();
            milestonePrice=launchPrice*10;
        }
        _syncMilestone();
        _recordPrice();
        emit Bought(who,amount,minted,animalMint,automatic);
    }

    function sell(uint256 tokens,uint256 minUSD,uint256 deadline)
        external nonReentrant returns(uint256 payout)
    {
        require(block.timestamp<=deadline&&tokens>0&&tokens<=balanceOf(msg.sender),'sell input');
        uint256 supply=circulatingSupply();
        if(!emergencyExit){
            require(Math.mulDiv(tokens,10000,supply,Math.Rounding.Ceil)<=MAX_SINGLE_SELL_BPS,'anti-whale tx cap');
        }

        uint256 gross;uint256 totalFeeBps;
        (payout,totalFeeBps,gross)=quoteSell(tokens);
        require(payout>0&&payout>=minUSD&&payout<=reserve,'slippage/dust');

        if(!emergencyExit)_consumeSellCapacity(gross);

        uint256 previousR=reserve;
        uint256 previousS=totalSupply();
        uint256 animalValue=emergencyExit?0:_animalValue(gross);
        uint256 animalMint=animalValue==0?0:Math.mulDiv(animalValue,previousS,previousR);

        reserve-=payout;
        cumulativeSell+=gross;
        _burn(msg.sender,tokens);
        if(animalMint>0)_mintAnimal(animalMint,animalValue);

        if(emergencyExit)_backed();
        else _requireGrowth(previousR,previousS);
        _syncMilestone();
        _recordPrice();

        uint256 beforePool=usd.balanceOf(address(this));
        uint256 beforeUser=usd.balanceOf(msg.sender);
        usd.safeTransfer(msg.sender,payout);
        require(beforePool-usd.balanceOf(address(this))==payout&&
            usd.balanceOf(msg.sender)-beforeUser==payout,'unsupported USD');
        _backed();
        emit Sold(msg.sender,tokens,payout,emergencyExit?0:FEE_BPS,emergencyExit?0:totalFeeBps-FEE_BPS,animalMint);
    }

    function _consumeSellCapacity(uint256 gross) private {
        uint256 start=(block.timestamp/1 hours)*1 hours;
        if(start!=sellWindowStart){
            sellWindowStart=start;
            sellWindowStartReserve=reserve;
            sellWindowGross=0;
            emit SellWindowReset(start,reserve);
        }
        uint256 cap=Math.mulDiv(sellWindowStartReserve,MAX_HOURLY_GROSS_SELL_BPS,10000);
        require(sellWindowGross+gross<=cap,'hourly sell capacity');
        sellWindowGross+=gross;
    }

    function _mintAnimal(uint256 amount,uint256 attributedUSD) private {
        if(amount==0)return;
        uint256 a=amount/2;
        uint256 b=amount-a;
        if(a>0){_mint(animalSupportA,a);emit AnimalSupportMinted(animalSupportA,a,attributedUSD/2);}
        if(b>0){_mint(animalSupportB,b);emit AnimalSupportMinted(animalSupportB,b,attributedUSD-attributedUSD/2);}
    }

    function _receive(address payer,uint256 amount) private {
        _backed();
        uint256 beforeBalance=usd.balanceOf(address(this));
        uint256 beforePayer=usd.balanceOf(payer);
        usd.safeTransferFrom(payer,address(this),amount);
        require(usd.balanceOf(address(this))-beforeBalance==amount&&
            beforePayer-usd.balanceOf(payer)==amount,'unsupported USD');
    }

    function _backed() private view {require(usd.balanceOf(address(this))>=reserve,'reserve deficit');}
    function _requireGrowth(uint256 oldR,uint256 oldS) private view {
        require(oldS>0&&totalSupply()>0,'supply');
        require(reserve*oldS>oldR*totalSupply(),'price must increase');
        _backed();
    }
    function _recordPrice() private {
        uint256 p=price();
        if(p>ath)ath=p;
        emit ReservePriceUpdated(reserve,totalSupply(),p);
    }

    /// @dev Builder (rank > 0) manual-buy allowance doubles after each 10x price milestone.
    ///      The sync is automatic on protocol buys/sells and can also be called permissionlessly.
    function syncPriceMilestone() external {_syncMilestone();}
    function _syncMilestone() private {
        if(milestonePrice==0)return;
        while(price()>=milestonePrice&&priceMultiplier<1024){
            priceMultiplier*=2;
            if(milestonePrice>type(uint256).max/10){milestonePrice=type(uint256).max;break;}
            milestonePrice*=10;
            emit MultiplierUpdated(priceMultiplier,milestonePrice);
        }
    }
    function advancePriceMilestone() external {_syncMilestone();}

    /// @notice No protocol lock: full wallet balance is transferable/redeemable, subject to slippage and sell protection.
    function locked(address) public pure returns(uint256){return 0;}
    function unlocked(address who) public view returns(uint256){return balanceOf(who);}
    function lockCount(address) public pure returns(uint256){return 0;}
    function lockInfo(address) external pure returns(Lock[] memory page){page=new Lock[](0);}
    function lockPage(address,uint256,uint256 limit) external pure returns(Lock[] memory page){
        require(limit>0&&limit<=64,'page limit');
        page=new Lock[](0);
    }
    function lockVersion() external pure returns(uint256){return 3;}

    function _update(address from,address to,uint256 value) internal override {
        if(from!=address(0)&&to!=address(0)){
            require(!paused()&&!emergencyExit,'transfers paused');
            require(!_reentrancyGuardEntered(),'reentrant transfer');
            _backed();
        }
        // Standard ERC20 transfer: no transfer tax/burn in V2.
        super._update(from,to,value);
    }

    function accounting() external view returns(uint256 actual,uint256 accounted){
        return(usd.balanceOf(address(this)),reserve);
    }
    function rescue(address asset,address to,uint256 amount) external nonReentrant {
        require(msg.sender==governance&&asset!=address(usd)&&asset!=address(this),'protected');
        IERC20(asset).safeTransfer(to,amount);
    }
}
