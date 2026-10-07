import React,{useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {surface,surfaceTitle,surfacePages,defaultPage} from './surfaces.js';

function Icon({name}){
  const paths={
    overview:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    network:'M12 8v5 M5 17v-4h14v4 M9 2h6v6H9z M2 17h6v5H2z M16 17h6v5h-6z',
    trade:'M4 7h16m-5-5 5 5-5 5 M20 17H4m5-5-5 5 5 5',
    rewards:'M12 3v18 M7 7c0-5 10-5 10 0s-10 5-10 10 10 5 10 0',
    activity:'M3 12h4l3-8 4 16 3-8h4',
    admin:'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6z M8 12l3 3 5-6',
    wallet:'M3 5h17v15H3z M3 5l14-3v3 M16 11h5v5h-5z',
    arrow:'M5 12h14 M13 6l6 6-6 6'
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]||paths.arrow}/></svg>;
}

function Mark(){return <span className="mark" aria-hidden="true"><i/><i/><i/></span>}

function Sidebar(){
  return <aside className="sidebar">
    <a className="brand" href="/" aria-label="FTI Protocol home"><Mark/><span>FTI <small>PROTOCOL V3</small></span></a>
    <p className="side-label">{surfaceTitle}</p>
    <nav aria-label="Workspace navigation">
      {surfacePages.map(([id,label])=><button key={id} className={id===defaultPage?'active':''} data-page={id} aria-current={id===defaultPage?'page':undefined}><Icon name={id==='token-home'?'overview':id}/><span>{label}</span></button>)}
    </nav>
    <div className="surface-links">
      <span>FTI V3</span>
      <a href="/">Main website <span>↗</span></a>
      {surface!=='member'&&<a href="/app/">Member dashboard <span>↗</span></a>}
      {surface!=='token'&&<a href="/token/">FTI token <span>↗</span></a>}
      {surface!=='admin'&&<a href="/admin/">Administration <span>↗</span></a>}
    </div>
    <div className="side-guide">
      <span className="badge">{surface==='admin'?'5 / 7 DAO':'V3 TESTNET'}</span>
      <h3>{surface==='admin'?'Emergency control without reserve custody.':'Zero-start reserve token.'}</h3>
      <p>{surface==='admin'?'Partner DAO votes can pause or trigger emergency unwind. The council cannot withdraw reserve collateral.':'No premint, no time locks, no transfer tax. Buy and sell protection is enforced on-chain.'}</p>
    </div>
    <div className="side-foot"><span id="network-name">Connecting…</span><a href="/">← Back to website</a><small>BNB Testnet · test assets only</small></div>
  </aside>;
}

function Header(){
  return <header className="workspace-header">
    <div><span className="eyebrow">FTI V3 / {surfaceTitle}</span><h1 id="page-title" tabIndex="-1">{surfacePages[0][1]}</h1></div>
    <div className="connection">
      <button id="refresh-state" className="icon-button" aria-label="Refresh contract data">↻</button>
      <button id="theme" className="icon-button" aria-label="Toggle color theme">◐</button>
      <select id="local-accounts" aria-label="Local test wallet" hidden/>
      <button id="connect"><Icon name="wallet"/><span id="connect-label">Connect wallet</span></button>
    </div>
  </header>;
}

function Go({page,children,className='secondary'}){return <button className={className} data-go={page}>{children}<Icon/></button>}

