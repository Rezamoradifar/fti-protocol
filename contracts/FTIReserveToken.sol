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
    function tokenBuyLimit(address) external view returns (uint256);
    function remainingTokenBuyAllowance(address) external view returns (uint256);
    function tokenBuySpent(address) external view returns (uint256);
    function authorizeTokenBuy(address,uint256) external;
}

/// @notice LOCAL size-fee review: approved $500/5% threshold; 7% curve remains provisional.
/// @dev Starts with zero FTI. Binary support NEVER mints FTI. Zero-supply
///      support is held in the price-protection fund, outside redeemable reserve.
///      No fund spending, release, trigger or governance path is implemented.
///      Ordinary buys/sells have a 3% base fee. Only the current trade's gross
///      value above BOTH $500 and 5% of pretrade live reserve incurs the surcharge.
///      No pressure snapshot, timer, wallet history or previous trade is charged.
///      Buys retain all cash; net-of-fee value mints at the pretrade price.
///      Positive wallet transfers burn 3%; normal partial sales burn the sold
///      tokens and retain their fee in reserve. Full final and emergency exits
///      are fee-free. Protected fund cash and donations are not sale proceeds.
///      There are no personal waiting locks; restart remains review-gated.
contract FTIReserveToken is ERC20, ReentrancyGuard, Pausable {
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
    bytes32 public constant pricingModel = 'REAL_RESERVE_SIZE_PROPOSAL';

    IERC20 public immutable usd;
    address public immutable governance;
    address public immutable guardian;
    address public immutable deployer;
    IReserveMembership public binary;

    uint256 public reserve; // Redeemable backing of circulating FTI only.
    uint256 public priceProtectionFund; // Protected zero-supply cash; spending policy remains unapproved.
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
    bool public lifecycleClosed; // Restart remains review-gated pending explicit approval.
    uint256 public referencePrice = INITIAL_PRICE;
    uint256 public constant pressureWad = 0; // Deprecated; pressure is disabled.
    uint256 public constant lastPartialSellAt = 0; // Deprecated; no fee timer exists.


    event Bound(address indexed binary);
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

    constructor(address stable,address gov,address emergency)
        ERC20('FTI Protocol','FTI')
    {
        require(stable.code.length>0&&gov!=address(0)&&emergency!=address(0),'addresses');
        require(IERC20Metadata(stable).decimals()==18,'requires 18 decimal USD');
        usd=IERC20(stable);
        governance=gov;
        guardian=emergency;
        deployer=msg.sender;
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

    /// @notice Only net-of-fee user value mints tokens. Restart after final redemption is disabled.
    function quoteBuy(uint256 amount) public view returns(uint256){
        require(!lifecycleClosed,'restart policy pending');
        (,uint256 userAssets)=buyFeeQuote(amount);
        require(userAssets>0,'dust');
        uint256 prePrice=price();
        require(prePrice>0,'reserve');
        return Math.mulDiv(userAssets,WAD,prePrice);
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
        if(tokens==0||tokens==supply||emergencyExit||reserve==0)return 0;
        uint256 gross=Math.mulDiv(tokens,reserve,supply);
        require(gross<=MAX_RESERVE&&reserve<=MAX_RESERVE,'fee range');
        uint256 excessTimes20=_sizeExcessTimes20(gross);
        if(excessTimes20==0)return 0;
        return Math.mulDiv(MAX_SIZE_FEE_BPS,excessTimes20*excessTimes20,400*gross*gross);
    }

    /// @notice Exact USD fee, payout and gross claim. Full and emergency exits pay no fee.
    function sellFeeQuote(uint256 tokens) public view returns(uint256 feeAmount,uint256 payout,uint256 gross){
        uint256 supply=totalSupply();
        require(tokens<=supply,'supply');
        if(tokens==0||supply==0)return(0,0,0);
        gross=Math.mulDiv(tokens,reserve,supply);
        if(!emergencyExit&&tokens!=supply)feeAmount=_tradeFee(gross);
        require(gross>feeAmount,'dust');
        payout=gross-feeAmount;
    }

    /// @notice Legacy quote shape; feeBps is truncated indicative average only.
    /// @dev Never reconstruct the fee from feeBps. sellFeeQuote exposes exact USD.
    function quoteSell(uint256 tokens) public view returns(uint256 payout,uint256 feeBps,uint256 gross){
        (,payout,gross)=sellFeeQuote(tokens);
        feeBps=emergencyExit||(tokens>0&&tokens==totalSupply())?0:FEE_BPS+sellImpactBps(tokens);
    }

    /// @notice Binary funding never creates FTI. Only funding received while supply
    ///         is positive becomes redeemable backing. Zero-supply cash remains
    ///         in the price-protection fund, including after closure and later buys.
    function inject(uint256 amount,bool newWallet) external onlyBinary nonReentrant {
        require(amount>0&&amount<=MAX_RESERVE&&reserve+priceProtectionFund+amount<=MAX_RESERVE,'reserve range');
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
        require(!lifecycleClosed,'restart policy pending');
        require(block.timestamp<=deadline&&amount>0&&binary.unitsOf(who)>0,'buy input');

        uint256 previousR=reserve;
        uint256 previousS=totalSupply();
        minted=quoteBuy(amount);
        require(minted>=MIN_MINT&&minted>=minTokens,'slippage/dust');
        require(reserve+priceProtectionFund+amount<=MAX_RESERVE&&previousS+minted<=MAX_SUPPLY,'range');

        // The binary consumes manual authorization before collateral moves. Any later
        // failure reverts both the quota and token state in the same transaction.
        if(!automatic)binary.authorizeTokenBuy(who,amount);
        _receive(payer,amount);
        reserve+=amount;

        _mint(who,minted);
        cumulativeBuy+=amount;

        if(previousS>0)_requireGrowth(previousR,previousS);
        else require(price()>referencePrice,'price step too small');
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
            // No live R/S exists at zero supply. Preserve the last real quote without
            // fabricating a price step. Exact full redemption leaves no redeemable
            // fee residue; quarantined cash and raw donations remain protected.
            // The binary-owned lifetime manual-buy quota is never reset.
            referencePrice=previousPrice;
            lifecycleClosed=true;
            _backed();
            emit LifecycleClosed(reserve,referencePrice,emergencyExit);
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

    function _backed() private view {require(usd.balanceOf(address(this))>=reserve+priceProtectionFund,'reserve deficit');}
    function _requireGrowth(uint256 oldR,uint256 oldS) private view {
        require(oldS>0&&totalSupply()>0,'supply');
        require(reserve*oldS>oldR*totalSupply(),'price must increase');
        // Strict exact growth alone may be invisible after WAD rounding. Reject
        // a trade too small to advance the actual displayed reserve/share price.
        require(price()>Math.mulDiv(oldR,WAD,oldS),'price step too small');
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

    /// @notice All tracked cash includes redeemable backing and protected cash.
    /// @dev Direct USD donations remain unaccounted surplus, never silently assigned.
    function accounting() external view returns(uint256 actual,uint256 accounted){
        return(usd.balanceOf(address(this)),reserve+priceProtectionFund);
    }
    function rescue(address asset,address to,uint256 amount) external nonReentrant {
        require(msg.sender==governance&&asset!=address(usd)&&asset!=address(this),'protected');
        IERC20(asset).safeTransfer(to,amount);
    }
}
