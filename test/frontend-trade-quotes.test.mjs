import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {formatEther,parseEther as E} from 'ethers';

// Load the actual isolated helpers, without importing the controller's browser
// startup, wallet provider or /vendor module. No fee formula is duplicated here.
const source=fs.readFileSync('frontend/controller.js','utf8');
const start=source.indexOf('async function readTradeQuote('),end=source.indexOf('// End isolated quote helpers.');
assert(start>=0&&end>start,'controller quote helpers must remain discoverable');
const {readTradeQuote,formatTradeQuote,validateTradeAccess,reserveExitPolicy,tokenLifecycle,validateFundingAccess}=new Function('formatEther',source.slice(start,end)+'\nreturn {readTradeQuote,formatTradeQuote,validateTradeAccess,reserveExitPolicy,tokenLifecycle,validateFundingAccess};')(formatEther);
const forbidden=()=>{throw Error('Unexpected compatibility quote call');};

test('reserve buy fee and output share one block and exact amounts drive displayed minimum',async()=>{
 const calls=[],amount=E('1000'),output=E('9525'),fee=E('47.5'),blockTag=123;
 const token={
  async quoteBuy(value,overrides){calls.push(['quoteBuy',value,overrides]);return output;},
  async buyFeeQuote(value,overrides){calls.push(['buyFeeQuote',value,overrides]);return [fee,amount-fee];},
  quoteSell:forbidden,sellFeeQuote:forbidden
 };
 const quote=await readTradeQuote(token,'buy',amount,50n,true,blockTag);
 assert.deepEqual(calls,[['quoteBuy',amount,{blockTag}],['buyFeeQuote',amount,{blockTag}]]);
 assert.equal(quote.output,output);assert.equal(quote.feeAmount,fee);assert.equal(quote.minimum,output*9950n/10000n);
 assert.equal(formatTradeQuote('buy',quote),'Estimated output: 9525.0 FTI\nMinimum accepted: 9477.375 FTI\nQuoted fee: 47.5 test USD');
});

test('reserve sale displays sub-bps fee atoms without calling truncated legacy quoteSell',async()=>{
 const gross=E('501'),fee=E('15.030139720558882236'),out=gross-fee,calls=[];
 const token={quoteSell:forbidden,quoteBuy:forbidden,async sellFeeQuote(value,overrides){calls.push([value,overrides]);return [fee,out,gross];}};
 const quote=await readTradeQuote(token,'sell',E('5010'),0n,true,456);
 assert.deepEqual(calls,[[E('5010'),{blockTag:456}]]);
 assert.equal(quote.output,out);assert.equal(quote.minimum,out);assert.equal(quote.feeBps,undefined);
 const display=formatTradeQuote('sell',quote);
 assert(display.includes('Quoted fee: 15.030139720558882236 test USD'));
 assert(display.includes('Minimum accepted: '+formatEther(out)+' test USD'));
 assert(!display.includes('%'));
});

test('historical full-supply or current emergency sale shows zero exact fee and one-atom outputs remain visible',async()=>{
 const token={quoteSell:forbidden,async sellFeeQuote(){return [0n,1n,1n];}};
 const quote=await readTradeQuote(token,'sell',10n,0n,true,789);
 assert.equal(quote.minimum,1n);
 assert.equal(formatTradeQuote('sell',quote),'Net proceeds: 0.000000000000000001 test USD\nMinimum accepted: 0.000000000000000001 test USD\nQuoted fee: 0.0 test USD');
});

test('legacy token buys and sells need no reserve-only fee ABI and preserve quoted output',async()=>{
 const token={
  buyFeeQuote:forbidden,sellFeeQuote:forbidden,
  async quoteBuy(amount,overrides){assert.equal(amount,E('100'));assert.deepEqual(overrides,{blockTag:99});return E('960');},
  async quoteSell(amount,overrides){assert.equal(amount,E('100'));assert.deepEqual(overrides,{blockTag:99});return [E('9'),475n,E('10')];}
 };
 const buy=await readTradeQuote(token,'buy',E('100'),50n,false,99);
 assert.equal(buy.output,E('960'));assert.equal(buy.minimum,E('955.2'));assert.equal(buy.feeAmount,undefined);
 assert(!formatTradeQuote('buy',buy).includes('fee'));
 const sell=await readTradeQuote(token,'sell',E('100'),50n,false,99);
 assert.equal(sell.minimum,E('8.955'));assert.equal(sell.feeBps,475n);
 assert(formatTradeQuote('sell',sell).endsWith('Quoted fee rate: 4.75%'));
});

