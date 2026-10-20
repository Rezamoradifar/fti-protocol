#!/usr/bin/env python3
"""Read existing Keeper address and mainnet gas balance; never start or sign."""
import importlib.util
import json
import os
from pathlib import Path
import pwd
import sys

spec = importlib.util.spec_from_file_location('cutover', Path(__file__).with_name('activate-fresh-testnet.py'))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
PROBE = r"""
import fs from 'node:fs';
import {FetchRequest,JsonRpcProvider,Wallet} from 'ethers';
const transport=new FetchRequest(process.env.RPC_URL);transport.timeout=15000;
const p=new JsonRpcProvider(transport,undefined,{batchMaxCount:1,cacheTimeout:-1});
try{
 const cfg=JSON.parse(fs.readFileSync(process.env.DEPLOYMENT_FILE));
 if(cfg.chainId!==56||(await p.getNetwork()).chainId!==56n)throw Error();
 const address=new Wallet(process.env.KEEPER_PRIVATE_KEY).address;
 const excluded=[cfg.owner,cfg.development,cfg.deployer,...cfg.daoPartners,...cfg.genesis].map(x=>x.toLowerCase());
 const balance=await p.getBalance(address);
 console.log(JSON.stringify({result:'FTI_MAINNET_KEEPER_READ_ONLY_CHECK',address,balanceWei:String(balance),
  separateGasWallet:!excluded.includes(address.toLowerCase()),hasGas:balance>0n,activated:false,transactionsSent:0}));
}catch{console.log(JSON.stringify({result:'FTI_MAINNET_KEEPER_CHECK_FAILED',activated:false,transactionsSent:0}));}
finally{p.destroy();}
"""


def main():
    h.require(os.geteuid() == 0, 'Run as root on the FTI VPS.')
    web, keeper = h.capture('web'), h.capture('keeper')
    account = pwd.getpwnam('fti-v3')
    env = {k: web['env'][k] for k in ('DEPLOYMENT_FILE', 'RPC_URL', 'PATH', 'FTI_SOURCE_REVISION')}
    env['KEEPER_PRIVATE_KEY'] = keeper['env']['KEEPER_PRIVATE_KEY']
    output = h.run([str(web['node']), '--input-type=module'], input=PROBE.encode(), env=env,
                   cwd=web['properties']['WorkingDirectory'], user=account.pw_uid,
                   group=account.pw_gid, extra_groups=[], timeout=60)
    result = json.loads(output)
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('FTI_MAINNET_KEEPER_CHECK_UNAVAILABLE; no service or transaction changed.', file=sys.stderr)
        sys.exit(1)
