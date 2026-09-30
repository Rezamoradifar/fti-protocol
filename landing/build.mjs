import {build} from 'esbuild';
import fs from 'node:fs';
fs.rmSync('dist',{recursive:true,force:true});fs.mkdirSync('dist',{recursive:true});
fs.cpSync('public','dist',{recursive:true});
await build({entryPoints:['src/main.jsx'],bundle:true,minify:true,outdir:'dist',entryNames:'app',loader:{'.jsx':'jsx'},define:{'process.env.NODE_ENV':'"production"'},target:['es2020']});