function Overview(){
  return <section id="overview" className="page" hidden={surface!=='member'}>
    <div className="welcome-grid">
      <article className="welcome">
        <div className="eyebrow"><i className="live-dot"/> FTI V3 · ZERO START</div>
        <h2>Your membership.<br/><em>Your on-chain position.</em></h2>
        <p id="welcome-copy">Connect your wallet to see balances, membership and funded rewards.</p>
        <div className="actions"><Go page="trade" className="primary">Trade FTI</Go><Go page="network">Membership</Go></div>
        <div className="welcome-lines" aria-hidden="true"><i/><i/><i/></div>
      </article>
      <article className="rank-card">
        <div className="panel-head"><span className="eyebrow">YOUR RANK</span><span className="mini-symbol">✳</span></div>
        <h2 id="rank">Not connected</h2>
        <p id="rank-description">Rank progression will appear here.</p>
        <progress id="rank-progress" value="0" max="100" aria-label="Progress toward next rank"/>
        <div className="progress-label"><span id="rank-points">— lifetime points</span><span id="rank-next">—</span></div>
        <Go page="network" className="text-button">View network</Go>
      </article>
    </div>

    <div className="section-heading"><h2>Your balances</h2><span id="updated-at">Waiting for contract data</span></div>
    <div className="metrics">
      <article><span>FTI balance</span><strong id="fti-balance">—</strong><small>Fully transferable in V3</small><Go page="trade" className="metric-link">Manage tokens</Go></article>
      <article><span>Available to sell</span><strong id="unlocked">—</strong><small id="locked-summary">V3 has no time or wallet-count lock</small><Go page="trade" className="metric-link">Open trading</Go></article>
      <article><span>Test USD balance</span><strong id="usd-balance">—</strong><small>MockUSD · test asset only</small><button id="faucet" className="metric-link" data-write data-requires="wallet">Get test USD <span>↗</span></button></article>
      <article className="reward-metric"><span>Claimable rewards</span><strong id="claimable">—</strong><small>Funded test USD allocation</small><button id="claim" className="metric-link" data-write data-requires="reward">Claim rewards <span>↗</span></button></article>
    </div>

    <div className="split">
      <article className="panel">
        <div className="panel-head"><h2>Your wallet</h2><span className="badge" id="membership-status">Not connected</span></div>
        <p id="wallet-address" className="address">No wallet connected</p>
        <dl>
          <div><dt>Manual purchase allowance remaining</dt><dd><span id="allowance">—</span> USD</dd></div>
          <div><dt>Purchased membership units</dt><dd id="account-units">—</dd></div>
          <div><dt>Network</dt><dd id="account-network">—</dd></div>
        </dl>
        <div className="actions"><button id="copy-address" className="secondary" disabled>Copy address</button><Go page="network">Manage membership</Go></div>
      </article>
      <article className="panel">
        <div className="panel-head"><h2>Getting started</h2><span className="badge">3 STEPS</span></div>
        <ol className="checklist">
          <li id="step-wallet"><span>01</span><div><b>Connect your wallet</b><p>Use BNB Testnet for this release.</p></div></li>
          <li id="step-funds"><span>02</span><div><b>Get test assets</b><p>Test USD is free; tBNB pays gas.</p></div></li>
          <li id="step-member"><span>03</span><div><b>Activate membership</b><p>At least one paid unit enables manual FTI buying.</p></div></li>
        </ol>
      </article>
    </div>

    <div className="section-heading"><h2>Protocol snapshot</h2><span>Read directly from V3 contracts</span></div>
    <article className="panel protocol-strip">
      <div><span>Internal reserve/share price</span><strong><span id="price">—</span><small> USD</small></strong></div>
      <div><span>Trading reserve</span><strong id="reserve">—</strong></div>
      <div><span>Membership support reserve</span><strong id="support-reserve">—</strong></div>
      <div><span>Registered positions</span><strong id="members">—</strong></div>
      <div><span>Accounting</span><strong id="accounting" className="small-value">—</strong></div>
    </article>
  </section>;
}

