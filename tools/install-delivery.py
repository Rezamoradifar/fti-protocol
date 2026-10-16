#!/usr/bin/env python3
"""Install built landing on the existing FTI mainnet web, preserving runtime source."""
import fcntl, importlib.util, json, os, signal, subprocess, sys, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('landing_installer',ROOT/'landing/install_dist.py')
i=importlib.util.module_from_spec(spec);spec.loader.exec_module(i)
def require(ok,message):
    if not ok: raise RuntimeError(message)
def properties():
    out=subprocess.check_output(['systemctl','show','fti-continuity-web.service','--property=ActiveState,MainPID,WorkingDirectory'],text=True)
    return dict(line.split('=',1) for line in out.splitlines() if '=' in line)
def config(origin):
    with urllib.request.urlopen(origin+'/api/config',timeout=25) as r: return json.load(r)
def main():
    require(os.geteuid()==0,'Run as root on the existing FTI server.')
    with open('/run/lock/fti-service-cutover.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        saved=properties();require(saved.get('ActiveState')=='active','Existing FTI web must be active.')
        live=Path(saved['WorkingDirectory'])
        require(live.parent==Path('/opt/fti/releases') and live.resolve()==live,'Unexpected active release path.')
        target=live/'landing/dist'
        require(target.is_dir() and target.resolve()==target,'Unexpected landing path.')
        expected={'chainId':56,'mode':'bnb-mainnet','token':'0x43755B1E813b2d41F669ea08bcf859De07195eA1','binary':'0x13aC3Af4FE3e72DccfFd52AB67E4d884B6D97dF9'}
        for origin in ('http://127.0.0.1:3110','https://ftiprotocol.com'):
            cfg=config(origin)
            require(all(cfg.get(k)==v for k,v in expected.items()),'Mainnet deployment mismatch.')
        i.validate(ROOT/'landing/dist')
        require(properties()==saved,'Service changed; retry before installing.')
        # The existing installer owns atomic activation, asset validation and rollback.
        subprocess.run(['python3',str(ROOT/'landing/install_dist.py'),'--source',str(ROOT/'landing/dist'),'--target',str(target),'--origin','https://ftiprotocol.com','--resolve','ftiprotocol.com:443:127.0.0.1'],check=True)
        print('FTI_DELIVERY_LANDING_INSTALLED; check the public site in a mobile browser.')
if __name__=='__main__':
    try: main()
    except Exception as e:
        print('FTI_DELIVERY_STOPPED: '+str(e),file=sys.stderr);sys.exit(1)
