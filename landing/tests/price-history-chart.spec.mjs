import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {buildSync} from 'esbuild';
const root=new URL('../../',import.meta.url);
const bundle=buildSync({entryPoints:[new URL('../../frontend/live-market.js',import.meta.url).pathname],bundle:true,format:'esm',write:false,platform:'browser',external:['/vendor/ethers.js']}).outputFiles[0].text;
const styles=fs.readFileSync(new URL('../../frontend/global-interface.css',import.meta.url),'utf8');
async function fixture(page,{language='en',cycle=1,archiveFailure=false}={}){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/__price-chart.html*',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{color-scheme:dark;--muted:#b9cabd;--accent:#c4fa81;--line:#294530}body{margin:0;padding:12px;background:#0c1710;color:white;font:14px/1.5 Arial,sans-serif}button{color:inherit;background:#193021;border:1px solid #56775d;padding:8px;border-radius:8px}#fixture{max-width:800px;margin:auto}table{width:100%;text-align:start;border-collapse:collapse}th,td{padding:8px}details{margin:12px 0}.market-axis-labels>div{min-width:0}.market-axis-labels strong{display:block;overflow-wrap:anywhere}</style><link rel="stylesheet" href="/__price-style.css"></head><body><section id="fixture"><div data-live-market></div></section><script type="module" src="/__price-chart.js"></script></body></html>`}));
 await page.route('**/__price-style.css',route=>route.fulfill({contentType:'text/css',body:styles}));
 const setup=`
 const H=n=>'0x'+Number(n).toString(16).padStart(64,'0'),A='0x'+'a'.repeat(40),base=Math.floor(Date.now()/1000)-10000;
 const cfg={chainId:56,mode:'bnb-mainnet',release:'FTI_CONTINUITY_MAINNET_20261013',tokenContract:'FTIReserveTokenUpgradeable',binaryContract:'FundedBinaryPlanUpgradeable',token:A,deployedBlock:1,receipts:{token:{blockNumber:2,transactionHash:H(9),blockHash:H(2)}}};
 window.__priceReads=[];window.__priceArchiveFailure=${archiveFailure};
 const rpc={getNetwork:async()=>({chainId:56n}),getBlock:async n=>{const number=n==='latest'?100:n;return {number,hash:H(number),timestamp:base+number*100};},getTransactionReceipt:async()=>({status:1,blockNumber:2,blockHash:H(2),hash:H(9),contractAddress:A})};
 const token={target:A,price:async at=>{window.__priceReads.push(at.blockTag);if(window.__priceArchiveFailure&&at.blockTag<90)throw Error('Archive unavailable');return at.blockTag===2?0n:100000000000000000n+BigInt(at.blockTag-2)*60000000000000n;},totalSupply:async at=>at.blockTag===2?0n:1000000000000000000000n,cycle:async()=>${cycle}n,INITIAL_PRICE:async()=>100000000000000000n,cycleStartPrice:async()=>${cycle===1?'100000000000000000':'200000000000000000'}n,reserve:async()=>106000000000000000000n,supportReserve:async()=>5000000000000000000n};
 window.__priceStop=initLiveMarket(token,rpc,cfg);
 `;
 await page.route('**/__price-chart.js',route=>route.fulfill({contentType:'text/javascript',body:bundle+'\n'+setup}));
 await page.route('**/api/market',route=>route.fulfill({json:{fromBlock:1,toBlock:100,trades:[]}}));
 await page.goto('/__price-chart.html?lang='+language);
 await expect(page.locator('.market-price')).not.toHaveText('—');
 await expect(page.locator('.market-note').filter({hasText:language==='fa'?'نمونه‌های تأییدشده اخیر':'Recent verified price samples'})).toBeVisible();
 return errors;
}
for(const language of ['en','fa'])test(`mobile ${language} shows real price and date/time without hover, and touch selects the0.10 opening reference`,async({page})=>{
 await page.setViewportSize({width:390,height:844});const errors=await fixture(page,{language});
 await expect(page.locator('.market-opening-quote')).toContainText(language==='fa'?'نرخ آغازین':'Initial contract quote');
 await expect(page.locator('.market-axis-labels')).toBeVisible();
 await expect(page.locator('.market-axis-labels')).toContainText('UTC');
 await expect(page.locator('.market-axis-labels').locator('strong')).toHaveCount(3);
 for(const label of await page.locator('.market-axis-labels strong').all())await expect(label).toBeVisible();
 const chart=page.locator('.market-chart');await chart.focus();await page.keyboard.press('Home');
 await expect(page.locator('.candle-readout')).toContainText(language==='fa'?'نرخ آغازین قرارداد':'Initial contract quote');
 await expect(page.locator('.market-chart .price-opening-reference')).toHaveCount(1);
 await page.keyboard.press('End');await expect(page.locator('.candle-readout')).toContainText(language==='fa'?'قیمت مشاهده‌شده':'Observed contract price');
 const rect=await chart.boundingBox();await chart.dispatchEvent('pointerdown',{clientX:rect.x+rect.width*.07,clientY:rect.y+rect.height*.8,pointerType:'touch'});
 await expect(page.locator('.candle-readout')).toContainText(language==='fa'?'نرخ آغازین قرارداد':'Initial contract quote');
 await page.locator('.market-price-history summary').click();await expect(page.locator('.market-price-table')).toBeVisible();await expect(page.locator('.market-price-table')).toContainText('UTC');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);expect(errors).toEqual([]);
});
test('earlier prices use bounded explicit history load and preserve a verified opening reference on archive error',async({page})=>{
 await page.setViewportSize({width:390,height:844});const errors=await fixture(page);
 await expect(page.locator('.market-opening-quote')).toBeVisible();
 await page.evaluate(()=>{window.__priceReads=[];window.__priceArchiveFailure=true;});
 await page.getByRole('button',{name:'Load earlier prices',exact:true}).click();
 await expect(page.locator('.market-note').filter({hasText:'Historical samples unavailable'})).toBeVisible();
 await expect(page.locator('.market-opening-quote')).toBeVisible();await expect(page.locator('.market-price')).not.toHaveText('—');
 expect((await page.evaluate(()=>window.__priceReads)).length).toBeLessThanOrEqual(2);expect(errors).toEqual([]);
});
test('later cycles do not attach the original0.10 reference to a different cycle',async({page})=>{
 const errors=await fixture(page,{cycle:2});await expect(page.locator('.market-opening-quote')).toBeHidden();await expect(page.locator('.price-opening-reference')).toHaveCount(0);expect(errors).toEqual([]);
});
