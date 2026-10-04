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

/// @notice Zero-supply real-reserve FTI candidate.
/// @dev Starts with zero FTI. Binary support NEVER mints FTI. At zero supply it
///      is quarantined as protected, unallocated cash, not redeemable collateral.
///      This quarantine is experimental pending final cash-ownership approval;
///      no allocation, withdrawal or treasury payment path is provided.
///      Buys retain all cash and mint against 97% of the payment. Normal partial
///      sales retain 3% plus an experimental 0%-7% global sell-pressure surcharge.
///      Positive wallet transfers burn 3% of the gross amount without moving USD.
///      User tokens have no time, wallet-count, transaction-size or hourly sale locks.
///      Full final sales return the ENTIRE redeemable reserve, with no retained fee.
///      Protected unallocated cash and unaccounted donations are not sale proceeds.
///      Zero supply exposes only a bootstrap/historical reference; restart is review-gated.
contract FTIReserveToken is ERC20, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint256 public constant WAD = 1e18;
    uint256 public constant INITIAL_PRICE = 1e17;
    uint256 public constant FEE_BPS = 300;
    uint256 public constant TRANSFER_BURN_BPS = 300;
    uint256 public constant RETAINED_BPS = 300;
    uint256 public constant MAX_PRESSURE_FEE_BPS = 700;
    uint256 public constant MAX_SELL_FEE_BPS = FEE_BPS+MAX_PRESSURE_FEE_BPS;
    uint256 public constant PRESSURE_HALF_LIFE = 300;
    // floor(2^(-1/300) * WAD). Deterministic integer approximation, not exact
    // real-number exponentiation: every WAD multiplication rounds down.
    uint256 public constant PRESSURE_DECAY_PER_SECOND = 997692176527023318;
    uint256 public constant MAX_PRESSURE_DECAY_SECONDS = 64*PRESSURE_HALF_LIFE;
    // Deprecated compatibility getters: zero means DISABLED, never a 0% sale cap.
    bool public constant SELL_CAPS_ACTIVE = false;
    uint256 public constant MAX_SINGLE_SELL_BPS = 0;
    uint256 public constant MAX_HOURLY_GROSS_SELL_BPS = 0;
    uint256 public constant MAX_RESERVE = 1e30;
    uint256 public constant MAX_SUPPLY = 1e36;
    uint256 public constant MIN_MINT = 1e6;
    uint256 public constant CAP_REFERENCE_SUPPLY = 1000000e18;
    bytes32 public constant pricingModel = 'REAL_RESERVE_V3_PRESSURE';

    IERC20 public immutable usd;
    address public immutable governance;
    address public immutable guardian;
    address public immutable deployer;
    IReserveMembership public binary;

    uint256 public reserve; // Redeemable backing of circulating FTI only.
    uint256 public unallocatedReserve; // Protected zero-supply binary cash; no owner assigned.
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
    uint256 public pressureWad; // Snapshot after the latest successful normal partial sale.
    uint256 public lastPartialSellAt;


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
    function buyFeeBps() external pure returns(uint256){return FEE_BPS;}

    /// @notice Cumulative manual-buy authorization is owned by the binary contract.
    ///         Each paid unit grants its rank-based capacity; selling never restores quota.
    function buyLimit(address who) public view returns(uint256){return binary.tokenBuyLimit(who);}
    function remainingAllowance(address who) public view returns(uint256){return binary.remainingTokenBuyAllowance(who);}
    function lifetimeManualBuys(address who) external view returns(uint256){return binary.tokenBuySpent(who);}

    function _fee(uint256 amount,uint256 bps) private pure returns(uint256){
        return Math.mulDiv(amount,bps,10000,Math.Rounding.Ceil);
    }
    function _userNetBuy(uint256 amount) private pure returns(uint256){
        uint256 fee=_fee(amount,FEE_BPS);
        require(amount>fee,'dust');
        return amount-fee;
    }

    /// @notice Only net-of-fee user value mints tokens. Restart after final redemption is disabled.
    function quoteBuy(uint256 amount) public view returns(uint256){
        require(!lifecycleClosed,'restart policy pending');
        require(amount>0&&amount<=MAX_RESERVE,'amount');
        uint256 userAssets=_userNetBuy(amount);
        uint256 prePrice=price();
        require(prePrice>0,'reserve');
        return Math.mulDiv(userAssets,WAD,prePrice);
    }

    /// @notice Global pressure after deterministic per-second exponential decay.
    /// @dev The approximation floors each WAD product. At 64 half-lives even a
    ///      pressure of WAD is below one WAD atom, so the result is explicitly zero.
    ///      Exponentiation by squaring runs at most 15 iterations (elapsed < 19200).
    function currentSellPressure() public view returns(uint256){
        if(pressureWad==0||block.timestamp<=lastPartialSellAt)return pressureWad;
        uint256 elapsed=block.timestamp-lastPartialSellAt;
        if(elapsed>=MAX_PRESSURE_DECAY_SECONDS)return 0;
        uint256 factor=WAD;
        uint256 base=PRESSURE_DECAY_PER_SECOND;
        while(elapsed>0){
            if((elapsed&1)!=0)factor=Math.mulDiv(factor,base,WAD);
            elapsed>>=1;
            if(elapsed>0)base=Math.mulDiv(base,base,WAD);
        }
        return Math.mulDiv(pressureWad,factor,WAD);
    }

    /// @notice Hypothetical next pressure p1=1-(1-p0)*(1-q/S), as WAD.
    /// @dev The complementary product rounds down, so p1 rounds up by <1 WAD atom.
    ///      Buys, transfers and wallet changes never reset the stored snapshot.
    function previewSellPressure(uint256 tokens) public view returns(uint256){
        uint256 supply=totalSupply();
        require(tokens<=supply,'supply');
        uint256 p0=currentSellPressure();
        if(tokens==0||supply==0)return p0;
        return WAD-Math.mulDiv(WAD-p0,supply-tokens,supply);
    }

    /// @notice Actual extra fee in basis points; final and emergency exits are fee-free.
    /// @dev floor(700 * floor(p1*p1/WAD) / WAD). Applying the endpoint fee to
    ///      each trade is NOT split-invariant; timing and splitting can alter payouts.
    function sellImpactBps(uint256 tokens) public view returns(uint256){
        require(tokens<=totalSupply(),'supply');
        if(tokens==0||tokens==totalSupply()||emergencyExit)return 0;
        uint256 p1=previewSellPressure(tokens);
        return Math.mulDiv(MAX_PRESSURE_FEE_BPS,Math.mulDiv(p1,p1,WAD),WAD);
    }

    function quoteSell(uint256 tokens) public view returns(uint256 payout,uint256 feeBps,uint256 gross){
        require(tokens<=circulatingSupply(),'supply');
        if(tokens==0||totalSupply()==0)return(0,FEE_BPS,0);
        gross=Math.mulDiv(tokens,reserve,totalSupply());
        if(emergencyExit||tokens==totalSupply()){
            require(gross>0,'dust');
            return(gross,0,gross);
        }
        feeBps=FEE_BPS+sellImpactBps(tokens);
        uint256 totalFee=_fee(gross,feeBps);
        require(gross>totalFee,'dust');
        payout=gross-totalFee;
    }

    /// @notice Binary funding never creates FTI. Only funding received while supply
    ///         is positive becomes redeemable backing. Zero-supply cash remains
    ///         protected and unallocated, even after closure and after later buys.
    function inject(uint256 amount,bool newWallet) external onlyBinary nonReentrant {
        require(amount>0&&amount<=MAX_RESERVE&&reserve+unallocatedReserve+amount<=MAX_RESERVE,'reserve range');
        _receive(msg.sender,amount);
        if(totalSupply()==0){
            unallocatedReserve+=amount;
            emit ReserveQuarantined(amount,unallocatedReserve);
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
        require(reserve+unallocatedReserve+amount<=MAX_RESERVE&&previousS+minted<=MAX_SUPPLY,'range');

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

        if(!emergencyExit&&!finalRedemption){
            pressureWad=previewSellPressure(tokens);
            lastPartialSellAt=block.timestamp;
            emit SellPressureUpdated(pressureWad,block.timestamp);
        }

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
            // Do not reset pressure or the binary-owned lifetime manual-buy quota.
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

    function _backed() private view {require(usd.balanceOf(address(this))>=reserve+unallocatedReserve,'reserve deficit');}
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
        return(usd.balanceOf(address(this)),reserve+unallocatedReserve);
    }
    function rescue(address asset,address to,uint256 amount) external nonReentrant {
        require(msg.sender==governance&&asset!=address(usd)&&asset!=address(this),'protected');
        IERC20(asset).safeTransfer(to,amount);
    }
}
