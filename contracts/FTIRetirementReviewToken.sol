// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {IERC20Metadata} from '@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {Pausable} from '@openzeppelin/contracts/utils/Pausable.sol';
import {Math} from '@openzeppelin/contracts/utils/math/Math.sol';

interface IRetirementMembership {
    function unitsOf(address) external view returns (uint256);
    function tokenBuyLimit(address) external view returns (uint256);
    function remainingTokenBuyAllowance(address) external view returns (uint256);
    function tokenBuySpent(address) external view returns (uint256);
    function authorizeTokenBuy(address,uint256) external;
    function development() external view returns(address);
    function token() external view returns(address);
    function usd() external view returns(address);
    function governance() external view returns(address);
    function guardian() external view returns(address);
    function totalAuto() external view returns(uint256);
    function phase() external view returns(uint8);
    function epochUnits() external view returns(uint256);
    function monthPhase() external view returns(uint8);
    function jobCursor() external view returns(uint256);
    function jobCount() external view returns(uint256);
    function paused() external view returns(bool);
}
interface IRetirementTimelock {
    function getMinDelay() external view returns(uint256);
    function PROPOSER_ROLE() external view returns(bytes32);
    function hasRole(bytes32,address) external view returns(bool);
}
interface IRetirementCouncil {
    function OWNER_COUNT() external view returns(uint8);
    function THRESHOLD() external view returns(uint8);
}

