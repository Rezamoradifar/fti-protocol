import React, {useEffect} from 'react';
import {createRoot} from 'react-dom/client';
function Sidebar(){return (<aside >
<a className="brand" href="/" aria-label="FTI">
<span className="mark">{"\u2733"}</span>
<span >{"FTI "}<small >{"PROTOCOL"}</small>
</span>
</a>
<p className="side-label">{"YOUR WORKSPACE"}</p>
<nav aria-label="Main navigation">
<button className="active" data-page="overview">
<span className="nav-icon">{"\u25c8"}</span>{"Overview"}</button>
<button data-page="network">
<span className="nav-icon">{"\u2318"}</span>{"Network & membership"}</button>
<button data-page="trade">
<span className="nav-icon">{"\u21c4"}</span>{"Trade FTI"}</button>
<button data-page="activity">
<span className="nav-icon">{"\u2197"}</span>{"Activity"}</button>
<button data-page="admin">
<span className="nav-icon">{"\u25ce"}</span>{"Governance & settlement"}</button>
</nav>
<div className="side-foot">
<span id="network-name">{"Connecting\u2026"}</span>
<p >{"Independent test release"}<br  />{"Test assets only"}</p>

</div>
</aside>);}

function Header(){return (<header >
<div >
<span className="eyebrow">{"THE FTI ECOSYSTEM"}</span>
<h1 id="page-title">{"Your protocol. In perspective."}</h1>
</div>
<div className="connection"><button id="theme" className="secondary" aria-label="Toggle color theme">{"◐"}</button>
<select id="local-accounts" aria-label="Test wallet" hidden={true}>
</select>
<button id="connect">{"Connect wallet"}</button>
</div>
</header>);}

function Overview(){return (<section id="overview" className="page">
<div className="hero">
<div className="hero-copy">
<span className="eyebrow">
<i className="live-dot">
</i>{" BUILT ON BNB CHAIN"}</span>
<h2 >{"A clearer view."}<br  />{"A connected ecosystem."}</h2>
<p >{"Explore the protocol, manage your membership and trade FTI. Every balance, directly from the chain."}</p>
<div className="hero-tags">
<span >{"On-chain accounting"}</span>
<span >{"Wallet-owned access"}</span>
<span >{"Testnet release"}</span>
</div>
</div>
<div className="orbital" aria-hidden="true">
<div className="orbit one">
</div>
<div className="orbit two">
</div>
<div className="orbit three">
</div>
<div className="orb-core">{"FTI"}<small >{"PROTOCOL"}</small>
</div>
<span className="orbit-label label-one">{"MEMBERSHIP"}</span>
<span className="orbit-label label-two">{"TOKEN ECONOMY"}</span>
<span className="orbit-label label-three">{"GOVERNANCE"}</span>
</div>
</div>
<div className="section-heading">
<h2 >{"Protocol at a glance"}</h2>
<span >{"Live contract data \u00b7 refreshes every 15s"}</span>
</div>
<div className="metrics">
<article >
<span >{"Internal FTI price"}</span>
<strong className="price-number" id="price">{"\u2014"}</strong>
<small >{"Test USD per token"}</small>
</article>
<article >
<span >{"Real token reserve"}</span>
<strong id="reserve">{"\u2014"}</strong>
<small >{"Excludes virtual reserve"}</small>
</article>
<article >
<span >{"Your claimable rewards"}</span>
<strong id="claimable">{"\u2014"}</strong>
<button id="claim">{"Claim rewards"}</button>
</article>
<article >
<span >{"Registered members"}</span>
<strong id="members">{"\u2014"}</strong>
<small >{"Includes 31 Genesis positions"}</small>
</article>
</div>{"\n"}<div className="split">
<article className="panel">
<div className="panel-head">
<h2 >{"Your account"}</h2>
<span id="rank" className="badge">{"\u2014"}</span>
</div>
<p id="wallet-address" className="address">{"No wallet connected"}</p>
<dl >
<div >
<dt >{"Test USD balance"}</dt>
<dd id="usd-balance">{"\u2014"}</dd>
</div>
<div >
<dt >{"FTI balance"}</dt>
<dd id="fti-balance">{"\u2014"}</dd>
</div>
<div >
<dt >{"Unlocked tokens"}</dt>
<dd id="unlocked">{"\u2014"}</dd>
</div>
<div >
<dt >{"Remaining manual buy allowance"}</dt>
<dd id="allowance">{"\u2014"}</dd>
</div>
</dl>
<button id="faucet" className="secondary">{"Get test USD"}</button>
</article>{"\n"}<article className="panel">
<div className="panel-head">
<h2 >{"Settlement status"}</h2>
<span id="epoch" className="badge">{"\u2014"}</span>
</div>
<dl >
<div >
<dt >{"Binary reward pool"}</dt>
<dd id="point-pool">{"\u2014"}</dd>
</div>
<div >
<dt >{"Processing phase"}</dt>
<dd id="phase">{"\u2014"}</dd>
</div>
<div >
<dt >{"Protection level"}</dt>
<dd id="protection">{"\u2014"}</dd>
</div>
<div >
<dt >{"Epoch end"}</dt>
<dd id="epoch-end">{"\u2014"}</dd>
</div>
<div >
<dt >{"Contract accounting check"}</dt>
<dd id="accounting">{"\u2014"}</dd>
</div>
</dl>
</article>
</div>{"\n"}<article className="panel">
<h2 >{"Reserve accounts"}</h2>
<div className="funds">
<div >
<span >{"Trading reserve"}</span>
<strong id="reserve2">{"\u2014"}</strong>
</div>
<div >
<span >{"Reserve support fund"}</span>
<strong id="buyback">{"\u2014"}</strong>
</div>
<div >
<span >{"Floor support fund"}</span>
<strong id="floor">{"\u2014"}</strong>
</div>
<div >
<span >{"Real FTI supply"}</span>
<strong id="supply">{"\u2014"}</strong>
</div>
</div>
</article>
</section>);}