function Membership(){
  return <section id="network" className="page" hidden>
    <div className="page-intro"><span className="eyebrow">FUNDED BINARY MEMBERSHIP</span><h2>Build your position.<br/><em>Track both branches.</em></h2><p>Each unit costs 100 test USD. Five USD per unit is routed to the separate V3 support reserve without minting FTI.</p></div>
    <div className="split">
      <article className="panel">
        <div className="panel-head"><h2 id="registration-title">Join the network</h2><span className="badge">100 USD / UNIT</span></div>
        <form id="register-form">
          <label>Sponsor address<input name="sponsor" placeholder="0x…" autoComplete="off" spellCheck="false"/></label>
          <p className="field-help" id="sponsor-help">New positions fill the sponsor’s left slot first, then right.</p>
          <label>Number of units<input name="units" type="number" min="1" max="1000000" step="1" defaultValue="1" required/></label>
          <div className="quote summary-row"><span>Total contribution</span><b id="registration-cost">100 test USD</b></div>
          <button type="submit" id="register-button" data-write data-requires="wallet">Register membership</button>
        </form>
        <p className="muted">The transaction uses real on-chain accounting with test collateral. No membership contribution mints FTI.</p>
      </article>
      <article className="panel">
        <div className="panel-head"><h2>Your direct network</h2><span className="badge">LEFT / RIGHT</span></div>
        <div className="tree-root"><Icon name="network"/><span>Your position</span></div>
        <div id="tree" className="tree"/>
        <dl>
          <div><dt>Purchased units</dt><dd id="units">—</dd></div>
          <div><dt>Lifetime volume · left / right</dt><dd id="lifetime">—</dd></div>
          <div><dt>Carried volume · left / right</dt><dd id="carry">—</dd></div>
        </dl>
      </article>
    </div>
    <article className="panel referral">
      <div><span className="eyebrow">YOUR INVITATION</span><h2>Direct registration link.</h2><p>Share your sponsor link. The contract still enforces tree placement.</p><input id="referral-link" aria-label="Your membership invitation link" readOnly placeholder="Connect a registered wallet to create your link"/></div>
      <button id="copy-referral" className="secondary" disabled>Copy invitation link <Icon/></button>
    </article>
  </section>;
}

function Trading(){
  return <section id="trade" className="page" hidden>
    <div className="page-intro"><span className="eyebrow">FTI V3 EXCHANGE</span><h2>No locks.<br/><em>Protected exits.</em></h2><p>V3 uses slippage checks plus anti-whale limits instead of time locks. Transfers have no token tax.</p></div>
    <div id="trade-notice" className="inline-notice">Connect a registered wallet to trade.</div>

    <div className="split trading-grid">
      <article className="panel trade-panel">
        <div className="panel-head"><h2><span className="trade-symbol">↗</span> Buy FTI</h2><span className="badge">3% TOTAL FEE</span></div>
        <form id="buy-form">
          <label>You pay · test USD<input name="amount" type="number" min="0.000000000000000001" step="any" placeholder="0.00" required/></label>
          <div className="field-help" id="buy-available">Wallet balance and allowance appear after connection.</div>
          <label>Maximum slippage (%)<input name="slippage" type="number" min="0" max="5" step="0.1" defaultValue="0.5" required/></label>
          <div id="buy-quote" className="quote" aria-live="polite">Enter an amount for a live quote.</div>
          <button data-write data-requires="buyer">Confirm FTI purchase</button>
        </form>
        <p className="muted">Of the 3% trading fee, one percentage point backs FTI minted to the two animal-welfare wallets and two percentage points remain in reserve.</p>
      </article>

      <article className="panel trade-panel">
        <div className="panel-head"><h2><span className="trade-symbol sell-symbol">↙</span> Sell FTI</h2><span className="badge">ANTI-WHALE</span></div>
        <form id="sell-form">
          <label>You sell · FTI<input name="amount" type="number" min="0.000000000000000001" step="any" placeholder="0.00" required/></label>
          <div className="amount-help"><span id="sell-available">Available: — FTI</span><button id="max-sell" type="button" className="text-button" disabled>Use allowed max</button></div>
          <label>Maximum slippage (%)<input name="slippage" type="number" min="0" max="5" step="0.1" defaultValue="0.5" required/></label>
          <div id="sell-quote" className="quote" aria-live="polite">Enter an amount for a live quote.</div>
          <button data-write data-requires="unlocked">Confirm FTI sale</button>
        </form>
        <p className="muted">Each sale is limited by the current reserve and the rolling hourly outflow window.</p>
      </article>
    </div>

    <article className="panel">
      <div className="panel-head"><h2>Sell protection</h2><span className="badge">ON-CHAIN</span></div>
      <div className="availability">
        <div><span>Your total FTI</span><b id="trade-balance">—</b></div>
        <div><span>Available now</span><b id="trade-unlocked">—</b></div>
        <div><span>Max single sell · tokens</span><b id="anti-whale-single">—</b></div>
        <div><span>Hourly outflow used</span><b id="hourly-outflow">—</b></div>
        <div><span>Hourly outflow remaining</span><b id="hourly-remaining">—</b></div>
      </div>
      <p>V3 has no 30-day, 90-day or wallet-count token lock. The sell circuit breaker limits reserve outflow instead.</p>
    </article>

    <article className="panel">
      <h2>Transfer FTI</h2>
      <p>Standard ERC-20 transfer. V3 applies <b>no transfer tax and no transfer burn</b>.</p>
      <form id="transfer-form" className="inline">
        <label>Recipient address<input name="to" placeholder="0x…" spellCheck="false" required/></label>
        <label>FTI amount<input name="amount" type="number" min="0.000000000000000001" step="any" required/></label>
        <button data-write data-requires="unlocked">Transfer FTI</button>
      </form>
    </article>
  </section>;
}

