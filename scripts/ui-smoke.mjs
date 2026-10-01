import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
export async function uiSmoke(){
 const require=createRequire(import.meta.url);
 const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
 const bundled=process.env.BROWSER_BUNDLE?(await import(process.env.BROWSER_BUNDLE)).default:null;
 const browser=await chromium.launch({headless:true,args:bundled?bundled.args:['--no-sandbox'],...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:bundled?{executablePath:await bundled.executablePath()}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],consoleErrors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')consoleErrors.push(e.text());});
 fs.mkdirSync('qa',{recursive:true});
 const base=process.env.UI_BASE_URL||'http://127.0.0.1:3000';
 async function confirmed(action){await action();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Transaction confirmed')||document.querySelector('#status').classList.contains('error'),null,{timeout:90000});if(await page.locator('#status').evaluate(el=>el.classList.contains('error')))throw Error(await page.locator('#status').innerText());await page.waitForFunction(()=>!document.querySelector('#connect').disabled);}
 async function go(name){if(!await page.locator(`[data-page="${name}"]`).count()){const route=['trade','token-home'].includes(name)?'/token/':name==='admin'?'/admin/':'/app/';await page.goto(new URL(route+'#'+name,base).href);await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Contract data loaded'),null,{timeout:60000});}else await page.locator(`[data-page="${name}"]`).click();}
 async function selectWallet(index){await page.locator('#local-accounts').selectOption({index});await page.waitForFunction(()=>!document.querySelector('#local-accounts').disabled&&document.querySelector('#status').textContent.includes('Wallet connected'),null,{timeout:60000});}
 const number=async selector=>Number((await page.locator(selector).innerText()).replaceAll(',',''));
 try{
  if(new URL(base).pathname==='/app/'){await page.goto(new URL('/',base).href);await page.getByRole('banner').getByRole('link',{name:'Member dashboard',exact:true}).click();assert.equal(new URL(page.url()).pathname,'/app/');for(const route of ['/app/','/token/','/admin/','/app/app.js','/token/app.js','/admin/app.js','/app/style.css','/app/favicon.svg','/app.js','/api/config','/abi/FTIToken','/vendor/ethers.js'])assert.equal((await page.request.get(new URL(route,base).href)).status(),200,route);}
  else await page.goto(base);await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Contract data loaded'),null,{timeout:60000});
  await page.screenshot({path:'qa/desktop.png',fullPage:true});
  const cfg=await page.evaluate(()=>fetch('/api/config').then(r=>r.json()));
  const reserveModel=cfg.tokenContract==='FTIReserveToken';
  if(reserveModel){await go('token-home');assert.match(await page.locator('#token-model-description').innerText(),/reserve/i);}
  // Registration is exercised through the new member panel, using an open Genesis parent.
  await selectWallet(36);await go('network');await page.locator('#register-form [name=sponsor]').fill(cfg.accounts[15]);await page.locator('#register-form [name=units]').fill('1');
  await confirmed(()=>page.locator('#register-button').click());
  assert.equal(await page.locator('#registration-title').innerText(),'Add membership units');
  assert.equal(await page.locator('#units').innerText(),'1');
  assert.ok((await page.locator('#referral-link').inputValue()).includes(cfg.accounts[36]));
  // Add units, then buy. The sale remains disabled while the purchased tranche is locked.
  await confirmed(()=>page.locator('#register-button').click());assert.equal(await page.locator('#units').innerText(),'2');
  await go('trade');await page.locator('#buy-form [name=amount]').fill('10');
  await page.waitForFunction(()=>document.querySelector('#buy-quote').textContent.includes('Minimum accepted'));
  await confirmed(()=>page.locator('#buy-form button[data-write]').click());
  assert.ok(await number('#trade-balance')>0);
  assert.equal(await number('#trade-unlocked'),0);
  assert.ok(await page.locator('#sell-form button[data-write]').isDisabled());
  assert.match(await page.locator('#trade-notice').innerText(),/locked/);
  await page.screenshot({path:'qa/trade-locked.png',fullPage:true});
  // Local-only time control. No public testnet waiting rules are bypassed.
  await go('admin');assert.ok(await page.locator('#proposal-form button').isDisabled());assert.equal(await page.locator('#admin-role').innerText(),'PUBLIC CALLER');await confirmed(()=>page.locator('[data-time="7948800"]').click());
  await go('trade');assert.ok(await number('#trade-unlocked')>0);
  const before=await number('#trade-balance');
  await page.locator('#sell-form [name=amount]').fill(reserveModel?String(before/4):'10');
  await page.waitForFunction(()=>document.querySelector('#sell-quote').textContent.includes('Net proceeds'));
  await confirmed(()=>page.locator('#sell-form button[data-write]').click());
  assert.ok(await number('#trade-balance')<before);
  await page.locator('#transfer-form [name=to]').fill(cfg.accounts[1]);await page.locator('#transfer-form [name=amount]').fill(reserveModel?String(before/10):'1');
  await confirmed(()=>page.locator('#transfer-form button').click());
  await page.locator('#max-sell').click();assert.ok(Number(await page.locator('#sell-form [name=amount]').inputValue())>0);
  // Auto-buy preference persists and reward claims update the view.
  await go('rewards');await page.locator('#auto-form [name=enabled]').check();await confirmed(()=>page.locator('#auto-form button').click());assert.equal(await page.locator('#auto-status').innerText(),'Enabled');
  await selectWallet(0);assert.ok(await number('#reward-claimable')>0);await confirmed(()=>page.locator('#claim-rewards').click());assert.equal(await number('#reward-claimable'),0);
  // The governance select must encode the intended operation for a council owner.
  await go('admin');assert.equal(await page.locator('#proposal-form select').inputValue(),'pauseBinary');
  await selectWallet(31);assert.equal(await page.locator('#admin-role').innerText(),'COUNCIL OWNER');await confirmed(()=>page.locator('#proposal-form button').click());assert.match(await page.locator('#proposals').innerText(),/Proposal 0/);
  await selectWallet(36);await go('overview');await page.screenshot({path:'qa/desktop-connected.png',fullPage:true});
  // Every page fits the phone viewport and navigation survives a reload.
  await page.setViewportSize({width:390,height:844});
  for(const name of ['overview','network','token-home','trade','rewards','activity','admin']){await go(name);if(name==='activity')await page.waitForFunction(()=>document.querySelectorAll('.event').length>0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Horizontal overflow on '+name);await page.screenshot({path:'qa/'+name+'-mobile.png',fullPage:true});}
  await go('trade');await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Contract data loaded'),null,{timeout:60000});assert.ok(await page.locator('#trade').isVisible());
  // Read failures are retryable and must not fabricate an empty transaction history.
  await page.route('**/api/events',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'RPC unavailable'})}));
  await go('activity');await page.waitForFunction(()=>document.querySelector('#events').textContent.includes('could not be loaded'));await page.unroute('**/api/events');await page.locator('#refresh-events').click();await page.waitForFunction(()=>document.querySelectorAll('.event').length>0);
  assert.deepEqual(errors,[]);
  const result={routing:new URL(base).pathname==='/app/'?'Nginx landing, /app/, /token/, /admin/ and backend asset/API routes verified':'Standalone backend',viewport:{desktop:'1440x1000',mobile:'390x844'},registration:'confirmed',addUnits:'confirmed',buy:'confirmed',lockedSale:'disabled with explanation',sell:'confirmed after local-only unlock',transfer:'confirmed',autoPreference:'saved',rewardClaim:'confirmed',governanceProposal:'public caller disabled, council role checked on-chain and proposal confirmed',navigation:'separate member/token/admin entry points, seven views, no mobile overflow, deep link reload passed',activity:'loaded; service-error and retry verified',pageErrors:errors};
  result.tokenContract=cfg.tokenContract||'FTIToken';
  fs.writeFileSync(reserveModel?'docs/reserve-ui-test-results.json':'docs/ui-test-results.json',JSON.stringify(result,null,2)+'\n');console.log('UI_SMOKE',result);
 }catch(error){await page.screenshot({path:'qa/failure.png',fullPage:true});console.error('PAGE ERRORS',errors,'CONSOLE',consoleErrors);throw error;}finally{await browser.close();}
}
