import {build} from 'esbuild';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),dist=path.join(dir,'dist');
if(fs.realpathSync(dir)==='/opt/fti-protocol/landing')throw new Error('Build in an isolated checkout, never inside the live docroot');
fs.rmSync(dist,{recursive:true,force:true});fs.mkdirSync(dist,{recursive:true});
const result=await build({absWorkingDir:dir,entryPoints:['src/main.jsx','src/public-entry.jsx'],bundle:true,minify:true,outdir:dist,entryNames:'assets/[name]-[hash]',assetNames:'assets/[name]-[hash]',publicPath:'/',metafile:true,define:{'process.env.NODE_ENV':'"production"','__FTI_APP_URL__':JSON.stringify(process.env.FTI_APP_URL||'/app/')},target:['es2020'],loader:{'.woff2':'file','.webp':'file'},alias:{react:path.join(dir,'node_modules/react'),'react-dom':path.join(dir,'node_modules/react-dom')}});
const roots=new Set(Object.keys(result.metafile.inputs).map(x=>path.resolve(dir,x).replaceAll('\\','/')).filter(x=>x.includes('/node_modules/react/')).map(x=>x.split('/node_modules/react/')[0]));
if(roots.size!==1)throw new Error('Expected exactly one React runtime');
const url=x=>'/'+path.relative(dist,path.resolve(dir,x)).split(path.sep).join('/');
const template=fs.readFileSync(path.join(dir,'public/index.html'),'utf8');
const htmlFiles=[];
for(const [route,entry]of [['','src/main.jsx'],['token-site','src/public-entry.jsx'],['whitepaper','src/public-entry.jsx'],['roadmap','src/public-entry.jsx']]){
 const [js,meta]=Object.entries(result.metafile.outputs).find(([,meta])=>meta.entryPoint===entry&&meta.cssBundle)||[];
 if(!js||!meta?.cssBundle)throw new Error('Missing JS/CSS for '+entry);
 const html=template.replace('__APP_JS__',url(js)).replace('__APP_CSS__',url(meta.cssBundle));
 const name=route?route+'/index.html':'index.html';fs.mkdirSync(path.dirname(path.join(dist,name)),{recursive:true});
 fs.writeFileSync(path.join(dist,name),html);htmlFiles.push(name);
}
const files=Object.fromEntries([...htmlFiles,...Object.keys(result.metafile.outputs).map(x=>path.relative(dist,path.resolve(dir,x)))].map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(dist,name))).digest('hex')]));
fs.writeFileSync(path.join(dist,'release.json'),JSON.stringify({files},null,2)+'\n');
console.log('PASS: isolated React runtime; hashed JS/CSS; landing and three public document routes built.');