function Rewards(){
  return <section id="rewards" className="page" hidden>
    <div className="page-intro"><span className="eyebrow">FUNDED REWARDS</span><h2>Attributed funding.<br/><em>Automatic wallet payouts.</em></h2><p>After rewards are allocated, the permissionless reward queue pays eligible wallets automatically in bounded batches. Membership does not guarantee income.</p></div>
    <div className="split">
      <article className="panel reward-hero"><span className="eyebrow">PENDING AUTO PAYOUT · TEST USD</span><strong id="reward-claimable">—</strong><p>Allocated cash waits in the reward queue until the next automatic payout batch. Manual claim remains available as a fallback.</p><button id="claim-rewards" data-write data-requires="reward">Fallback manual claim <Icon/></button></article>
      <article className="panel"><div className="panel-head"><h2>Settlement status</h2><span id="epoch" className="badge">—</span></div><dl><div><dt>Binary point pool</dt><dd id="point-pool">—</dd></div><div><dt>Processing phase</dt><dd id="phase">—</dd></div><div><dt>Protection level</dt><dd id="protection">—</dd></div><div><dt>Epoch boundary</dt><dd id="epoch-end">—</dd></div></dl></article>
    </div>

    <article className="panel">
      <div className="panel-head"><h2>Auto-buy preferences</h2><span className="badge" id="auto-status">Not connected</span></div>
      <p>Eligible ranked members can direct 5% of binary reward allocation into FTI auto-buy, with a maximum accepted price.</p>
      <form id="auto-form" className="inline"><label className="check"><input name="enabled" type="checkbox"/>Enable auto-buy</label><label>Maximum price · USD per FTI<input name="price" type="number" min="0.000001" step="any" defaultValue="1" required/></label><button data-write data-requires="member">Save preference</button></form>
      <div className="auto-balance"><div><span>Pending auto-buy · test USD</span><strong id="auto-pending">—</strong></div><div className="actions"><button id="execute-auto" data-write data-requires="auto">Buy with pending funds</button><button id="release-auto" className="secondary" data-write data-requires="auto">Move to cash claim</button></div></div>
    </article>

    <article className="panel">
      <h2>Attributed reserve accounting</h2>
      <dl>
        <div><dt>Retained point reserve</dt><dd id="point-retained">—</dd></div>
        <div><dt>Retained builder reserve</dt><dd id="builder-retained">—</dd></div>
        <div><dt>Your left / right funded credits</dt><dd id="wallet-credits">—</dd></div>
      </dl>
      <p className="muted">Retained amounts are not member balances and cannot be claimed merely because they remain in the contract.</p>
    </article>

    <article className="panel">
      <h2>V3 reserve accounts</h2>
      <div className="funds">
        <div><span>Trading reserve</span><strong id="reserve2">—</strong></div>
        <div><span>Membership support reserve</span><strong id="support2">—</strong></div>
        <div><span>Real FTI supply</span><strong id="supply">—</strong></div>
        <div><span>Builder allowance multiplier</span><strong id="builder-multiplier">—</strong></div>
      </div>
    </article>
  </section>;
}

