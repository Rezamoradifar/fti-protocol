import {build} from 'esbuild';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync,brotliCompressSync,constants as zlibConstants} from 'node:zlib';
const dir=path.dirname(fileURLToPath(import.meta.url)),dist=path.join(dir,'dist');
if(fs.realpathSync(dir)==='/opt/fti-protocol/landing')throw new Error('Build in an isolated checkout, never inside the live docroot');
fs.rmSync(dist,{recursive:true,force:true});fs.mkdirSync(dist,{recursive:true});
const entries=['src/main.jsx','src/public-entry.jsx'];
entries.push('../frontend/customer-widget.js');
if(fs.existsSync(path.join(dir,'src/services-entry.jsx')))entries.push('src/services-entry.jsx');
const result=await build({absWorkingDir:dir,entryPoints:entries,bundle:true,minify:true,format:'esm',splitting:true,outdir:dist,entryNames:'assets/[name]-[hash]',chunkNames:'assets/chunk-[hash]',assetNames:'assets/[name]-[hash]',publicPath:'/',metafile:true,define:{'process.env.NODE_ENV':'"production"','__FTI_APP_URL__':JSON.stringify(process.env.FTI_APP_URL||'/app/')},target:['es2022'],loader:{'.woff2':'file','.webp':'file','.jpg':'file'},alias:{react:path.join(dir,'node_modules/react'),'react-dom':path.join(dir,'node_modules/react-dom')}});
const roots=new Set(Object.keys(result.metafile.inputs).map(x=>path.resolve(dir,x).replaceAll('\\','/')).filter(x=>x.includes('/node_modules/react/')).map(x=>x.split('/node_modules/react/')[0]));
if(roots.size!==1)throw new Error('Expected exactly one React runtime');
const url=x=>'/'+path.relative(dist,path.resolve(dir,x)).split(path.sep).join('/');
const template=fs.readFileSync(path.join(dir,'public/index.html'),'utf8');
const boot=fs.readFileSync(path.join(dir,'public/boot.css'));
const bootName='assets/boot-'+createHash('sha256').update(boot).digest('hex').slice(0,16)+'.css';
fs.writeFileSync(path.join(dist,bootName),boot);
const htmlFiles=[bootName];
const routes=[['','src/main.jsx'],['token-site','src/public-entry.jsx'],['whitepaper','src/public-entry.jsx'],['roadmap','src/public-entry.jsx']];
const [widgetJs,widgetMeta]=Object.entries(result.metafile.outputs).find(([,meta])=>meta.entryPoint==='../frontend/customer-widget.js')||[];
if(!widgetJs||!widgetMeta?.cssBundle)throw new Error('Missing support widget build');
if(entries.includes('src/services-entry.jsx'))routes.push(['support','src/services-entry.jsx'],['vpn','src/services-entry.jsx']);
for(const [route,entry]of routes){
 const [js,meta]=Object.entries(result.metafile.outputs).find(([,meta])=>meta.entryPoint===entry&&meta.cssBundle)||[];
 if(!js||!meta?.cssBundle)throw new Error('Missing JS/CSS for '+entry);
 let html=template.replace('__BOOT_CSS__','/'+bootName).replace('__APP_JS__',url(js)).replace('__APP_CSS__',url(meta.cssBundle));
 const preloads=meta.imports.filter(item=>item.kind==='import-statement'&&!item.external).map(item=>'<link rel="modulepreload" href="'+url(item.path)+'">').join('');
 html=html.replace('</head>',preloads+'</head>');
 if(!['support','vpn'].includes(route)){
  html=html.replace('</head>','<link rel="stylesheet" href="'+url(widgetMeta.cssBundle)+'" data-fti-customer-style></head>');
  html=html.replace('</body>','<script type="module" src="'+url(widgetJs)+'" data-fti-customer-entry></script></body>');
 }
 if(['support','vpn'].includes(route))html=html.replace('<title>FTI Protocol — A new perspective on digital value</title>','<title>'+(route==='vpn'?'NodeShield VPN':'Support')+' · FTI Protocol</title>');
 const name=route?route+'/index.html':'index.html';fs.mkdirSync(path.dirname(path.join(dist,name)),{recursive:true});
 fs.writeFileSync(path.join(dist,name),html);htmlFiles.push(name);
}
const names=[...htmlFiles,...Object.keys(result.metafile.outputs).map(x=>path.relative(dist,path.resolve(dir,x)))];
for(const name of [...names])if(/\.(?:js|css|html)$/.test(name)){
 const data=fs.readFileSync(path.join(dist,name));
 for(const [extension,encoded]of [['gz',gzipSync(data,{level:9})],['br',brotliCompressSync(data,{params:{[zlibConstants.BROTLI_PARAM_QUALITY]:6}})]]){
  fs.writeFileSync(path.join(dist,name+'.'+extension),encoded);names.push(name+'.'+extension);
 }
}
const files=Object.fromEntries(names.map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(dist,name))).digest('hex')]));
fs.writeFileSync(path.join(dist,'release.json'),JSON.stringify({files},null,2)+'\n');
const entry=Object.entries(result.metafile.outputs).find(([,meta])=>meta.entryPoint==='src/main.jsx');
const initial=new Set();
function collect(file){if(initial.has(file))return;initial.add(file);for(const item of result.metafile.outputs[file]?.imports||[])if(item.kind==='import-statement'&&!item.external)collect(item.path)}
collect(entry[0]);
collect(widgetJs);
const performance={initialJavaScriptBytes:[...initial].reduce((sum,file)=>sum+(result.metafile.outputs[file]?.bytes||0),0),initialJavaScriptGzipBytes:[...initial].reduce((sum,file)=>sum+fs.statSync(path.resolve(dir,file)+'.gz').size,0),initialCssBytes:result.metafile.outputs[entry[1].cssBundle].bytes+result.metafile.outputs[widgetMeta.cssBundle].bytes,initialModules:initial.size};
fs.writeFileSync(path.join(dir,'build-performance.json'),JSON.stringify(performance,null,2)+'\n');
console.log('PASS: isolated React runtime; split and compressed assets; '+routes.length+' public routes built. '+JSON.stringify(performance));
