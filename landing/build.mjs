import {build} from 'esbuild';
import fs from 'node:fs';
fs.rmSync('dist',{recursive:true,force:true});fs.mkdirSync('dist',{recursive:true});
fs.cpSync('public','dist',{recursive:true});
await build({entryPoints:['src/main.jsx'],bundle:true,minify:true,outdir:'dist',entryNames:'app',loader:{'.jsx':'jsx'},define:{'process.env.NODE_ENV':'"production"','__FTI_APP_URL__':JSON.stringify(process.env.FTI_APP_URL||'')},target:['es2020']});
