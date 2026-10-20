#!/usr/bin/env python3
"""Install an isolated read-only timer. Never restarts web or Keeper."""
import argparse,fcntl,hashlib,json,os,pwd,shutil,subprocess,tempfile
from pathlib import Path
NAMES=['fti-health-monitor.service','fti-health-monitor.timer']
MARK='# FTI_READ_ONLY_MONITOR_V1\n'
MONITOR_USER='fti-health-check'
MONITOR_COMMENT='FTI read-only health monitor'
def run(*args):return subprocess.run(args,check=True,text=True,capture_output=True).stdout.strip()
def ensure_monitor_user():
 try:account=pwd.getpwnam(MONITOR_USER)
 except KeyError:
  run('useradd','--system','--user-group','--no-create-home','--home-dir','/nonexistent','--shell','/usr/sbin/nologin','--comment',MONITOR_COMMENT,MONITOR_USER)
  account=pwd.getpwnam(MONITOR_USER)
 if account.pw_uid==0 or account.pw_gid==0 or account.pw_shell!='/usr/sbin/nologin' or account.pw_dir!='/nonexistent' or account.pw_gecos!=MONITOR_COMMENT:
  raise RuntimeError('Existing monitor account does not match managed service identity')
 # No credentials, group privileges, policy exceptions or restart rights are granted.
 state=run('runuser','-u',MONITOR_USER,'--','systemctl','--system','show','fti-continuity-keeper.service','--property=ActiveState','--value')
 if state not in {'active','inactive','failed','activating','deactivating','reloading','maintenance','refreshing'}:
  raise RuntimeError('Monitor cannot read Keeper state; no unit changed')
 print('FTI_MONITOR_SERVICE_QUERY_PREFLIGHT='+state,flush=True)
def units(script):
 return {NAMES[0]:MARK+f'''[Unit]
Description=FTI read-only mainnet health monitor
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 {script}
User={MONITOR_USER}
DynamicUser=yes
StateDirectory=fti-monitor
StateDirectoryMode=0700
UMask=0077
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
NoNewPrivileges=yes
TimeoutStartSec=110
''',NAMES[1]:MARK+'''[Unit]
Description=Check FTI health every minute
[Timer]
OnBootSec=30
OnUnitActiveSec=60
Persistent=true
Unit=fti-health-monitor.service
[Install]
WantedBy=timers.target
'''}
def write(path,data):
 tmp=path.with_suffix(path.suffix+'.fti-tmp');tmp.write_text(data);tmp.chmod(0o644);os.replace(tmp,path)
def restore(backup):
 record=json.loads((backup/'record.json').read_text());base=Path('/etc/systemd/system')
 for name in NAMES:
  p=base/name
  if p.exists() and p.read_text() not in [record['installed'][name],record['before'][name]]:raise RuntimeError('Concurrent monitor edit; refusing rollback')
 subprocess.run(['systemctl','disable','--now',NAMES[1]],check=False,capture_output=True);subprocess.run(['systemctl','stop',NAMES[0]],check=False,capture_output=True)
 for name in NAMES:
  p=base/name;old=record['before'][name]
  if old is None:p.unlink(missing_ok=True)
  else:write(p,old)
 run('systemctl','daemon-reload')
 if record['enabled']:run('systemctl','enable',NAMES[1])
 if record['active']:run('systemctl','start',NAMES[1])
 print('FTI_MONITOR_ROLLED_BACK')
def install():
 base=Path('/etc/systemd/system');before={}
 for name in NAMES:
  p=base/name
  if p.is_symlink():raise RuntimeError('Refusing symlink unit')
  text=p.read_text() if p.exists() else None
  if text is not None and not text.startswith(MARK):raise RuntimeError('Unmanaged monitor unit exists')
  before[name]=text
 ensure_monitor_user()
 source=Path(__file__).with_name('mainnet-monitor.py');data=source.read_bytes();release=Path('/opt/fti-monitor')/hashlib.sha256(data).hexdigest()[:16];release.mkdir(parents=True,exist_ok=True)
 if release.is_symlink() or release.parent.is_symlink():raise RuntimeError('Refusing symlink release')
 release.parent.chmod(0o755);release.chmod(0o755)
 target=release/'mainnet-monitor.py'
 if target.is_symlink():raise RuntimeError('Refusing symlink script')
 if target.exists() and target.read_bytes()!=data:raise RuntimeError('Monitor source mismatch')
 target.write_bytes(data);target.chmod(0o644);installed=units(target)
 for name,text in installed.items():(release/name).write_text(text)
 run('systemd-analyze','verify',*[str(release/n) for n in NAMES])
 backups=Path('/var/backups/fti-monitor');backups.mkdir(mode=0o700,exist_ok=True);backup=Path(tempfile.mkdtemp(prefix='install-',dir=backups))
 record={'before':before,'installed':installed,'active':subprocess.run(['systemctl','is-active','--quiet',NAMES[1]],capture_output=True).returncode==0,'enabled':subprocess.run(['systemctl','is-enabled','--quiet',NAMES[1]],capture_output=True).returncode==0}
 (backup/'record.json').write_text(json.dumps(record));shutil.copyfile(__file__,backup/'install-mainnet-monitor.py')
 print(f'ROLLBACK_COMMAND=python3 {backup}/install-mainnet-monitor.py --rollback {backup}',flush=True)
 try:
  for name,text in installed.items():write(base/name,text)
  run('systemctl','daemon-reload');run('systemctl','enable','--now',NAMES[1]);run('systemctl','start','--no-block',NAMES[0]);run('systemctl','is-active','--quiet',NAMES[1])
 except Exception:
  restore(backup);raise
 print(json.dumps({'result':'FTI_READ_ONLY_MONITOR_INSTALLED','intervalSeconds':60,'transactionsSent':0,'alerts':'systemd journal and /var/lib/fti-monitor/status.json','backup':str(backup)}))
def main():
 if os.geteuid()!=0:raise RuntimeError('Run as root on the FTI VPS')
 os.umask(0o077)
 p=argparse.ArgumentParser();p.add_argument('--rollback',type=Path);a=p.parse_args()
 with open('/run/lock/fti-health-monitor.lock','w') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  if a.rollback:restore(a.rollback)
  else:install()
if __name__=='__main__':main()
