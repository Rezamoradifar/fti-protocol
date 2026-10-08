// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IFTIMembership {
    function unitsOf(address who) external view returns (uint256);
    function rankOf(address who) external view returns (uint8);
    function development() external view returns (address);
    function usd() external view returns (address);
    function token() external view returns (address);
}

/**
 * Owner-authorized V3 candidate, 2026-10-08.
 * Zero premint; first cycle bootstrap quote $0.10, every subsequent cycle $0.20.
 * Separate support, bounded minimum ATH repair, 3% ordinary trade fees retained.
 * Final exit pays its 3% fee and remaining support to the bound development wallet.
 * Support exhaustion never adds a sale veto. No market-price or funded-floor guarantee.
 * New deployment required; not audited or approved for mainnet.
 */
contract FTIReserveTokenV3 is ERC20, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint256 public constant WAD = 1e18;

    uint256 public constant TRADE_FEE_BPS = 300;
    uint256 public constant RESERVE_FEE_BPS = 300;
    uint256 public constant TRANSFER_FEE_BPS = 300;

    uint256 public constant MAX_SINGLE_SELL_BPS = 500;
    uint256 public constant MAX_HOURLY_OUTFLOW_BPS = 2000;
    uint256 public constant SELL_WINDOW = 1 hours;
    uint256 public constant SMALL_SELL_EXEMPTION = 500e18;
    uint256 public constant INITIAL_PRICE = 1e17;
    uint256 public constant RESTART_PRICE = 2e17;
    uint256 public constant POINT_VALUE_TARGET = 20e18;

    uint256 public constant MAX_BUILDER_MULTIPLIER = 16;

    uint256 public constant MAX_RESERVE = 1e30;
    uint256 public constant MAX_SUPPLY = 1e36;
    uint256 public constant MIN_MINT = 1e6;

    bytes32 public constant PRICING_MODEL = "ZERO_START_RESERVE_V3";

    IERC20 public immutable usd;
    address public immutable governance;
    address public immutable guardianCouncil;
    address public immutable deployer;

    IFTIMembership public binary;

    uint256 public reserve;
    uint256 public supportReserve;
    uint256 public launchPrice;
    uint256 public ath;
    uint256 public pendingSupportTarget;
    uint256 public cycle = 1;
    uint256 public cycleStartPrice = INITIAL_PRICE;
    address public development;
    mapping(address => uint256) public purchaseCycle;
    mapping(address => uint256) public cyclePurchases;

    mapping(address => uint256) public lifetimeManualBuys;

    uint64 public sellWindowStart;
    uint256 public sellWindowOpeningReserve;
    uint256 public sellWindowOutflow;

    bool public emergencyUnwind;
    uint256 public emergencyRemainingPool;
    uint256 public emergencyRemainingSupply;

    event Bound(address indexed binary);
    event SupportInjected(uint256 assets, bool indexed newWallet);
    event Bought(address indexed buyer, uint256 usdIn, uint256 userTokens, bool automatic);
    event Sold(address indexed seller, uint256 tokensIn, uint256 usdOut);
    event PriceSupported(uint256 assets, uint256 targetPrice, uint256 actualPrice, bool exhausted);
    event CycleClosed(uint256 indexed cycle, address indexed seller, uint256 payout, uint256 fee, uint256 supportToDevelopment);
    event EmergencyUnwindActivated(uint256 collateral, uint256 supply);
    event EmergencyRedeemed(address indexed user, uint256 burnedTokens, uint256 usdOut);

    modifier onlyBinary() {
        require(msg.sender == address(binary), "binary only");
        _;
    }

    constructor(
        address stable,
        address gov,
        address council
    ) ERC20("FTI Protocol", "FTI") {
        require(stable.code.length > 0, "stable");
        require(gov != address(0) && council != address(0), "roles");
        require(IERC20Metadata(stable).decimals() == 18, "18 decimals required");

        usd = IERC20(stable);
        governance = gov;
        guardianCouncil = council;
        deployer = msg.sender;
    }

    function bind(address binaryPlan) external {
        require(msg.sender == deployer, "deployer");
        require(address(binary) == address(0), "already bound");
        require(binaryPlan.code.length > 0, "binary code");
        IFTIMembership plan = IFTIMembership(binaryPlan);
        require(plan.usd() == address(usd) && plan.token() == address(this), "binding assets");
        address dev = plan.development();
        require(dev != address(0) && dev != address(this), "development");
        binary = plan;
        development = dev;
        emit Bound(binaryPlan);
    }

    function price() public view returns (uint256) {
        if (totalSupply() == 0) return 0;
        return Math.mulDiv(reserve, WAD, totalSupply());
    }

    function circulatingSupply() external view returns (uint256) {
        return totalSupply();
    }

    function inject(uint256 amount, bool newWallet) external onlyBinary nonReentrant {
        require(!emergencyUnwind, "emergency");
        require(amount > 0, "amount");
        require(reserve + supportReserve + amount <= MAX_RESERVE, "reserve cap");

        _receiveExact(msg.sender, amount);
        supportReserve += amount;

        _supportPrice();
        _backed();
        emit SupportInjected(amount, newWallet);
    }

    function quoteBuy(uint256 amount) public view returns (uint256 userTokens) {
        require(amount > 0, "amount");

        uint256 totalFee = _ceilFee(amount, TRADE_FEE_BPS);
        uint256 userAssets = amount - totalFee;

        if (totalSupply() == 0) {
            return Math.mulDiv(userAssets, WAD, cycleStartPrice);
        }

        userTokens = Math.mulDiv(userAssets, totalSupply(), reserve);
    }

    function quoteSell(uint256 tokens) public view returns (uint256 payout, uint256 gross) {
        require(tokens > 0 && tokens <= totalSupply(), "tokens");

        gross = Math.mulDiv(tokens, reserve, totalSupply());
        uint256 fee = _ceilFee(gross, TRADE_FEE_BPS);
        payout = gross - fee;
    }

    /// @notice Amount is the sender's total debit. The burn rounds up to one token base unit.
    function quoteTransfer(uint256 amount) public pure returns (uint256 received, uint256 burned) {
        burned = _ceilFee(amount, TRANSFER_FEE_BPS);
        received = amount - burned;
        require(amount == 0 || received > 0, "transfer dust");
    }

    function buy(uint256 amount, uint256 minTokens, uint256 deadline)
        external
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        return _buy(msg.sender, msg.sender, amount, minTokens, deadline, false);
    }

    function autoBuy(address who, uint256 amount, uint256 minTokens, uint256 deadline)
        external
        onlyBinary
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        return _buy(msg.sender, who, amount, minTokens, deadline, true);
    }

    function _buy(
        address payer,
        address beneficiary,
        uint256 amount,
        uint256 minTokens,
        uint256 deadline,
        bool automatic
    ) internal returns (uint256 minted) {
        require(!emergencyUnwind, "emergency");
        require(block.timestamp <= deadline, "deadline");
        require(amount > 0, "amount");
        require(binary.unitsOf(beneficiary) > 0, "member");

        require(amount <= remainingAllowance(beneficiary), "allowance");

        uint256 oldSupply = totalSupply();

        uint256 totalFee = _ceilFee(amount, TRADE_FEE_BPS);
        uint256 userAssets = amount - totalFee;

        minted = oldSupply == 0
            ? Math.mulDiv(userAssets, WAD, cycleStartPrice)
            : Math.mulDiv(userAssets, oldSupply, reserve);

        require(minted >= MIN_MINT, "dust");
        require(minted >= minTokens, "slippage");
        require(oldSupply + minted <= MAX_SUPPLY, "supply cap");
        require(reserve + supportReserve + amount <= MAX_RESERVE, "reserve cap");

        _receiveExact(payer, amount);

        reserve += amount;

        if (purchaseCycle[beneficiary] != cycle) {
            purchaseCycle[beneficiary] = cycle;
            cyclePurchases[beneficiary] = 0;
        }
        cyclePurchases[beneficiary] += amount;
        if (!automatic) lifetimeManualBuys[beneficiary] += amount;

        _mint(beneficiary, minted);

        if (oldSupply == 0) {
            launchPrice = cycleStartPrice;
        }
        _supportPrice();
        _backed();

        emit Bought(beneficiary, amount, minted, automatic);
    }

    function sell(uint256 tokens, uint256 minUSD, uint256 deadline)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 payout)
    {
        require(!emergencyUnwind, "emergency");
        require(block.timestamp <= deadline, "deadline");
        require(tokens > 0 && tokens <= balanceOf(msg.sender), "balance");

        uint256 oldReserve = reserve;
        uint256 oldSupply = totalSupply();

        uint256 gross;
        (payout, gross) = quoteSell(tokens);

        require(payout > 0 && payout >= minUSD, "slippage/dust");

        bool finalExit = tokens == oldSupply;
        uint256 closingFee;
        uint256 closingSupport;
        uint256 closedCycle = cycle;
        if (finalExit) {
            // With R/S pricing, redeeming all supply quotes exactly all R.
            // Never apply ordinary-sale limits or ordinary price repair to zero supply.
            closingFee = gross - payout;
            closingSupport = supportReserve;
            reserve = 0;
            supportReserve = 0;
        } else {
            _checkSellProtection(gross, payout, oldReserve);
            reserve -= payout;
        }
        _burn(msg.sender, tokens);
        if (!finalExit) _supportPrice();

        uint256 beforePool = usd.balanceOf(address(this));
        uint256 beforeUser = usd.balanceOf(msg.sender);

        usd.safeTransfer(msg.sender, payout);

        require(beforePool - usd.balanceOf(address(this)) == payout, "pool delta");
        require(usd.balanceOf(msg.sender) - beforeUser == payout, "user delta");

        if (finalExit) {
            uint256 devBefore = usd.balanceOf(development);
            usd.safeTransfer(development, closingFee + closingSupport);
            require(usd.balanceOf(development) - devBefore == closingFee + closingSupport, "development delta");
            cycle++;
            cycleStartPrice = RESTART_PRICE;
            launchPrice = 0;
            ath = 0;
            pendingSupportTarget = 0;
            sellWindowStart = 0;
            sellWindowOpeningReserve = 0;
            sellWindowOutflow = 0;
            emit CycleClosed(closedCycle, msg.sender, payout, closingFee, closingSupport);
        }
        _backed();
        emit Sold(msg.sender, tokens, payout);
    }

    function _checkSellProtection(uint256 gross, uint256 payout, uint256 currentReserve) internal {
        // Inclusive USD gross threshold. minUSD/deadline still protect every sale.
        if (gross <= SMALL_SELL_EXEMPTION) return;
        uint256 maxSingle = Math.mulDiv(currentReserve, MAX_SINGLE_SELL_BPS, 10000);
        require(gross <= maxSingle, "single sell protection");

        if (
            sellWindowStart == 0 ||
            block.timestamp >= uint256(sellWindowStart) + SELL_WINDOW
        ) {
            sellWindowStart = uint64(block.timestamp);
            sellWindowOpeningReserve = currentReserve;
            sellWindowOutflow = 0;
        }

        uint256 maxWindowOut = Math.mulDiv(
            sellWindowOpeningReserve,
            MAX_HOURLY_OUTFLOW_BPS,
            10000
        );

        require(
            sellWindowOutflow + payout <= maxWindowOut,
            "hourly sell protection"
        );

        sellWindowOutflow += payout;
    }

    function builderMultiplier() public view returns (uint256 mult) {
        mult = 1;

        if (launchPrice == 0 || totalSupply() == 0) {
            return mult;
        }

        uint256 p = price();
        uint256 threshold = launchPrice * 10;

        while (p >= threshold && mult < MAX_BUILDER_MULTIPLIER) {
            mult *= 2;

            if (threshold > type(uint256).max / 10) {
                break;
            }

            threshold *= 10;
        }
    }

    function buyLimit(address who) public view returns (uint256) {
        uint256[5] memory limits = [
            uint256(500),
            600,
            700,
            800,
            1000
        ];

        uint8 rank = binary.rankOf(who);
        require(rank < 5, "rank");

        uint256 mult = rank == 0 ? 1 : builderMultiplier();

        return binary.unitsOf(who) * limits[rank] * WAD * mult;
    }

    function remainingAllowance(address who) public view returns (uint256) {
        uint256 limit = buyLimit(who);
        uint256 used = purchaseCycle[who] == cycle ? cyclePurchases[who] : 0;

        return limit > used ? limit - used : 0;
    }

    function _ceilFee(uint256 amount, uint256 bps) internal pure returns (uint256) {
        return Math.mulDiv(amount, bps, 10000, Math.Rounding.Ceil);
    }

    /// @dev A reserve reclassification, not a wallet payout or mint.
    /// One price base unit above the previous ATH is the smallest displayed increment.
    /// Saturate at available support; never spend another contract's liabilities.
    function _supportPrice() internal {
        uint256 supply = totalSupply();
        if (supply == 0) return;
        uint256 current = price();
        if (current < ath && pendingSupportTarget == 0) pendingSupportTarget = ath + 1;
        if (pendingSupportTarget > 0 && current >= pendingSupportTarget) pendingSupportTarget = 0;
        if (pendingSupportTarget > 0 && supportReserve > 0) {
            uint256 target = pendingSupportTarget;
            uint256 requiredReserve = Math.mulDiv(target, supply, WAD, Math.Rounding.Ceil);
            uint256 needed = requiredReserve - reserve;
            uint256 assets = needed < supportReserve ? needed : supportReserve;
            supportReserve -= assets;
            reserve += assets;
            current = price();
            if (current >= target) pendingSupportTarget = 0;
            emit PriceSupported(assets, target, current, current < target);
        }
        if (current > ath) ath = current;
    }

    function _receiveExact(address payer, uint256 amount) internal {
        _backed();

        uint256 poolBefore = usd.balanceOf(address(this));
        uint256 payerBefore = usd.balanceOf(payer);

        usd.safeTransferFrom(payer, address(this), amount);

        require(
            usd.balanceOf(address(this)) - poolBefore == amount,
            "unsupported stable"
        );

        require(
            payerBefore - usd.balanceOf(payer) == amount,
            "unsupported stable"
        );
    }

    function _backed() internal view {
        if (emergencyUnwind) {
            require(
                usd.balanceOf(address(this)) >= emergencyRemainingPool,
                "emergency deficit"
            );
        } else {
            require(
                usd.balanceOf(address(this)) >= reserve + supportReserve,
                "reserve deficit"
            );
        }
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            require(to != address(this), "self recipient");
            require(!paused(), "paused");
            require(!emergencyUnwind, "emergency");
            (uint256 received, uint256 burned) = quoteTransfer(value);
            // Use the parent implementation so neither leg is taxed again.
            // Minting, sale burns and emergency redemption never enter this branch.
            if (burned > 0) super._update(from, address(0), burned);
            super._update(from, to, received);
            _supportPrice();
            return;
        }

        super._update(from, to, value);
    }

    function pause() external {
        require(
            msg.sender == guardianCouncil || msg.sender == governance,
            "role"
        );
        _pause();
    }

    function unpause() external {
        require(msg.sender == governance, "governance");
        require(!emergencyUnwind, "emergency permanent");
        _unpause();
    }

    function activateEmergencyUnwind() external nonReentrant {
        require(msg.sender == guardianCouncil, "council");
        require(!emergencyUnwind, "already emergency");

        emergencyUnwind = true;

        if (!paused()) {
            _pause();
        }

        emergencyRemainingPool = usd.balanceOf(address(this));
        emergencyRemainingSupply = totalSupply();

        reserve = 0;
        supportReserve = 0;

        emit EmergencyUnwindActivated(
            emergencyRemainingPool,
            emergencyRemainingSupply
        );
    }

    function emergencyRedeem(uint256 tokens, uint256 minUSD)
        external
        nonReentrant
        returns (uint256 payout)
    {
        require(emergencyUnwind, "not emergency");
        require(tokens > 0 && tokens <= balanceOf(msg.sender), "tokens");
        require(emergencyRemainingSupply > 0, "complete");

        payout = Math.mulDiv(
            tokens,
            emergencyRemainingPool,
            emergencyRemainingSupply
        );

        require(payout > 0 && payout >= minUSD, "emergency slippage");

        emergencyRemainingPool -= payout;
        emergencyRemainingSupply -= tokens;

        _burn(msg.sender, tokens);

        uint256 beforeUser = usd.balanceOf(msg.sender);
        usd.safeTransfer(msg.sender, payout);

        require(
            usd.balanceOf(msg.sender) - beforeUser == payout,
            "user delta"
        );

        emit EmergencyRedeemed(msg.sender, tokens, payout);
    }

    function accounting() external view returns (uint256 actual, uint256 accounted) {
        actual = usd.balanceOf(address(this));

        accounted = emergencyUnwind
            ? emergencyRemainingPool
            : reserve + supportReserve;
    }

    function rescue(address asset, address to, uint256 amount)
        external
        nonReentrant
    {
        require(msg.sender == governance, "governance");
        require(asset != address(usd), "protected stable");
        require(asset != address(this), "protected FTI");

        IERC20(asset).safeTransfer(to, amount);
    }
}