function TokenHome(){
  return <section id="token-home" className="page" hidden={surface!=='token'}>
    <article className="token-hero">
      <div><span className="eyebrow"><i className="live-dot"/> FTI RESERVE TOKEN V3 · TESTNET</span><h2>Zero premint.<br/><em>Real recorded reserve.</em></h2><p>The first real token purchase creates supply. Membership support never mints FTI and does not set an artificial starting price.</p><div className="actions"><Go page="trade" className="primary">Buy & sell FTI</Go></div></div>
      <div className="token-emblem" aria-hidden="true"><span>FTI</span><small>V3 / BNB TESTNET</small></div>
    </article>

    <div className="section-heading"><h2>Live token snapshot</h2><span>Directly from FTIReserveTokenV3</span></div>
    <div className="metrics token-metrics">
      <article><span id="token-price-label">Reserve / share price</span><strong id="token-spot">—</strong><small>Test USD / FTI</small></article>
      <article><span>Trading reserve</span><strong id="token-reserve">—</strong><small>Recorded collateral for trading</small></article>
      <article><span>Membership support</span><strong id="token-support">—</strong><small>Separate, no FTI mint</small></article>
      <article><span>Real token supply</span><strong id="token-supply">—</strong><small>No premint</small></article>
      <article><span>Trading state</span><strong id="token-status">—</strong><small>Active / paused / emergency</small></article>
    </div>

    <div className="token-principles">
      <article className="panel"><span className="eyebrow">01 / FEE</span><h2>3% buy & sell.</h2><p>The charity allocation is disabled in this revision. The full 3% trading fee remains in the recorded reserve.</p></article>
      <article className="panel"><span className="eyebrow">02 / TRANSFER</span><h2>Standard ERC-20.</h2><p>No transfer tax, no transfer burn, and no time/wallet-count token lock in V3.</p></article>
      <article className="panel"><span className="eyebrow">03 / SELL</span><h2>Rate-limited exits.</h2><p>Single-sale and hourly reserve-outflow limits replace the old lock model.</p></article>
    </div>

    <div className="split">
      <article className="panel">
        <h2>Live V3 parameters</h2>
        <dl>
          <div><dt>Launch price</dt><dd id="launch-price">—</dd></div>
          <div><dt>Builder multiplier</dt><dd id="token-builder-multiplier">—</dd></div>
          <div><dt>Max single sell</dt><dd id="token-max-single">—</dd></div>
          <div><dt>Hourly outflow limit</dt><dd id="token-hourly-limit">—</dd></div>
          <div><dt>Charity allocation</dt><dd id="charity-status">Disabled · 0%</dd></div>
        </dl>
      </article>
      <article className="panel">
        <h2>Check the deployment</h2>
        <span className="badge" id="token-network">Checking network…</span>
        <p className="address" id="token-address">Loading token address…</p>
        <div className="actions"><a id="token-explorer" className="token-doc-link" target="_blank" rel="noreferrer">Token explorer ↗</a><a id="token-source" href="https://github.com/Rezamoradifar/fti-protocol/blob/feat/zero-start-charity-protection/contracts/FTIReserveTokenV3.sol" className="token-doc-link" target="_blank" rel="noreferrer">Read V3 source ↗</a></div>
        <p className="muted">Internal reserve/share price is not a guarantee of external market value, profit or repayment.</p>
      </article>
    </div>
  </section>;
}

function Activity(){
  return <section id="activity" className="page" hidden>
    <div className="page-intro"><span className="eyebrow">ON-CHAIN RECORD</span><h2>Protocol activity.</h2><p>Recent events from the configured V3 contracts.</p></div>
    <article className="panel"><div className="panel-head"><h2>Recent events</h2><button id="refresh-events" className="secondary">Refresh events</button></div><div id="events" className="events">Open activity to load recent events.</div></article>
  </section>;
}

