import {build} from 'esbuild';
await build({entryPoints:['frontend/main.jsx'],bundle:true,format:'esm',target:'es2022',outfile:'web/app.js',external:['/vendor/ethers.js'],minify:true,define:{'process.env.NODE_ENV':'"production"'},legalComments:'linked'});
console.log('React workspace built: web/app.js');