/// @notice SEPARATE LOCAL lifecycle review. Not a deployed upgrade or a final release.
/// @dev The prior fee/gate candidate stays unchanged in FTIReserveToken.sol.
///      Ordinary terminal sales pay net of the current-trade fee; that terminal
///      fee becomes an owed development claim, never ownerless live reserve.
///      Governance may permanently retire only after zero supply/backing/claims
///      and a quiescent bound binary, through the existing 5/7 and 72h machinery.
///      All retirement USD goes to the fixed development-fund review parameter.
contract FTIRetirementReviewToken is ERC20, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint256 public constant WAD = 1e18;
    uint256 public constant INITIAL_PRICE = 1e17;
    uint256 public constant FEE_BPS = 300;
    uint256 public constant TRANSFER_BURN_BPS = 300;
    uint256 public constant RETAINED_BPS = 300;
    // Threshold correction approved for local review; 7% coefficient remains provisional.
    uint256 public constant LARGE_TRADE_MIN_USD = 500e18;
    uint256 public constant LARGE_TRADE_THRESHOLD_BPS = 500;
    uint256 public constant MAX_SIZE_FEE_BPS = 700;
    uint256 public constant MAX_SELL_FEE_BPS = FEE_BPS+MAX_SIZE_FEE_BPS;
    uint256 public constant MAX_BUY_FEE_BPS = FEE_BPS+MAX_SIZE_FEE_BPS;
    // Explicitly disabled pressure compatibility getters. No temporal fee exists.
    bool public constant SELL_PRESSURE_ACTIVE = false;
    uint256 public constant MAX_PRESSURE_FEE_BPS = 0;
    uint256 public constant PRESSURE_HALF_LIFE = 0;
    uint256 public constant PRESSURE_DECAY_PER_SECOND = 0;
    uint256 public constant MAX_PRESSURE_DECAY_SECONDS = 0;
    // Deprecated compatibility getters: zero means DISABLED, never a 0% sale cap.
    bool public constant SELL_CAPS_ACTIVE = false;
    uint256 public constant MAX_SINGLE_SELL_BPS = 0;
    uint256 public constant MAX_HOURLY_GROSS_SELL_BPS = 0;
    uint256 public constant MAX_RESERVE = 1e30;
    uint256 public constant MAX_SUPPLY = 1e36;
    uint256 public constant MIN_MINT = 1e6;
    uint256 public constant CAP_REFERENCE_SUPPLY = 1000000e18;
    bytes32 public constant pricingModel = 'RETIREMENT_REVIEW_SIZE_FEE';

    IERC20 public immutable usd;
    address public immutable governance;
    address public immutable guardian;
    address public immutable deployer;
    IRetirementMembership public binary;
    address public immutable developmentFund; // Actual public address still requires deployment review.
    uint256 public developmentFeeClaim; // Reserved liability, outside redeemable R and protected support.
    bool public permanentlyRetired;
    uint256 public lifecycleNonce; // Binds Council authorization to a funded lifecycle.
    bool public buysPermanentlyClosed; // Irreversible governance closure, independent of unsettled claims.
    mapping(bytes4=>uint256) public councilApprovalAt;
    uint256 public constant RETIREMENT_DELAY = 72 hours;

    uint256 public reserve; // Redeemable backing of circulating FTI only; terminal development claims excluded.
    uint256 public priceProtectionFund; // No active-price release; retirement-only disposition is explicit below.
    uint256 public constant launchPrice = INITIAL_PRICE; // Fixed milestone anchor, not the first buy quote.
    uint256 public milestonePrice = INITIAL_PRICE*10;
    uint256 public ath; // status/compatibility metric, not a guaranteed liquidation price
    uint256 public walletClock; // registration metric only; never used for token locks
    uint256 public priceMultiplier = 1;
    uint256 public cumulativeBuy;
    uint256 public cumulativeSell;

    struct Lock {uint256 amount;uint64 clock;uint64 deadline;}

    // Deprecated compatibility counters; no windows or capacity checks are active.
    uint256 public sellWindowStart;
    uint256 public sellWindowStartReserve;
    uint256 public sellWindowGross;
    bool public emergencyExit;
    bool public lifecycleClosed; // Ordinary zero-supply interval; a permitted restart clears this flag.
    uint256 public referencePrice = INITIAL_PRICE; // Legacy rounded historical display only.
    uint256 public referenceReserve = INITIAL_PRICE;
    uint256 public referenceSupply = WAD; // Exact rational restart anchor; never spendable backing.
    uint256 public constant pressureWad = 0; // Deprecated; pressure is disabled.
    uint256 public constant lastPartialSellAt = 0; // Deprecated; no fee timer exists.


    event Bound(address indexed binary);
    event BuysPermanentlyClosed();
    event LifecycleRestarted(uint256 referenceReserve,uint256 referenceSupply);
    event TerminalDevelopmentFeeCredited(uint256 amount,uint256 totalClaim);
    event DevelopmentFeeClaimPaid(address indexed destination,uint256 amount);
    event RetirementActionApproved(bytes4 indexed action,uint256 approvedAt,uint256 executableAfter);
    event RetirementActionRevoked(bytes4 indexed action);
    event PermanentlyRetired(address indexed destination,uint256 protectedSupport,uint256 untrackedSurplusRemaining);
    event RetiredDonationRecovered(address indexed destination,uint256 amount);
    event Bought(address indexed wallet,uint256 usdIn,uint256 userTokens,bool automatic);
    event Sold(address indexed wallet,uint256 tokens,uint256 usdOut,uint256 baseFeeBps,uint256 impactBps);
    event ReserveInjected(uint256 amount);
    event ReserveQuarantined(uint256 amount,uint256 totalUnallocated);
    event MultiplierUpdated(uint256 multiplier,uint256 nextMilestone);
    event ReservePriceUpdated(uint256 reserve,uint256 shares,uint256 price);
    event EmergencyExitActivated(address indexed caller);
    event EmergencyExitDeactivated();
    event LifecycleClosed(uint256 residualReserve,uint256 referencePrice,bool emergency);
    event SellWindowReset(uint256 indexed start,uint256 reserveSnapshot);
    // Deprecated compatibility event; never emitted by this proposal.
    event SellPressureUpdated(uint256 pressureWad,uint256 timestamp);

    modifier onlyBinary(){require(msg.sender==address(binary),'binary only');_;}

    constructor(address stable,address gov,address emergency,address development)
        ERC20('FTI Protocol','FTI')
    {
        require(stable.code.length>0&&gov.code.length>0&&emergency.code.length>0,'addresses');
        require(development!=address(0)&&development!=address(this)&&development!=stable,'development destination');
        require(IRetirementTimelock(gov).getMinDelay()==72 hours,'72h governance');
        require(IRetirementCouncil(emergency).OWNER_COUNT()==7&&IRetirementCouncil(emergency).THRESHOLD()==5,'5 of 7 council');
        require(IRetirementTimelock(gov).hasRole(IRetirementTimelock(gov).PROPOSER_ROLE(),emergency),'council proposer');
        developmentFund=development;
        require(IERC20Metadata(stable).decimals()==18,'requires 18 decimal USD');
        usd=IERC20(stable);
        governance=gov;
        guardian=emergency;
        deployer=msg.sender;
    }

    function bind(address c1) external {
        require(msg.sender==deployer&&address(binary)==address(0)&&c1.code.length>0,'bind');
        IRetirementMembership candidate=IRetirementMembership(c1);
        require(c1!=developmentFund&&candidate.development()==developmentFund,'development mismatch');
        require(candidate.token()==address(this)&&candidate.usd()==address(usd)&&
            candidate.governance()==governance&&candidate.guardian()==guardian,'binary binding mismatch');
        binary=candidate;
        emit Bound(c1);
    }

    /// @dev Pause blocks buys and wallet-to-wallet transfers. Sells remain open.
    function pause() external {require(msg.sender==guardian||msg.sender==governance,'role');_pause();}
    function unpause() external {require(msg.sender==governance,'governance');require(!permanentlyRetired,'permanently retired');require(!buysPermanentlyClosed,'buys permanently closed');_unpause();}

    /// @notice 7-wallet council (guardian) may activate after its on-chain threshold vote.
    ///         This does not transfer reserve to administrators; it makes the protocol redemption-only.
    function activateEmergencyExit() external {
        require(msg.sender==guardian||msg.sender==governance,'role');
        require(!permanentlyRetired,'permanently retired');
        emergencyExit=true;
        if(!paused())_pause();
        emit EmergencyExitActivated(msg.sender);
    }
    function deactivateEmergencyExit() external {
        require(msg.sender==governance,'governance');
        require(!buysPermanentlyClosed,'buys permanently closed');
        require(!permanentlyRetired,'permanently retired');
        emergencyExit=false;
        if(paused())_unpause();
        emit EmergencyExitDeactivated();
    }

    function circulatingSupply() public view returns(uint256){return totalSupply();}
    /// @notice At zero supply this is a historical/bootstrap reference, not redeemable value.
    function price() public view returns(uint256){
        return totalSupply()==0?referencePrice:Math.mulDiv(reserve,WAD,totalSupply());
    }
    function buybackFund() external pure returns(uint256){return 0;}
    function floorFund() external pure returns(uint256){return 0;}
    function anchorSupply() external pure returns(uint256){return 0;}
    /// @notice Base fee only. Use buyFeeQuote(amount) for the actual fee amount.
    function buyFeeBps() external pure returns(uint256){return FEE_BPS;}
    /// @notice Deprecated name for protected price-protection-fund cash.
    function unallocatedReserve() external view returns(uint256){return priceProtectionFund;}

    /// @notice Cumulative manual-buy authorization is owned by the binary contract.
    ///         Each paid unit grants its rank-based capacity; selling never restores quota.
    function buyLimit(address who) public view returns(uint256){return binary.tokenBuyLimit(who);}
    function remainingAllowance(address who) public view returns(uint256){return binary.remainingTokenBuyAllowance(who);}
    function lifetimeManualBuys(address who) external view returns(uint256){return binary.tokenBuySpent(who);}

    function _fee(uint256 amount,uint256 bps) private pure returns(uint256){
        return Math.mulDiv(amount,bps,10000,Math.Rounding.Ceil);
    }
    /// @dev T = max(500 USD, R/20), keeping fractional USD atoms exact.
    ///      With thresholdTimes20=max(20*500e18,R), X=max(20V-thresholdTimes20,0).
    ///      B=X/20 and F=ceil((300*400*V^2+700*X^2)/(10000*400*V)).
    ///      One combined rational amount receives ONE ceil. V,R<=1e30 bounds
    ///      the numerator by 4e65 (<2^256) and denominator by 4e36.
    ///      R=0/S=0 retains the existing base-only bootstrap review exception.
    function _sizeExcessTimes20(uint256 value) private view returns(uint256){
        uint256 thresholdTimes20=Math.max(LARGE_TRADE_MIN_USD*20,reserve);
        return value*20>thresholdTimes20?value*20-thresholdTimes20:0;
    }
    function _tradeFee(uint256 value) private view returns(uint256){
        require(value<=MAX_RESERVE&&reserve<=MAX_RESERVE,'fee range');
        if(value==0)return 0;
        if(totalSupply()==0||reserve==0)return _fee(value,FEE_BPS);
        uint256 excessTimes20=_sizeExcessTimes20(value);
        if(excessTimes20==0)return _fee(value,FEE_BPS);
        uint256 numerator=FEE_BPS*400*value*value+MAX_SIZE_FEE_BPS*excessTimes20*excessTimes20;
        uint256 denominator=10000*400*value;
        return Math.ceilDiv(numerator,denominator);
    }

    /// @notice Amount-specific total fee in USD atoms and net minting value.
    /// @dev All amount is retained in reserve; only netAssets mints FTI.
    ///      Zero netAssets is a dust quote and cannot execute as a buy.
    function buyFeeQuote(uint256 amount) public view returns(uint256 feeAmount,uint256 netAssets){
        require(amount>0&&amount<=MAX_RESERVE,'amount');
        feeAmount=_tradeFee(amount);
        netAssets=amount-feeAmount;
    }

    /// @notice Net-of-fee user value mints at the exact live or historical ratio until permanent closure.
    function quoteBuy(uint256 amount) public view returns(uint256){
        require(!permanentlyRetired,'permanently retired');
        require(!buysPermanentlyClosed,'buys permanently closed');
        (,uint256 userAssets)=buyFeeQuote(amount);
        require(userAssets>0,'dust');
        uint256 supply=totalSupply();
        // Active minting uses the exact reserve/share ratio, never the rounded
        // display price. Math.mulDiv floors once after full-precision multiplication.
        if(supply>0){
            require(reserve>0,'reserve');
            return Math.mulDiv(userAssets,supply,reserve);
        }
        require(reserve==0&&referenceReserve>0&&referenceSupply>0,'restart backing/reference');
        return Math.mulDiv(userAssets,referenceSupply,referenceReserve);
    }

    /// @notice Deprecated compatibility views: temporal/global pressure is disabled.
    function currentSellPressure() public pure returns(uint256){return 0;}
    function previewSellPressure(uint256 tokens) public view returns(uint256){
        require(tokens<=totalSupply(),'supply');
        return 0;
    }

    /// @notice Truncated indicative average surcharge in bps, NOT a fee calculator.
    /// @dev Use sellFeeQuote for the exact, once-rounded USD fee. A sub-bps size
    ///      surcharge can exist even when this compatibility display returns zero.
    function sellImpactBps(uint256 tokens) public view returns(uint256){
        uint256 supply=totalSupply();
        require(tokens<=supply,'supply');
        if(tokens==0||emergencyExit||reserve==0)return 0;
        uint256 gross=Math.mulDiv(tokens,reserve,supply);
        require(gross<=MAX_RESERVE&&reserve<=MAX_RESERVE,'fee range');
        uint256 excessTimes20=_sizeExcessTimes20(gross);
        if(excessTimes20==0)return 0;
        return Math.mulDiv(MAX_SIZE_FEE_BPS,excessTimes20*excessTimes20,400*gross*gross);
    }

    /// @notice Exact USD fee and payout. Only emergency exits remain fee-free; normal terminal fees are reserved development claims.
    function sellFeeQuote(uint256 tokens) public view returns(uint256 feeAmount,uint256 payout,uint256 gross){
        uint256 supply=totalSupply();
        require(tokens<=supply,'supply');
        if(tokens==0||supply==0)return(0,0,0);
        gross=Math.mulDiv(tokens,reserve,supply);
        if(!emergencyExit)feeAmount=_tradeFee(gross);
        require(gross>feeAmount,'dust');
        payout=gross-feeAmount;
    }

    /// @notice Legacy quote shape; feeBps is truncated indicative average only.
    /// @dev Never reconstruct the fee from feeBps. sellFeeQuote exposes exact USD.
    function quoteSell(uint256 tokens) public view returns(uint256 payout,uint256 feeBps,uint256 gross){
        (,payout,gross)=sellFeeQuote(tokens);
        feeBps=emergencyExit?0:FEE_BPS+sellImpactBps(tokens);
    }

    /// @notice Binary funding never creates FTI. Only funding received while supply
    ///         is positive becomes redeemable backing. Zero-supply cash remains
    ///         in the price-protection fund, including after closure and later buys.
    function inject(uint256 amount,bool newWallet) external onlyBinary nonReentrant {
        require(!permanentlyRetired,'permanently retired');
        require(!buysPermanentlyClosed,'buys permanently closed');
        require(amount>0&&amount<=MAX_RESERVE&&reserve+priceProtectionFund+developmentFeeClaim+amount<=MAX_RESERVE,'reserve range');
        _receive(msg.sender,amount);
        if(totalSupply()==0){
            priceProtectionFund+=amount;
            emit ReserveQuarantined(amount,priceProtectionFund);
        }else reserve+=amount;
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
        require(!permanentlyRetired,'permanently retired');
        require(!buysPermanentlyClosed,'buys permanently closed');
        require(block.timestamp<=deadline&&amount>0&&binary.unitsOf(who)>0,'buy input');

        uint256 previousR=reserve;
        uint256 previousS=totalSupply();
        minted=quoteBuy(amount);
        require(minted>=MIN_MINT&&minted>=minTokens,'slippage/dust');
        require(reserve+priceProtectionFund+developmentFeeClaim+amount<=MAX_RESERVE&&previousS+minted<=MAX_SUPPLY,'range');

        // The binary consumes manual authorization before collateral moves. Any later
        // failure reverts both the quota and token state in the same transaction.
        if(!automatic)binary.authorizeTokenBuy(who,amount);
        _receive(payer,amount);
        reserve+=amount;

        _mint(who,minted);
        cumulativeBuy+=amount;

        if(previousS>0)_requireGrowth(previousR,previousS);
        else {
            require(reserve*referenceSupply>referenceReserve*totalSupply(),'price must increase');
            lifecycleNonce++;
            // A new funded lifecycle invalidates stale closure/sweep authorization,
            // even if it later returns to zero before the old timelock is executed.
            bytes4 closeAction=this.closeBuysPermanently.selector;
            bytes4 retireAction=this.retirePermanently.selector;
            if(councilApprovalAt[closeAction]!=0){councilApprovalAt[closeAction]=0;emit RetirementActionRevoked(closeAction);}
            if(councilApprovalAt[retireAction]!=0){councilApprovalAt[retireAction]=0;emit RetirementActionRevoked(retireAction);}
            if(lifecycleClosed){lifecycleClosed=false;emit LifecycleRestarted(referenceReserve,referenceSupply);}
            _backed();
        }
        _syncMilestone();
        _recordPrice();
        emit Bought(who,amount,minted,automatic);
    }

    function sell(uint256 tokens,uint256 minUSD,uint256 deadline)
        external nonReentrant returns(uint256 payout)
    {
        require(block.timestamp<=deadline&&tokens>0&&tokens<=balanceOf(msg.sender),'sell input');
        uint256 supply=circulatingSupply();
        bool finalRedemption=tokens==supply;

        uint256 gross;uint256 totalFeeBps;
        (payout,totalFeeBps,gross)=quoteSell(tokens);
        require(payout>0&&payout>=minUSD&&payout<=reserve,'slippage/dust');

        uint256 previousR=reserve;
        uint256 previousS=totalSupply();
        uint256 previousPrice=price();

        reserve-=payout;
        cumulativeSell+=gross;
        _burn(msg.sender,tokens);

        if(finalRedemption){
            // Normal terminal fee is an explicit owed development claim. There
            // is no live R/S after burning all shares and no silent fee residue.
            uint256 terminalFee=reserve; // previousR - payout; emergency fee is zero.
            reserve=0;
            if(terminalFee>0){
                developmentFeeClaim+=terminalFee;
                emit TerminalDevelopmentFeeCredited(terminalFee,developmentFeeClaim);
            }
            referencePrice=previousPrice;
            referenceReserve=previousR;
            referenceSupply=previousS;
            lifecycleClosed=true;
            _backed();
            emit LifecycleClosed(0,referencePrice,emergencyExit);
        }else if(emergencyExit)_backed();
        else _requireGrowth(previousR,previousS);
        _syncMilestone();
        _recordPrice();

        uint256 beforePool=usd.balanceOf(address(this));
        uint256 beforeUser=usd.balanceOf(msg.sender);
        usd.safeTransfer(msg.sender,payout);
        require(beforePool-usd.balanceOf(address(this))==payout&&
            usd.balanceOf(msg.sender)-beforeUser==payout,'unsupported USD');
        _backed();
        emit Sold(msg.sender,tokens,payout,totalFeeBps==0?0:FEE_BPS,totalFeeBps>FEE_BPS?totalFeeBps-FEE_BPS:0);
    }

    function _receive(address payer,uint256 amount) private {
        _backed();
        uint256 beforeBalance=usd.balanceOf(address(this));
        uint256 beforePayer=usd.balanceOf(payer);
        usd.safeTransferFrom(payer,address(this),amount);
        require(usd.balanceOf(address(this))-beforeBalance==amount&&
            beforePayer-usd.balanceOf(payer)==amount,'unsupported USD');
    }

    function _backed() private view {require(usd.balanceOf(address(this))>=reserve+priceProtectionFund+developmentFeeClaim,'reserve deficit');}
    function _requireGrowth(uint256 oldR,uint256 oldS) private view {
        require(oldS>0&&totalSupply()>0,'supply');
        require(reserve*oldS>oldR*totalSupply(),'price must increase');
        // Exact growth is sufficient even when the rounded WAD display is unchanged.
        // R <= 1e30 and S <= 1e36 bound each cross-product below 1e66,
        // safely within uint256. Display formatting must not spend support cash.
        _backed();
    }
    function _recordPrice() private {
        uint256 p=price();
        if(p>ath)ath=p;
        emit ReservePriceUpdated(reserve,totalSupply(),p);
    }

    /// @dev Builder-only capacity multiplier, read by the binary-owned authorization ledger.
    ///      The sync is automatic on protocol buys/sells and can also be called permissionlessly.
    function syncPriceMilestone() external {_syncMilestone();}
    function _syncMilestone() private {
        // A bootstrap/historical reference is not a live reserve/share price.
        // Neither quarantined cash nor raw USD surplus earns a capacity increase.
        if(totalSupply()==0)return;
        uint256 currentPrice=price();
        while(currentPrice>=milestonePrice&&priceMultiplier<1024){
            priceMultiplier*=2;
            if(milestonePrice>type(uint256).max/10){milestonePrice=type(uint256).max;break;}
            milestonePrice*=10;
            emit MultiplierUpdated(priceMultiplier,milestonePrice);
        }
    }
    function advancePriceMilestone() external {_syncMilestone();}

    /// @notice No protocol lock: full wallet balance is transferable/redeemable, subject to slippage and dust checks.
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
            // Zero-value transfers remain ERC20 no-ops. Internal mint/burn operations
            // bypass this branch, preventing a second tax on buys or redemptions.
            if(value>0){
                uint256 previousR=reserve;
                uint256 previousS=totalSupply();
                uint256 burnAmount=_fee(value,TRANSFER_BURN_BPS);
                require(value>burnAmount,'transfer dust');
                uint256 balance=balanceOf(from);
                if(balance<value)revert ERC20InsufficientBalance(from,balance,value);
                // transferFrom has already spent the gross allowance; all changes
                // roll back together if net amount or price growth is insufficient.
                super._update(from,address(0),burnAmount);
                super._update(from,to,value-burnAmount);
                _requireGrowth(previousR,previousS);
                _syncMilestone();
                _recordPrice();
                return;
            }
        }
        super._update(from,to,value);
    }

    /// @notice All tracked cash includes live backing, protected support and owed development fees.
    /// @dev Direct USD donations remain unaccounted surplus, never silently assigned.
    function accounting() external view returns(uint256 actual,uint256 accounted){
        return(usd.balanceOf(address(this)),reserve+priceProtectionFund+developmentFeeClaim);
    }
    /// @notice Anyone may trigger payment of the already-owed terminal fee to
    ///         the fixed development fund; no caller-supplied recipient exists.
    function claimDevelopmentFees() external nonReentrant {
        _backed();
        uint256 amount=developmentFeeClaim;
        require(amount>0,'no development claim');
        developmentFeeClaim=0;
        _payDevelopment(amount);
        _backed();
        emit DevelopmentFeeClaimPaid(developmentFund,amount);
    }

    /// @dev Constant-time checks only. Binary reward cash stays in the binary;
    ///      its totalAuto is the aggregate earmarked for future token buys.
    ///      Pausing, clearing jobs and closing this hour prevent new auto claims
    ///      from being created by a half-finished settlement after retirement.
    function _requireRetirementReady() private view {
        require(totalSupply()==0&&reserve==0,'active token backing');
        require(developmentFeeClaim==0,'pending token claims');
        require(address(binary)!=address(0),'binary not bound');
        require(binary.totalAuto()==0,'pending auto claims');
        require(binary.paused()&&binary.phase()==0&&binary.monthPhase()==0&&binary.epochUnits()==0&&
            binary.jobCursor()==binary.jobCount(),'binary not quiescent');
        _backed();
    }

    /// @notice A separate explicit Council vote is required for each terminal
    ///         action, even if timelock proposer roles are expanded in future.
    ///         This approval and timelock scheduling can occur concurrently;
    ///         their 72h waits do not have to be serial.
    function approveRetirementAction(bytes4 action,uint256 expectedLifecycle) external nonReentrant {
        require(msg.sender==guardian,'council only');
        require(expectedLifecycle==lifecycleNonce,'stale lifecycle approval');
        require(action==this.closeBuysPermanently.selector||action==this.retirePermanently.selector||action==this.recoverRetiredDonations.selector,'retirement action');
        if(action==this.closeBuysPermanently.selector)require(!buysPermanentlyClosed,'buys permanently closed');
        else if(action==this.retirePermanently.selector)require(!permanentlyRetired,'permanently retired');
        else require(permanentlyRetired,'not retired');
        councilApprovalAt[action]=block.timestamp;
        emit RetirementActionApproved(action,block.timestamp,block.timestamp+RETIREMENT_DELAY);
    }

    /// @notice The Council can revoke a still-pending token authorization;
    ///         cancelling a timelock operation alone does not erase this approval.
    function revokeRetirementAction(bytes4 action) external nonReentrant {
        require(msg.sender==guardian,'council only');
        require(action==this.closeBuysPermanently.selector||action==this.retirePermanently.selector||action==this.recoverRetiredDonations.selector,'retirement action');
        councilApprovalAt[action]=0;
        emit RetirementActionRevoked(action);
    }

    function _consumeCouncilApproval(bytes4 action) private {
        uint256 approvedAt=councilApprovalAt[action];
        require(approvedAt>0&&block.timestamp>=approvedAt+RETIREMENT_DELAY,'council approval/delay');
        councilApprovalAt[action]=0;
    }

    /// @notice Irreversibly stop future buys before draining pending-auto liabilities.
    /// @dev Same explicit 5/7 Council approval and 72h timelock as retirement.
    ///      Existing USD claims are untouched and need not be cleared to close buys.
    function closeBuysPermanently() external nonReentrant {
        require(msg.sender==governance,'governance');
        require(!buysPermanentlyClosed&&!permanentlyRetired,'buys permanently closed');
        require(totalSupply()==0&&reserve==0,'active token backing');
        require(address(binary)!=address(0),'binary not bound');
        require(binary.paused()&&binary.phase()==0&&binary.monthPhase()==0&&binary.epochUnits()==0&&
            binary.jobCursor()==binary.jobCount(),'binary not quiescent');
        _backed();
        _consumeCouncilApproval(msg.sig);
        buysPermanentlyClosed=true;
        lifecycleClosed=true;
        if(!paused())_pause();
        emit BuysPermanentlyClosed();
    }

    /// @notice Council-approved permanent termination, executed by the 72h
    ///         timelock. No live backing or unsettled token claim may be swept.
    /// @dev Protected support goes to the fixed development fund. Unaccounted
    ///      USD is disclosed separately and stays until a distinct Council-
    ///      approved delayed recovery action. Other binary cash is untouched.
    function retirePermanently() external nonReentrant {
        require(msg.sender==governance,'governance');
        require(buysPermanentlyClosed,'buys still open');
        require(!permanentlyRetired,'permanently retired');
        _requireRetirementReady();
        _consumeCouncilApproval(msg.sig);
        uint256 actual=usd.balanceOf(address(this));
        uint256 support=priceProtectionFund;
        uint256 surplus=actual-support;
        permanentlyRetired=true;
        lifecycleClosed=true;
        if(!paused())_pause();
        priceProtectionFund=0;
        if(support>0)_payDevelopment(support);
        _backed();
        emit PermanentlyRetired(developmentFund,support,surplus);
    }

    /// @notice A retired ERC20 address can still receive unsolicited USD.
    ///         The same delayed governance may recover untracked USD left at
    ///         retirement or received later, always
    ///         to the same fixed fund, without reopening any lifecycle.
    function recoverRetiredDonations() external nonReentrant {
        require(msg.sender==governance,'governance');
        require(permanentlyRetired,'not retired');
        _requireRetirementReady();
        require(priceProtectionFund==0,'protected support');
        _consumeCouncilApproval(msg.sig);
        uint256 amount=usd.balanceOf(address(this));
        require(amount>0,'no surplus');
        _payDevelopment(amount);
        _backed();
        emit RetiredDonationRecovered(developmentFund,amount);
    }

    function _payDevelopment(uint256 amount) private {
        uint256 beforePool=usd.balanceOf(address(this));
        uint256 beforeFund=usd.balanceOf(developmentFund);
        usd.safeTransfer(developmentFund,amount);
        require(beforePool-usd.balanceOf(address(this))==amount&&
            usd.balanceOf(developmentFund)-beforeFund==amount,'unsupported USD');
    }

    function rescue(address asset,address to,uint256 amount) external nonReentrant {
        require(msg.sender==governance&&asset!=address(usd)&&asset!=address(this),'protected');
        IERC20(asset).safeTransfer(to,amount);
    }
}