function Membership(){return (<section id="network" className="page" hidden={true}>
<div className="split">
<article className="panel">
<h2 >{"Register or add units"}</h2>
<p >{"Each unit costs 100 test USD. New members fill the left position first, then the right position of their sponsor."}</p>
<form id="register-form">
<label >{"Sponsor address"}<input name="sponsor" placeholder="0x\u2026" dir="ltr" autoComplete="off" />
</label>
<label >{"Number of units"}<input name="units" type="number" min="1" max="1000000" step="1" defaultValue="1" required={true} />
</label>
<button type="submit" id="register-button">{"Register / add units"}</button>
</form>
<p className="muted">{"Existing members keep their sponsor and add units to their current position."}</p>
</article>
<article className="panel">
<h2 >{"Your branches"}</h2>
<div id="tree" className="tree">
</div>
<dl >
<div >
<dt >{"Purchased units"}</dt>
<dd id="units">{"\u2014"}</dd>
</div>
<div >
<dt >{"Lifetime units, left / right"}</dt>
<dd id="lifetime">{"\u2014"}</dd>
</div>
<div >
<dt >{"Carry units, left / right"}</dt>
<dd id="carry">{"\u2014"}</dd>
</div>
</dl>
</article>
</div>
<article className="panel">
<h2 >{"Auto-buy from rewards"}</h2>
<p >{"5% of eligible hourly rewards is reserved for FTI purchases. Pending funds remain yours until purchased or released as a USD claim."}</p>
<form id="auto-form" className="inline">
<label className="check">
<input name="enabled" type="checkbox" />{"Enable auto-buy"}</label>
<label >{"Maximum FTI price"}<input name="price" type="number" min="0.000001" step="any" defaultValue="1" required={true} />
</label>
<button >{"Save preference"}</button>
</form>
<p >{"Pending auto-buy: "}<strong id="auto-pending">{"\u2014"}</strong>
</p>
<div className="actions">
<button id="execute-auto">{"Execute pending purchase"}</button>
<button id="release-auto" className="secondary">{"Release pending funds to USD claim"}</button>
</div>
</article>
</section>);}

