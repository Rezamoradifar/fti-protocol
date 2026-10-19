#!/usr/bin/env python3
"""Read-only monitoring; no keys, transaction submission or service restart."""
import argparse,json,os,subprocess,time,urllib.request
from pathlib import Path
KEEPER='0x2bf894836cbBBb9b27A0394a3EdF340c66839322'
RPC='https://bsc-dataseed.bnbchain.org'
def request(url,payload=None):
 data=None if payload is None else json.dumps(payload).encode()
 req=urllib.request.Request(url,data=data,headers={'Content-Type':'application/json','Cache-Control':'no-cache'})
 with urllib.request.urlopen(req,timeout=15) as response:return json.load(response)
def rpc(method,params):
 result=request(RPC,{'jsonrpc':'2.0','id':1,'method':method,'params':params})
 if 'error' in result or 'result' not in result:raise RuntimeError('RPC failed')
 return result['result']
def evaluate(state,head,balance,keeper_active,previous,now):
 alerts=[];age=head-int(state['timestamp'])
 if not -30<=age<=120:alerts.append('API_STALE')
 if not keeper_active:alerts.append('KEEPER_SERVICE_INACTIVE')
 if balance<10**15:alerts.append('KEEPER_GAS_LOW')
 if int(state['phase'])==0 and head-int(state['epochEnd'])>300:alerts.append('SETTLEMENT_OVERDUE')
 progress=[str(state.get(k,'')) for k in ['epoch','phase','cursor','monthPhase','jobCursor','jobCount','rewardQueue']]
 since=previous.get('since',now) if previous.get('progress')==progress else now
 work=int(state['phase'])!=0 or int(state['monthPhase'])!=0 or int(state.get('rewardQueue',0))>0 or int(state.get('jobCount',0))>int(state.get('jobCursor',0))
 if work and now-since>600:alerts.append('SETTLEMENT_NO_PROGRESS')
 result={'result':'FTI_MONITOR_ALERT' if alerts else 'FTI_MONITOR_OK','alerts':alerts,'epoch':state['epoch'],'phase':state['phase'],'rewardQueue':state.get('rewardQueue'),'apiAgeSeconds':age,'keeperBalanceWei':str(balance),'transactionsSent':0,'checkedAt':now}
 return result,{'progress':progress,'since':since}
def main():
 p=argparse.ArgumentParser();p.add_argument('--state-dir',default='/var/lib/fti-monitor');a=p.parse_args();directory=Path(a.state_dir);directory.mkdir(parents=True,exist_ok=True)
 try:
  if int(rpc('eth_chainId',[]),16)!=56:raise RuntimeError('Wrong chain')
  state=request('https://ftiprotocol.com/api/state');head=int(rpc('eth_getBlockByNumber',['latest',False])['timestamp'],16);balance=int(rpc('eth_getBalance',[KEEPER,'latest']),16)
  active=subprocess.run(['systemctl','is-active','--quiet','fti-continuity-keeper.service'],timeout=10).returncode==0
  prior=directory/'progress.json';previous=json.loads(prior.read_text()) if prior.exists() else {}
  result,progress=evaluate(state,head,balance,active,previous,int(time.time()))
  tmp=directory/'progress.tmp';tmp.write_text(json.dumps(progress));os.replace(tmp,prior)
 except Exception:result={'result':'FTI_MONITOR_ALERT','alerts':['MONITOR_CHECK_FAILED'],'transactionsSent':0,'checkedAt':int(time.time())}
 tmp=directory/'status.tmp';tmp.write_text(json.dumps(result)+'\n');os.replace(tmp,directory/'status.json')
 print(json.dumps(result),flush=True)
 return 2 if result['alerts'] else 0
if __name__=='__main__':raise SystemExit(main())
