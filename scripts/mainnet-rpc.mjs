// Resolve a private mainnet RPC without logging or publishing its endpoint.
import fs from 'node:fs';
export function mainnetRpcUrl(env=process.env){
 if(env.FTI_MAINNET_RPC_URL&&env.FTI_MAINNET_RPC_FILE)throw Error('Choose one explicit mainnet RPC source');
 let rpc=env.FTI_MAINNET_RPC_URL;
 if(env.FTI_MAINNET_RPC_FILE){
  const fd=fs.openSync(env.FTI_MAINNET_RPC_FILE,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{const stat=fs.fstatSync(fd);if(!stat.isFile()||(stat.mode&0o077)!==0||stat.size>4096)throw Error('Mainnet RPC file must be a small private regular file');rpc=fs.readFileSync(fd,'utf8').trim();if(!rpc)throw Error('Empty mainnet RPC file')}finally{fs.closeSync(fd)}
 }
 rpc=rpc||env.RPC_URL;
 if(!rpc)throw Error('Explicit secure mainnet RPC URL/file required');
 let url;try{url=new URL(rpc)}catch{throw Error('Invalid mainnet RPC configuration')}
 if(url.username||url.password||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error('Mainnet RPC requires HTTPS or an explicit local RPC gateway');
 return url.href;
}
export function operationalRpcUrl(cfg,env=process.env){
 return cfg.chainId===56?mainnetRpcUrl(env):env.RPC_URL||cfg.rpcUrl;
}