test('quote failures remain failures rather than falling back to a guessed fee',async()=>{
 const token={async quoteBuy(){return E('970');},async buyFeeQuote(){throw Error('Fee unavailable');}};
 await assert.rejects(readTradeQuote(token,'buy',E('100'),0n,true,1),/Fee unavailable/);
 await assert.rejects(readTradeQuote({},'other',E('1'),0n,true,1),/Unknown trade direction/);
});

test('buy prerequisites do not block holder sales during pause/emergency or after transfers',()=>{
 const member={exists:true,units:'1'},recipient={exists:false,units:'0'};
 assert.doesNotThrow(()=>validateTradeAccess('sell',recipient,true));
 assert.doesNotThrow(()=>validateTradeAccess('sell',member,true));
 assert.throws(()=>validateTradeAccess('buy',member,true),/purchases are paused/);
 assert.throws(()=>validateTradeAccess('buy',recipient,false),/Register or add membership units/);
 assert.throws(()=>validateTradeAccess('sell',null,false),/Reload wallet data/);
 assert.doesNotThrow(()=>validateTradeAccess('buy',member,false));
});

test('reserve policy labels and quote path remain distinct from legacy fee-rate display',()=>{
 assert(source.includes("text('trade-buy-policy'"));assert(source.includes("text('trade-sell-policy'"));
 assert(source.includes('greater of $500 or 5% of pretrade live reserve'));
 assert(source.includes('7% curve parameter remains provisional'));
 assert(source.includes('Full-supply and emergency redemptions are fee-free'));
 assert(source.includes('Protected fund cash is excluded from the threshold, price and payouts'));
 assert(source.includes('await rpc.getBlockNumber()'));
 const markup=fs.readFileSync('frontend/main.jsx','utf8');
 for(const id of ['trade-buy-policy','trade-sell-policy','trade-availability-policy','token-hold-description','token-fund-label'])assert(markup.includes('id="'+id+'"'));
 assert(!markup.includes('global-pressure impact'));
});


test('retirement ordinary terminal sales preserve exact net quote and slippage instead of assuming a free full exit',async()=>{
 const gross=E('1234.567890123456789123'),fee=E('67.633552050773548232'),payout=gross-fee;
 const token={quoteSell:forbidden,async sellFeeQuote(amount,overrides){assert.equal(amount,970n);assert.deepEqual(overrides,{blockTag:900});return [fee,payout,gross];}};
 const q=await readTradeQuote(token,'sell',970n,37n,true,900);
 assert.equal(q.output,payout);assert.equal(q.feeAmount,fee);assert.equal(q.minimum,payout*9963n/10000n);
 assert(formatTradeQuote('sell',q).includes('Quoted fee: '+formatEther(fee)+' test USD'));
 assert(formatTradeQuote('sell',q).includes('Net proceeds: '+formatEther(payout)+' test USD'));
});

test('rendered current-model policy text never describes an ordinary full exit as fee-free',()=>{
 const policyStart=source.indexOf('const retirementModel='),policyEnd=source.indexOf('const rpc=');
 assert(policyStart>=0&&policyEnd>policyStart);
 const render=tokenContract=>{
  const labels=new Map(),elements=new Map();
  new Function('cfg','text','$','reserveExitPolicy',source.slice(policyStart,policyEnd))(
   {tokenContract,binaryContract:'BinaryPlan'},(key,value)=>labels.set(key,value),key=>{if(!elements.has(key))elements.set(key,{});return elements.get(key);},reserveExitPolicy);
  return {labels,elements};
 };
 const current=render('FTIRetirementReviewToken');
 for(const key of ['token-model-description','token-sale-description','trade-sell-policy']){
  assert(current.labels.get(key).includes('Ordinary full-supply sales pay net of the current-trade fee'));
  assert(current.labels.get(key).includes('Only emergency redemptions are fee-free'));
  assert(!current.labels.get(key).includes('Full-supply and emergency'));
 }
 assert(current.labels.get('retirement-rules').includes('Binary cash claims remain owned by their beneficiaries'));
 assert(current.labels.get('retirement-rules').includes('five-of-seven Council approval, a 72-hour delay'));
 assert.equal(current.elements.get('#retirement-policy').hidden,false);
 const earlier=render('FTIReserveToken');
 assert(earlier.labels.get('trade-sell-policy').includes('Full-supply and emergency redemptions are fee-free'));
 assert.equal(earlier.elements.get('#retirement-policy').hidden,true);
 const legacy=render('FTIToken');assert.equal(legacy.labels.size,0);
});

