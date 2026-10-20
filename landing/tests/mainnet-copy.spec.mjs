import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {expectReadFailure} from './read-failure.mjs';
const cfg=JSON.parse(fs.readFileSync(new URL('../../deployments/mainnet-20261016.json',import.meta.url)));
const copy={ar:['تستخدم المعاملات أصولاً حقيقية.','العضوية','تكلفة كل وحدة 100 USD'],tr:['İşlemler gerçek varlıklarla yapılır.','Üyelik','Her birim, seçili teminat'], 'zh-CN':['交易使用真实资产。','会员','每个单位需支付价值 100 USD']};
for(const [lang,[notice,membership,intro]] of Object.entries(copy))test(`mainnet copy after config hydration: ${lang}`,async({page})=>{
 await page.route('**/abi/*',r=>{const name=new URL(r.request().url()).pathname.split('/').pop();const artifact=JSON.parse(fs.readFileSync(new URL('../../artifacts/'+(name==='Collateral'?'MockUSD':name)+'.json',import.meta.url)));return r.fulfill({json:artifact.abi});});
 await page.route('**/api/config',r=>r.fulfill({json:cfg}));
 await page.route('**/api/state',r=>r.fulfill({status:503,json:{error:'Read-only fixture'}}));
 await page.goto('/app/?lang='+lang);
 await expect(page.getByText(notice,{exact:false})).toBeVisible();
 await expectReadFailure(page,lang);
 await page.getByRole('button',{name:membership,exact:true}).click();
 await expect(page.getByText(intro,{exact:false})).toBeVisible();
 const text=await page.locator('body').innerText();
 for(const key of ['Collateral balance','Transactions use real assets.','Each unit costs 100 USD','Direct inviter','Binary parent'])expect(text).not.toContain(key);
});
