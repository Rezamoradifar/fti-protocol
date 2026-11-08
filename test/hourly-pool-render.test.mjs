import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import path from 'node:path';
const render={};
before(async()=>{
 const result=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server.edge';import {HourlyPool} from './landing/src/hourly-pool.jsx';export const render=props=>renderToStaticMarkup(React.createElement(HourlyPool,props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'browser',format:'esm',write:false,
  alias:{react:path.resolve('landing/node_modules/react'),'react-dom':path.resolve('landing/node_modules/react-dom')},
  define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'css-for-static-render',setup(b){b.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'}));}}]});
 // Each visit selects its language before loading the optional catalog. Use
 // separate ESM module instances so this test follows the same boot path as
 // the browser, including top-level await and English's no-catalog path.
 const previousLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
 const previousStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 try{
  Object.defineProperty(globalThis,'localStorage',{value:{getItem:()=>null},configurable:true});
  for(const lang of ['en','fa']){
   Object.defineProperty(globalThis,'location',{value:{href:'https://ftiprotocol.com/?lang='+lang},configurable:true});
   const code=result.outputFiles[0].text+'\n// visit '+lang;
   render[lang]=(await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).render;
  }
 }finally{
  for(const [key,descriptor] of [['location',previousLocation],['localStorage',previousStorage]]){
   if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }
 }
});
test('public hourly cards render in Persian and English without fabricated balances or point prices',()=>{
 const fa=render.fa({lang:'fa',configLoading:true}),en=render.en({lang:'en',configLoading:true});
 for(const label of ['موجودی استخر ساعتی','پوینت‌های واجد شرایط ساعت','ارزش هر پوینت ساعت'])assert(fa.includes(label));
 assert(en.includes('Value per hourly point'));assert(fa.includes('USDT'));assert(fa.includes('—'));
 assert(!/NaN|undefined|Infinity/.test(fa+en));assert.match(fa,/aria-busy="true"/);
});
test('configuration failures show an error and an enabled retry instead of permanent loading',()=>{
 const html=render.fa({lang:'fa',configError:true,onRetryConfig:()=>{}});
 assert.match(html,/data-state="unavailable"/);assert(html.includes('اتصال شبکه برقرار نشد'));
 const refresh=html.match(/<button[^>]*class="[^"]*hourly-pool-refresh[^>]*>/)?.[0];assert(refresh);assert(!refresh.includes('disabled'));
 assert(!html.includes('در حال دریافت اطلاعات استخر'));
});