test('zero-supply lifecycle labels distinguish historical R=0 from a live quote and permanent retirement',()=>{
 const fresh=tokenLifecycle({supply:'0'},true);
 assert.equal(fresh.priceLabel,'Live ratio undefined (zero supply)');assert.equal(fresh.fundingBlocked,false);
 const active=tokenLifecycle({supply:'970',tokenPaused:false},true);
 assert.equal(active.priceLabel,'Calculated reserve / supply · USD per FTI');assert.equal(active.buyingBlocked,false);
 const closed=tokenLifecycle({supply:'0',lifecycleClosed:true},true);
 assert.equal(closed.status,'Lifecycle closed');assert.equal(closed.priceLabel,'Live ratio undefined (zero supply)');
 assert.equal(closed.fundingBlocked,true);assert.equal(closed.buyingBlocked,true);assert(closed.notice.includes('Binary cash claims remain available'));
 const retired=tokenLifecycle({supply:'0',lifecycleClosed:true,permanentlyRetired:true,tokenPaused:true},true);
 assert.equal(retired.status,'Permanently retired');assert.equal(retired.fundingBlocked,true);assert(retired.notice.includes('permanently retired'));
 assert.equal(tokenLifecycle({supply:'0',lifecycleClosed:true},false).fundingBlocked,false,'preserve earlier-model membership behavior');
});

test('closed or retired token access blocks new funding before approval but does not block beneficiary sales or claims',()=>{
 const member={exists:true,units:'1'};
 for(const state of [{lifecycleClosed:true},{permanentlyRetired:true}]){
  assert.throws(()=>validateFundingAccess(state,true),/funding is disabled/);
  assert.throws(()=>validateTradeAccess('buy',member,false,state.lifecycleClosed,state.permanentlyRetired),/new purchases are unavailable/);
  assert.doesNotThrow(()=>validateTradeAccess('sell',member,true,state.lifecycleClosed,state.permanentlyRetired));
 }
 assert.throws(()=>validateFundingAccess({paused:true},false),/funding is paused/);
 assert.throws(()=>validateFundingAccess(null,true),/Reload contract data/);
 assert.doesNotThrow(()=>validateFundingAccess({lifecycleClosed:true},false));
 assert(source.includes('validateFundingAccess(state,retirementModel);const f=e.target'));
 assert(source.includes("$('#copy-referral').disabled=!w?.exists||lifecycle.fundingBlocked"));
 const markup=fs.readFileSync('frontend/main.jsx','utf8');
 assert(markup.includes('id="register-button" data-write data-requires="funder"'));
 assert(markup.includes('id="execute-auto" data-write data-requires="autoBuyer"'));
 assert(markup.includes('id="release-auto" className="secondary" data-write data-requires="auto"'));
 assert(markup.includes('id="claim-rewards" data-write data-requires="reward"'));
 for(const id of ['token-development-claim','token-development-fund','token-retired','token-reference-price','lifecycle-notice'])assert(markup.includes('id="'+id+'"'));
});
test('restart-capable ordinary zero supply permits funding and buys but permanent closure is separate',()=>{
 const member={exists:true,units:'1'},empty={supply:'0',lifecycleClosed:true,restartSupported:true,buysPermanentlyClosed:false};
 const view=tokenLifecycle(empty,true);assert.equal(view.fundingBlocked,false);assert.equal(view.buyingBlocked,false);assert.equal(view.status,'Zero supply · restart available');assert(view.notice.includes('same token can restart'));assert(view.notice.includes('retained exact reference ratio'));assert(view.notice.includes('does not permit permissionless'));
 assert.doesNotThrow(()=>validateFundingAccess(empty,true));assert.doesNotThrow(()=>validateTradeAccess('buy',member,false,true,false,true,false));
 for(const patch of [{tokenPaused:true},{emergencyExit:true},{buysPermanentlyClosed:true},{permanentlyRetired:true}])assert.equal(tokenLifecycle({...empty,...patch},true).buyingBlocked,true);
 const permanent=tokenLifecycle({...empty,buysPermanentlyClosed:true},true);assert.equal(permanent.fundingBlocked,true);assert.equal(permanent.status,'Buys permanently closed');
 assert.throws(()=>validateTradeAccess('buy',member,false,true,false,true,true),/permanently closed/);
 assert.throws(()=>validateTradeAccess('buy',member,false,true,false,true,false,true),/paused/);
 assert.doesNotThrow(()=>validateTradeAccess('sell',member,true,true,false,true,true,true));
});
