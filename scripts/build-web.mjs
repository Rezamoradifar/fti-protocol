import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {gzipSync,brotliCompressSync,constants as zlibConstants} from 'node:zlib';
await build({entryPoints:['frontend/boot-guard.js'],bundle:true,format:'iife',target:'es2018',outfile:'web/boot-guard.js',minify:true});
await build({entryPoints:['frontend/main.jsx'],bundle:true,format:'esm',target:'es2022',outfile:'web/app.js',plugins:[{name:'versioned-wallet-dependencies',setup(b){b.onResolve({filter:/^\/vendor\/(ethers|walletconnect)\.js$/},a=>({path:'.'+a.path,external:true}));}}],minify:true,define:{'process.env.NODE_ENV':'"production"'},legalComments:'linked'});
await build({entryPoints:['frontend/walletconnect.js'],bundle:true,format:'esm',target:'es2022',outfile:'web/vendor/walletconnect.js',nodePaths:process.env.FTI_WALLET_SDK_MODULES?[process.env.FTI_WALLET_SDK_MODULES]:[],minify:true,define:{'process.env.NODE_ENV':'"production"','global':'globalThis'},legalComments:'linked'});
await build({entryPoints:['frontend/member-landing-theme.css'],outfile:'web/member-landing-theme.css',bundle:true,minify:true,target:'es2022'});
console.log('React workspace built: web/app.js; member landing theme built locally.');

await build({entryPoints:['frontend/global-interface.css'],bundle:true,minify:true,outfile:'web/global-interface.css'});

await build({entryPoints:['frontend/panel-identity.css'],bundle:true,minify:true,outfile:'web/panel-identity.css',loader:{'.woff2':'file'},assetNames:'fonts/[name]-[hash]'});

await build({entryPoints:['frontend/member-reserve-panel.css'],bundle:true,minify:true,outfile:'web/member-reserve-panel.css',loader:{'.webp':'file'},assetNames:'assets/[name]-[hash]'});

await fs.copyFile('node_modules/ethers/dist/ethers.min.js','web/vendor/ethers.js');

// The launcher stays small; the service UI is a separate click-loaded module.
await build({entryPoints:['frontend/customer-widget.js'],bundle:true,format:'esm',splitting:true,target:'es2022',outdir:'web',chunkNames:'customer-chunk-[hash]',minify:true,legalComments:'linked'});
async function compress(directory){
 for(const entry of await fs.readdir(directory,{withFileTypes:true})){
  const file=path.join(directory,entry.name);
  if(entry.isDirectory())await compress(file);
  else if(entry.isFile()&&/\.(?:js|css|html|svg)$/.test(entry.name)){
   const bytes=await fs.readFile(file);
   await fs.writeFile(file+'.gz',gzipSync(bytes,{level:9}));
   await fs.writeFile(file+'.br',brotliCompressSync(bytes,{params:{[zlibConstants.BROTLI_PARAM_QUALITY]:6}}));
  }
 }
}
await compress('web');
console.log('Support launcher built; web assets have gzip and Brotli variants.');
