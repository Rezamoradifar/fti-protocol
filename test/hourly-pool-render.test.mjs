import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import path from 'node:path';
let render;
before(async()=>{
 const result=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {HourlyPool} from './landing/src/hourly-pool.jsx';export const render=props=>renderToStaticMarkup(React.createElement(HourlyPool,props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,
  alias:{react:path.resolve('landing/node_modules/react'),'react-dom':path.resolve('landing/node_modules/react-dom')},
  define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'css-for-static-render',setup(b){b.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'}));}}]});
 const module={exports:{}};new Function('module','exports','require',result.outputFiles[0].text)(module,module.exports,createRequire(import.meta.url));render=module.exports.render;
});
test('public hourly cards render in Persian and English without fabricated balances or point prices',()=>{
 const fa=render({lang:'fa',configLoading:true}),en=render({lang:'en',configLoading:true});
 for(const label of ['موجودی استخر ساعتی','پوینت‌های واجد شرایط ساعت','ارزش هر پوینت ساعت'])assert(fa.includes(label));
 assert(en.includes('Value per hourly point'));assert(fa.includes('USDT'));assert(fa.includes('—'));
 assert(!/NaN|undefined|Infinity/.test(fa+en));assert.match(fa,/aria-busy="true"/);
});
test('configuration failures show an error and an enabled retry instead of permanent loading',()=>{
 const html=render({lang:'fa',configError:true,onRetryConfig:()=>{}});
 assert.match(html,/data-state="unavailable"/);assert(html.includes('اتصال شبکه برقرار نشد'));
 const refresh=html.match(/<button[^>]*class="[^"]*hourly-pool-refresh[^>]*>/)?.[0];assert(refresh);assert(!refresh.includes('disabled'));
 assert(!html.includes('در حال دریافت اطلاعات استخر'));
});
