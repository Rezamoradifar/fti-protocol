import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const sharedModules=fileURLToPath(new URL('../node_modules/',import.meta.url));
const reactPath=path.join(sharedModules,'react');
const reactDomClientPath=path.join(sharedModules,'react-dom','client.js');
if(!fs.existsSync(reactPath)||!fs.existsSync(reactDomClientPath)){
 throw new Error('Install the repository root dependencies before building the landing page.');
}

fs.rmSync('dist',{recursive:true,force:true});
fs.mkdirSync('dist',{recursive:true});
fs.cpSync('public','dist',{recursive:true});
const result=await build({
 entryPoints:['src/main.jsx'],
 bundle:true,
 minify:true,
 outdir:'dist',
 entryNames:'app',
 loader:{'.jsx':'jsx'},
 define:{'process.env.NODE_ENV':'"production"','__FTI_APP_URL__':JSON.stringify(process.env.FTI_APP_URL||'')},
 target:['es2020'],
 alias:{react:reactPath,'react-dom/client':reactDomClientPath},
 metafile:true
});
const reactRoots=new Set(Object.keys(result.metafile.inputs)
 .map(file=>file.replaceAll('\\','/'))
 .filter(file=>file.includes('/node_modules/react/'))
 .map(file=>file.split('/node_modules/react/')[0]));
if(reactRoots.size!==1){
 throw new Error(`Expected one React module root in the landing bundle; found ${reactRoots.size}.`);
}
console.log('Landing bundle built with a single shared React runtime.');