function Governance(){
  return <section id="admin" className="page" hidden={surface!=='admin'}>
    <div className="page-intro"><span className="eyebrow">V3 PROTOCOL OPERATIONS</span><h2>5-of-7 Partner DAO.<br/><em>No reserve custody.</em></h2><p>The council can authorize emergency actions but cannot rescue the protected stablecoin or FTI reserve.</p></div>

    <div id="admin-access" className="admin-access" role="status">
      <span className="badge" id="admin-role">READ ONLY</span>
      <div><b>Wallet-based roles</b><p id="admin-access-copy">Connect a wallet to check Partner DAO or governance access.</p></div>
    </div>

    <div className="split">
      <article className="panel">
        <h2>Permissionless settlement</h2>
        <p>Any wallet can pay gas to progress bounded settlement batches. The Reward action drains queued commissions directly to eligible wallets; the keeper also runs this automatically.</p>
        <div id="queue" className="quote">—</div>
        <div className="actions">
          {[
            ['volume','Process volume'],
            ['close-epoch','Close epoch'],
            ['process-epoch','Process settlement'],
            ['begin-month','Close month'],
            ['process-month','Process monthly rewards'],
            ['reward-all','Reward · pay eligible wallets']
          ].map(([id,label])=><button key={id} id={id} className="secondary" data-write data-requires="wallet">{label}</button>)}
        </div>
        <div id="dev-controls" hidden><hr/><h3>Local chain time</h3><div className="actions"><button data-time="3601" className="secondary" data-write>Advance one hour</button><button data-time="2678400" className="secondary" data-write>Advance 31 days</button></div></div>
      </article>

      <article className="panel">
        <h2>Partner DAO · 5 of 7</h2>
        <p>Five approvals are required before a proposal can execute. Emergency unwind is irreversible and redeems holders pro-rata; it does not transfer reserve assets to DAO wallets.</p>
        <div id="guardian-list" className="contract-list"/>
        <form id="proposal-form">
          <label>DAO operation
            <select name="action">
              <option value="pauseBinary">Pause membership funding</option>
              <option value="pauseToken">Pause token trading/transfers</option>
              <option value="emergencyUnwind">Activate irreversible emergency unwind</option>
            </select>
          </label>
          <button data-write data-requires="council">Create proposal</button>
        </form>
        <div id="proposals"/>
      </article>
    </div>

    <article className="panel">
      <h2>Governance-only recovery</h2>
      <p>The deployer governance wallet can unpause the binary plan or token after a normal pause. Emergency unwind cannot be undone.</p>
      <form id="governance-form" className="inline">
        <label>Operation<select name="action"><option value="unpauseBinary">Unpause membership</option><option value="unpauseToken">Unpause token</option></select></label>
        <button data-write data-requires="governance">Execute governance action</button>
      </form>
    </article>

    <article className="panel"><h2>Deployed contracts</h2><div id="contracts" className="contract-list"/></article>
  </section>;
}

function App(){
  useEffect(()=>{
    import('./controller.js').catch(error=>{
      const s=document.getElementById('status');
      s.textContent='Connection unavailable: '+error.message+'. Reload this page to retry.';
      s.classList.add('error');
    });
  },[]);

  return <>
    <a className="skip" href="#main">Skip to workspace</a>
    <Sidebar/>
    <main id="main">
      <Header/>
      <div className="notice"><span className="badge">TESTNET · V3</span><span>Test assets only. No guaranteed income, market price or repayment.</span><a href="/">Explore the protocol ↗</a></div>
      <div className="status-bar"><span id="status" role="status" aria-live="polite">Reading V3 contracts…</span><a id="transaction-link" hidden target="_blank" rel="noreferrer">View transaction ↗</a></div>
      <TokenHome/><Overview/><Membership/><Trading/><Rewards/><Activity/><Governance/>
      <footer><span><b>FTI</b> Protocol V3 · {surfaceTitle.toLowerCase()}</span><div><a href="/">Website</a><a href="https://github.com/Rezamoradifar/fti-protocol/tree/feat/zero-start-charity-protection" target="_blank" rel="noreferrer">V3 source ↗</a></div></footer>
    </main>
  </>;
}

createRoot(document.getElementById('root')).render(<App/>);
