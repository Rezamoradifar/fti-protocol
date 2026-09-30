// Read-only: no signer, no deployment and no transactions.
import fs from 'node:fs';
import {JsonRpcProvider,Contract,FetchRequest} from 'ethers';
const d=JSON.parse(fs.readFileSync('deployments/testnet.json'));
const request=new FetchRequest(process.env.RPC_URL||'https://bsc-testnet.bnbchain.org');request.timeout=15000;
const p=new JsonRpcProvider(request,undefined,{batchMaxCount:1,cacheTimeout:-1});
try{
 if(d.chainId!==97||(await p.getNetwork()).chainId!==97n)throw Error('Wrong network');
 for(const key of ['usd','token','binary','council','timelock'])if((await p.getCode(d[key]))==='0x')throw Error('Missing contract: '+key);
 const token=new Contract(d.token,['function binary() view returns(address)'],p);
 if((await token.binary()).toLowerCase()!==d.binary.toLowerCase())throw Error('Wrong token/binary binding');
 console.log('PASS: same testnet contracts exist and token binding is correct.');
}finally{p.destroy();}