function Trading(){return (<section id="trade" className="page" hidden={true}>
<div className="split">
<article className="panel">
<span className="eyebrow">{"BUY FTI"}</span>
<h2 >{"Buy from the curve"}</h2>
<form id="buy-form">
<label >{"Test USD amount"}<input name="amount" type="number" min="0.000001" step="any" placeholder="100" required={true} />
</label>
<label >{"Maximum slippage (%)"}<input name="slippage" type="number" min="0" max="5" step="0.1" defaultValue="0.5" required={true} />
</label>
<div id="buy-quote" className="quote">{"Enter an amount."}</div>
<button >{"Confirm FTI purchase"}</button>
</form>
<p className="muted">{"Purchases may be locked or vested. The buy fee is deducted from the amount paid."}</p>
</article>
<article className="panel">
<span className="eyebrow">{"SELL FTI"}</span>
<h2 >{"Sell unlocked tokens"}</h2>
<form id="sell-form">
<label >{"FTI amount"}<input name="amount" type="number" min="0.000001" step="any" required={true} />
</label>
<label >{"Maximum slippage (%)"}<input name="slippage" type="number" min="0" max="5" step="0.1" defaultValue="0.5" required={true} />
</label>
<div id="sell-quote" className="quote">{"Enter a token amount."}</div>
<button >{"Confirm FTI sale"}</button>
</form>
<p className="muted">{"Proceeds follow the curve and sell fee, rather than spot price multiplied by token quantity."}</p>
</article>
</div>
<article className="panel">
<h2 >{"Transfer FTI"}</h2>
<form id="transfer-form" className="inline">
<label >{"Recipient member address"}<input name="to" placeholder="0x\u2026" dir="ltr" required={true} />
</label>
<label >{"Token amount"}<input name="amount" type="number" min="0.000001" step="any" required={true} />
</label>
<button >{"Transfer with 3% burn"}</button>
</form>
</article>
<article className="panel">
<h2 >{"Unlock schedule"}</h2>
<p >{"Each tranche unlocks at its wallet-count threshold or time deadline, whichever comes first."}</p>
<div className="table-scroll">
<table >
<thead >
<tr >
<th >{"FTI amount"}</th>
<th >{"Wallet counter"}</th>
<th >{"Time deadline"}</th>
<th >{"Status"}</th>
</tr>
</thead>
<tbody id="locks">
</tbody>
</table>
</div>
</article>
<article className="panel" id="exit-panel" hidden={true}>
<h2>Scheduled exit · experimental</h2>
<p>Reserve unlocked tokens for timed sales. Each chunk uses the current curve price and your minimum net USD per token. This is optional scheduling, not a guaranteed price or a global withdrawal limit.</p>
<form id="exit-form" className="inline">
<label>Total FTI<input name="tokens" type="number" min="0.000001" step="any" required /></label>
<label>FTI per chunk<input name="chunk" type="number" min="0.000001" step="any" required /></label>
<label>Minimum net USD per FTI<input name="price" type="number" min="0.000001" step="any" required /></label>
<label>Interval (minutes)<input name="interval" type="number" min="15" max="10080" defaultValue="60" required /></label>
<label>Expiry (hours)<input name="expiry" type="number" min="1" max="720" defaultValue="24" required /></label>
<button>Create exit order</button></form>
<p>Reserved tokens stay in your wallet but cannot be sold or transferred separately. Anyone can execute a ready chunk; proceeds go only to you. Cancellation is available even when trading is paused.</p>
<label>Order ID<input id="exit-id" type="number" min="0" step="1" /></label>
<div className="actions"><button id="exit-inspect" className="secondary">Check order</button><button id="exit-execute">Execute ready chunk</button><button id="exit-cancel" className="secondary">Cancel remaining order</button></div>
<p id="exit-details">Create an order or enter its ID. Execution requires a submitted transaction.</p>
<p id="support-budget"></p>
</article>
</section>);}

