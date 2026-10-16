#!/usr/bin/env node
// Creates a new static operator directory. Never signs, broadcasts or changes Nginx.
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {FetchRequest,JsonRpcProvider} from 'ethers';
import {prepareMainnet,mainnetPayloads,assertPinnedMainnetCheckout} from '../../scripts/prepare-mainnet.mjs';
import {mainnetRpcUrl} from '../../scripts/mainnet-rpc.mjs';
import {assertApprovedMainnetProfile} from '../../scripts/approved-mainnet-profile.mjs';
import {assertSelectedMainnetCollateral} from '../../scripts/mainnet-collateral.mjs';
import {assertSelectedMainnetCouncil} from '../../scripts/mainnet-council.mjs';
import {freshDigest} from '../../scripts/fresh-testnet.mjs';
import {releaseManifest} from '../../scripts/continuity-release.mjs';
import {validatePlan} from './session.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const check=(ok,msg)=>{if(!ok)throw Error(msg)};
export async function buildOperator(plan,out){
 validatePlan(plan,plan.digest);
 assertSelectedMainnetCouncil(assertSelectedMainnetCollateral(assertApprovedMainnetProfile(plan.input)));
 check(freshDigest(plan.manifest)===freshDigest(releaseManifest()),'Plan belongs to a different source/build');
 const expected=await mainnetPayloads(plan.input,plan.nonce);
 for(const key of ['transactions','addresses','constructorArgs'])check(freshDigest(expected[key])===freshDigest(plan[key]),'Plan payload differs from this build');
 const parent=fs.realpathSync(path.dirname(path.resolve(out))),root=fs.realpathSync(process.cwd());
 check(parent!==root&&!parent.startsWith(root+path.sep),'Output must be outside the source checkout');
 fs.mkdirSync(out,{mode:0o755});
 fs.writeFileSync(path.join(out,'plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o644});
 await build({entryPoints:[path.join(here,'client.mjs')],outfile:path.join(out,'operator.js'),bundle:true,format:'esm',target:'es2022',minify:true,legalComments:'none'});
 fs.chmodSync(path.join(out,'operator.js'),0o644);
 fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta name="fti-plan-digest" content="${plan.digest}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'"><title>FTI · امضای دیپلوی شبکه اصلی</title><style>body{margin:auto;max-width:850px;padding:22px;background:#10182a;color:#edf3ff;font:16px/1.8 sans-serif}h1{font-size:24px}pre{direction:ltr;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere;background:#19243b;padding:16px;border-radius:12px;font-size:12px}label{display:block;margin:15px 0}input{display:block;box-sizing:border-box;width:100%;padding:12px;direction:ltr;font-size:16px}button{padding:13px;margin:6px 0 6px 10px;font:inherit;border:0;border-radius:8px;background:#62dabf;color:#071715}button:disabled{opacity:.45}#status{border:1px solid #8bacc8;padding:14px;overflow-wrap:anywhere}details{margin:22px 0}small{color:#c4d3e9}</style></head><body><h1>FTI · امضای دیپلوی شبکه اصلی</h1><p>۷ تراکنش، شبکه BNB با شناسه ۵۶. هر مرحله نیازمند کلیک و تأیید مستقل شما در متامسک است. کلید خصوصی یا عبارت بازیابی اینجا وارد نمی‌شود.</p><p>این صفحه تأیید آمادگی انتشار نیست. پیش از ارسال، تست‌های نهایی و تمرین عمومی همان نسخه باید بررسی شده باشند. بعد از ارسال، سایت و Keeper خودکار فعال نمی‌شوند.</p><pre id="summary"></pre><label>digest چاپ‌شده در ترمینال سرور<input id="digest" autocomplete="off" spellcheck="false"></label><label>حداکثر مجموع هزینهٔ گس (BNB)<input id="budget" inputmode="decimal" placeholder="مثلاً 0.01"></label><label>سقف قیمت گس هر تراکنش (gwei)<input id="ceiling" inputmode="decimal" placeholder="مثلاً 0.1"></label><small>مقادیر را آگاهانه تعیین کنید. افزایش دستی هزینه در متامسک می‌تواند سقف انتخابی صفحه را تغییر دهد. حساب متامسک فقط باید ولت دیپلوی‌کنندهٔ بالا باشد.</small><div><button id="connect">اتصال متامسک و کنترل حساب</button><button id="send" disabled>بررسی و امضای فقط مرحلهٔ بعد</button><button id="check">بررسی رسید و ۱۲ تأیید</button><button id="export" disabled>ذخیرهٔ هش ۷ تراکنش</button></div><p id="status" role="status" aria-live="polite">در حال خواندن برنامه…</p><p>بعد از ارسال نامشخص، خطا یا بسته‌شدن متامسک، دوباره ارسال نکنید. سابقهٔ همین مرورگر را پاک نکنید. لغو صریح در متامسک قابل تکرار است؛ ارسال نامشخص نیاز به بررسی nonce و اکسپلورر دارد.</p><pre id="journal"></pre><details><summary>مشاهدهٔ کامل payloadهای امضانشده</summary><pre id="payloads"></pre></details><script type="module" src="./operator.js"></script></body></html>`,{flag:'wx',mode:0o644});
}
export async function main(args=process.argv.slice(2)){
 const {values:v}=parseArgs({args,strict:true,options:{out:{type:'string'},help:{type:'boolean'}}});
 if(v.help){console.log('READ ONLY: FTI_MAINNET_RPC_FILE=/PRIVATE/getblock.rpc node tools/mainnet-metamask/build.mjs --out NEW_PUBLIC_DIRECTORY\nCreates a fresh reviewed plan and local-only JS bundle for HTTPS hosting. No keys, signing, broadcasting or Nginx changes.');return}
 check(v.out,'New output directory required');assertPinnedMainnetCheckout();
 const input=JSON.parse(fs.readFileSync('config/mainnet-approved-input.REQUIRED.json'));
 assertSelectedMainnetCouncil(assertSelectedMainnetCollateral(assertApprovedMainnetProfile(input)));
 const request=new FetchRequest(mainnetRpcUrl());request.timeout=15000;
 const provider=new JsonRpcProvider(request,undefined,{cacheTimeout:-1,batchMaxCount:1});
 try{const plan=await prepareMainnet({provider,input});await buildOperator(plan,v.out);
 console.log(JSON.stringify({result:'FTI_METAMASK_PAGE_BUILT',sourceRevision:plan.manifest.sourceRevision,digest:plan.digest,deployer:plan.input.deployer,balanceWei:plan.deployerBalanceWei,nonce:plan.nonce,out:path.resolve(v.out),submitted:false,readyToBroadcast:false}));
 }finally{provider.destroy()}
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(()=>{console.error('FTI_METAMASK_BUILD_FAILED: check pinned build, private RPC and new output directory. No transactions submitted.');process.exitCode=1});
