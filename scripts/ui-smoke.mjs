import {createRequire} from 'node:module';import fs from 'node:fs';
export async function uiSmoke(){
 const require=createRequire(import.meta.url);const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');const bundled=process.env.BROWSER_BUNDLE?(await import(process.env.BROWSER_BUNDLE)).default:null;const browser=await chromium.launch({headless:true,args:bundled?bundled.args:['--no-sandbox'],...(bundled?{executablePath:process.env.BROWSER_EXECUTABLE||await bundled.executablePath()}: {})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));fs.mkdirSync('qa',{recursive:true});
 try{
 await page.goto('http://127.0.0.1:3000');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Contract data loaded'),null,{timeout:60000});await page.screenshot({path:'qa/desktop.png',fullPage:true});
 await page.locator('[data-page="trade"]').click();await page.locator('#buy-form [name="amount"]').fill('10');await page.locator('#buy-form button').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Transaction confirmed')||document.querySelector('#status').classList.contains('error'),null,{timeout:60000});
 if(await page.locator('#status').evaluate(e=>e.classList.contains('error')))throw Error(await page.locator('#status').innerText());
 await page.locator('[data-page="overview"]').click();const balance=await page.locator('#fti-balance').innerText();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'qa/mobile.png',fullPage:true});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)throw Error('Mobile overflow');
 await page.locator('[data-page="network"]').click();await page.screenshot({path:'qa/network-mobile.png',fullPage:true});
 await page.locator('[data-page="admin"]').click();await page.screenshot({path:'qa/admin-mobile.png',fullPage:true});
 await page.locator('[data-page="activity"]').click();await page.waitForFunction(()=>document.querySelectorAll('.event').length>0);if(errors.length)throw Error(errors.join('\n'));
 const result={desktop:'1440x1000',mobile:'390x844',buyTransaction:'confirmed on local EVM',ftiBalance:balance,horizontalOverflow:overflow,pageErrors:errors,events:'loaded from chain'};fs.writeFileSync('docs/ui-test-results.json',JSON.stringify(result,null,2));console.log('UI_SMOKE',result);
 }catch(e){await page.screenshot({path:'qa/failure.png',fullPage:true});console.error('PAGE ERRORS',errors);throw e;}finally{await browser.close();}
}