function Activity(){return (<section id="activity" className="page" hidden={true}>
<article className="panel">
<div className="panel-head">
<h2 >{"On-chain activity"}</h2>
<button id="refresh-events" className="secondary">{"Refresh"}</button>
</div>
<p className="muted">{"Up to 100 recent events from the last 1,500 blocks."}</p>
<div id="events" className="events">{"Loading\u2026"}</div>
</article>
</section>);}

function Governance(){return (<section id="admin" className="page" hidden={true}>
<div className="split">
<article className="panel">
<h2 >{"Permissionless processing"}</h2>
<p >{"These operations require no admin role. The caller pays transaction gas."}</p>
<div id="queue" className="quote">{"\u2014"}</div>
<div className="actions">
<button id="volume">{"Process volume"}</button>
<button id="close-epoch">{"Close epoch"}</button>
<button id="process-epoch">{"Process settlement"}</button>
<button id="begin-month">{"Close month"}</button>
<button id="process-month">{"Process monthly rewards"}</button>
</div>
<div id="dev-controls" hidden={true}>
<hr  />
<h3 >{"Local chain time controls"}</h3>
<div className="actions">
<button data-time="3601" className="secondary">{"Advance one hour"}</button>
<button data-time="7948800" className="secondary">{"Advance 92 days"}</button>
</div>
</div>
</article>
<article className="panel">
<h2 >{"3-of-5 governance"}</h2>
<p >{"Proposals require three approvals. Sensitive operations also require a 72-hour delay."}</p>
<form id="proposal-form">
<label >{"Operation"}<select name="action">
<option defaultValue="pauseBinary">{"Emergency registration pause"}</option>
<option defaultValue="pauseToken">{"Emergency trading pause"}</option>
<option defaultValue="unpauseBinary">{"Schedule registration unpause"}</option>
<option defaultValue="unpauseToken">{"Schedule token unpause"}</option>
<option defaultValue="milestone">{"Schedule allowance multiplier increase"}</option>
</select>
</label>
<button >{"Create proposal"}</button>
</form>
<div id="proposals">
</div>
<h3 >{"Execute after timelock"}</h3>
<form id="timelock-form">
<label >{"Scheduling proposal ID"}<input name="id" type="number" min="0" required={true} />
</label>
<button className="secondary">{"Execute ready operation"}</button>
</form>
</article>
</div>
<article className="panel">
<h2 >{"Contract addresses"}</h2>
<div id="contracts" className="contract-list">
</div>
</article>
</section>);}

function Footer(){return (<footer >
<span >
<b >{"FTI"}</b>{" Protocol"}</span>
<span >{"Testnet workspace \u00b7 No real funds"}</span>
<a href="https://github.com/Rezamoradifar/fti-protocol" target="_blank" rel="noreferrer">{"View source \u2197"}</a>
</footer>);}

function App(){useEffect(()=>{import('./controller.js').catch(e=>{document.getElementById('status').textContent='Connection unavailable: '+e.message;});},[]);return <>{"\n"}<Sidebar />{"\n"}<main >
<Header />{"\n"}<div className="notice">{"Test environment \u00b7 Price comes from the internal curve. Returns and a price floor are not guaranteed."}</div>
<div id="status" role="status" aria-live="polite">{"Reading contracts\u2026"}</div>{"\n"}<Overview />{"\n"}<Membership />{"\n"}<Trading />{"\n"}<Activity />{"\n"}<Governance />{"\n"}<Footer />
</main>
</>;}
createRoot(document.getElementById('root')).render(<App/>);
