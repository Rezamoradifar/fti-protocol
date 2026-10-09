import {build} from 'esbuild';
await build({entryPoints:['frontend/main.jsx'],bundle:true,format:'esm',target:'es2022',outfile:'web/app.js',external:['/vendor/ethers.js','/vendor/walletconnect.js'],minify:true,define:{'process.env.NODE_ENV':'"production"'},legalComments:'linked'});
await build({entryPoints:['frontend/walletconnect.js'],bundle:true,format:'esm',target:'es2022',outfile:'web/vendor/walletconnect.js',nodePaths:process.env.FTI_WALLET_SDK_MODULES?[process.env.FTI_WALLET_SDK_MODULES]:[],minify:true,define:{'process.env.NODE_ENV':'"production"','global':'globalThis'},legalComments:'linked'});
console.log('React workspace built: web/app.js');
