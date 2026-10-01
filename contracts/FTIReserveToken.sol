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

/// @notice Experimental real-reserve model; gross reserve/share value never decreases.
/// @dev Not ERC-4626. Test separately from the legacy CRR token. No market/USD guarantee.
contract FTIReserveToken is ERC20, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint256 public constant WAD = 1e18;
    uint256 public constant P0 = 1e17;
    uint256 public constant FEE_BPS = 300;
    uint256 public constant MAX_RESERVE = 1e30;
    uint256 public constant MAX_SUPPLY = 1e36;
    uint256 public constant MIN_MINT = 1e6;
    // Acquisition allowance reference ONLY. These are not shares or reserve backing.
    uint256 public constant CAP_REFERENCE_SUPPLY = 1000000e18;
    bytes32 public constant pricingModel = 'REAL_RESERVE_V1';

    IERC20 public immutable usd;
    address public immutable governance;
    address public immutable guardian;
    address public immutable deployer;
    IReserveMembership public binary;
    uint256 public reserve;
    uint256 public anchorSupply;
    uint256 public ath = P0;
    uint256 public walletClock;
    uint256 public priceMultiplier = 1;
    uint256 public milestonePrice = P0;
    uint256 public cumulativeBuy;
    uint256 public cumulativeSell;
    mapping(address => uint256) public lifetimeManualBuys;
    struct Lock { uint256 amount; uint64 clock; uint64 deadline; }
    mapping(address => Lock[]) private locks;

    event Bound(address indexed binary);
    event Bought(address indexed wallet, uint256 usdIn, uint256 tokens, bool automatic);
    event Sold(address indexed wallet, uint256 tokens, uint256 usdOut, uint256 feeBps);
    event ReserveInjected(uint256 amount);
    event AnchorFunded(uint256 assets, uint256 permanentlyLockedShares);
    event MultiplierUpdated(uint256 multiplier);
    event ReservePriceUpdated(uint256 reserve, uint256 shares, uint256 price);

    modifier onlyBinary() { require(msg.sender == address(binary), 'binary only'); _; }

    constructor(address stable, address gov, address emergency) ERC20('FTI Protocol', 'FTI') {
        require(stable.code.length > 0 && gov != address(0) && emergency != address(0), 'addresses');
        require(IERC20Metadata(stable).decimals() == 18, 'requires 18 decimal USD');
        usd = IERC20(stable); governance = gov; guardian = emergency; deployer = msg.sender;
    }

    function bind(address c1) external {
        require(msg.sender == deployer && address(binary) == address(0) && c1.code.length > 0, 'bind');
        binary = IReserveMembership(c1); emit Bound(c1);
    }
    function pause() external { require(msg.sender == guardian || msg.sender == governance, 'role'); _pause(); }
    function unpause() external { require(msg.sender == governance, 'governance'); _unpause(); }
    function circulatingSupply() public view returns (uint256) { return totalSupply() - anchorSupply; }
    function price() public view returns (uint256) {
        return totalSupply() == 0 ? P0 : Math.mulDiv(reserve, WAD, totalSupply());
    }
    // Compatibility getters: no virtual reserve, separate buyback or floor pot exists here.
    function buybackFund() external pure returns (uint256) { return 0; }
    function floorFund() external pure returns (uint256) { return 0; }
    function buyFeeBps() external pure returns (uint256) { return FEE_BPS; }
    function buyLimit(address who) public view returns (uint256) {
        uint256[5] memory limits = [uint256(500), 600, 700, 800, 1000];
        return binary.unitsOf(who) * limits[binary.rankOf(who)] * WAD * priceMultiplier;
    }
    function remainingAllowance(address who) public view returns (uint256) {
        uint256 limit = buyLimit(who);
        return limit > lifetimeManualBuys[who] ? limit - lifetimeManualBuys[who] : 0;
    }
    function _fee(uint256 amount) private pure returns (uint256) {
        return Math.mulDiv(amount, FEE_BPS, 10000, Math.Rounding.Ceil);
    }
    function quoteBuy(uint256 amount) public view returns (uint256) {
        require(anchorSupply > 0, 'reserve not initialized');
        require(amount <= MAX_RESERVE, 'amount limit');
        return Math.mulDiv(amount - _fee(amount), totalSupply(), reserve);
    }
    function quoteSell(uint256 tokens) public view returns (uint256 payout, uint256 feeBps, uint256 gross) {
        require(tokens <= circulatingSupply(), 'circulating supply');
        if (tokens == 0) return (0, FEE_BPS, 0);
        gross = Math.mulDiv(tokens, reserve, totalSupply());
        return (gross - _fee(gross), FEE_BPS, gross);
    }

    // BinaryPlan's first paid token allocation funds all initial, permanently locked shares.
    // Later allocations add real backing without minting. No administrator can redeem the anchor.
    function inject(uint256 amount, bool newWallet) external onlyBinary nonReentrant {
        require(amount > 0 && reserve + amount <= MAX_RESERVE, 'reserve range');
        uint256 previousR = reserve; uint256 previousS = totalSupply();
        _receive(msg.sender, amount);
        reserve += amount;
        if (previousS == 0) {
            anchorSupply = Math.mulDiv(amount, WAD, P0);
            require(anchorSupply > 0 && anchorSupply <= MAX_SUPPLY, 'anchor range');
            _mint(address(this), anchorSupply);
            emit AnchorFunded(amount, anchorSupply);
        } else _requireGrowth(previousR, previousS);
        if (newWallet) walletClock++;
        _recordPrice(); emit ReserveInjected(amount);
    }
    function buy(uint256 amount, uint256 minTokens, uint256 deadline)
        external nonReentrant whenNotPaused returns (uint256)
    { return _buy(msg.sender, msg.sender, amount, minTokens, deadline, false); }
    function autoBuy(address who, uint256 amount, uint256 minTokens, uint256 deadline)
        external onlyBinary nonReentrant whenNotPaused returns (uint256)
    { return _buy(msg.sender, who, amount, minTokens, deadline, true); }
    function _buy(address payer, address who, uint256 amount, uint256 minTokens, uint256 deadline, bool automatic)
        private returns (uint256 minted)
    {
        require(block.timestamp <= deadline && amount > 0 && binary.unitsOf(who) > 0, 'buy input');
        if (!automatic) require(amount <= remainingAllowance(who), 'allowance');
        minted = quoteBuy(amount);
        require(minted >= MIN_MINT && minted >= minTokens, 'slippage/dust');
        require((balanceOf(who) + minted) * 100 <= CAP_REFERENCE_SUPPLY + circulatingSupply() + minted, 'holding cap');
        require(reserve + amount <= MAX_RESERVE && totalSupply() + minted <= MAX_SUPPLY, 'range');
        uint256 previousR = reserve; uint256 previousS = totalSupply();
        _receive(payer, amount);
        reserve += amount; // Includes the complete buy fee.
        if (!automatic) lifetimeManualBuys[who] += amount;
        _mint(who, minted); _prune(who);
        bool vest = !automatic && lifetimeManualBuys[who] >= 500e18;
        require(locks[who].length + (vest ? 4 : 1) <= 64, 'claim mature locks first');
        if (vest) {
            uint256 part = minted / 4;
            for (uint256 i; i < 4; i++) locks[who].push(Lock(i == 3 ? minted - 3 * part : part,
                uint64(walletClock + 20000 + 8000 * i), uint64(block.timestamp + 90 days)));
        } else locks[who].push(Lock(minted, uint64(walletClock + 5000), uint64(block.timestamp + 30 days)));
        cumulativeBuy += amount;
        _requireGrowth(previousR, previousS); _recordPrice();
        emit Bought(who, amount, minted, automatic);
    }
    function sell(uint256 tokens, uint256 minUSD, uint256 deadline)
        external nonReentrant whenNotPaused returns (uint256 payout)
    {
        require(block.timestamp <= deadline && tokens > 0 && tokens <= unlocked(msg.sender), 'sell input/lock');
        uint256 gross;
        (payout,,gross) = quoteSell(tokens);
        require(payout > 0 && payout >= minUSD && payout <= reserve, 'slippage/dust');
        uint256 previousR = reserve; uint256 previousS = totalSupply();
        reserve -= payout; cumulativeSell += gross; _burn(msg.sender, tokens);
        _requireGrowth(previousR, previousS); _recordPrice();
        uint256 beforePool = usd.balanceOf(address(this));
        uint256 beforeUser = usd.balanceOf(msg.sender);
        usd.safeTransfer(msg.sender, payout);
        require(beforePool - usd.balanceOf(address(this)) == payout &&
            usd.balanceOf(msg.sender) - beforeUser == payout, 'unsupported USD');
        _backed(); emit Sold(msg.sender, tokens, payout, FEE_BPS);
    }
    function _receive(address payer, uint256 amount) private {
        _backed(); uint256 beforeBalance = usd.balanceOf(address(this));
        uint256 beforePayer = usd.balanceOf(payer);
        usd.safeTransferFrom(payer, address(this), amount);
        require(usd.balanceOf(address(this)) - beforeBalance == amount &&
            beforePayer - usd.balanceOf(payer) == amount, 'unsupported USD');
    }
    function _backed() private view { require(usd.balanceOf(address(this)) >= reserve, 'reserve deficit'); }
    function _requireGrowth(uint256 oldR, uint256 oldS) private view {
        // Both products <= 1e66 under MAX_RESERVE / MAX_SUPPLY; no 256-bit overflow.
        require(reserve * oldS > oldR * totalSupply(), 'price must increase');
        _backed();
    }
    function _recordPrice() private { ath = price(); emit ReservePriceUpdated(reserve, totalSupply(), ath); }
    function _update(address from, address to, uint256 value) internal override {
        require(from != address(this), 'anchor locked');
        if (from != address(0) && to != address(0)) {
            // ERC20 transfers also share the trade guard: collateral callbacks cannot alter supply.
            require(!_reentrancyGuardEntered(), 'reentrant transfer');
            require(!paused() && from != to && binary.unitsOf(to) > 0, 'transfer');
            require(value <= unlocked(from), 'locked');
            if (value == 0) { super._update(from, to, 0); return; }
            uint256 burn = _fee(value); require(value > burn, 'dust transfer');
            uint256 received = value - burn;
            require((balanceOf(to) + received) * 100 <= CAP_REFERENCE_SUPPLY + circulatingSupply() - burn, 'holding cap');
            uint256 previousR = reserve; uint256 previousS = totalSupply();
            super._update(from, address(0), burn); super._update(from, to, received);
            _requireGrowth(previousR, previousS); _recordPrice();
        } else super._update(from, to, value);
    }
    function lockInfo(address who) external view returns (Lock[] memory) { return locks[who]; }
    function locked(address who) public view returns (uint256 amount) {
        if (who == address(this)) return anchorSupply;
        for (uint256 i; i < locks[who].length; i++) {
            Lock memory l = locks[who][i];
            if (walletClock < l.clock && block.timestamp < l.deadline) amount += l.amount;
        }
    }
    function unlocked(address who) public view returns (uint256) { return balanceOf(who) - locked(who); }
    function _prune(address who) private {
        uint256 i;
        while (i < locks[who].length) {
            Lock memory l = locks[who][i];
            if (walletClock >= l.clock || block.timestamp >= l.deadline) {
                locks[who][i] = locks[who][locks[who].length - 1]; locks[who].pop();
            } else i++;
        }
    }
    function pruneLocks() external { _prune(msg.sender); }
    function advancePriceMilestone() external {
        require(msg.sender == governance, 'governance');
        require(price() >= milestonePrice * 10 && priceMultiplier < 1024, 'milestone');
        milestonePrice *= 10; priceMultiplier *= 2; emit MultiplierUpdated(priceMultiplier);
    }
    function accounting() external view returns (uint256 actual, uint256 accounted) {
        return (usd.balanceOf(address(this)), reserve);
    }
    function rescue(address asset, address to, uint256 amount) external nonReentrant {
        require(msg.sender == governance && asset != address(usd) && asset != address(this), 'protected');
        IERC20(asset).safeTransfer(to, amount);
    }
}
