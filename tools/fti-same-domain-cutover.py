#!/usr/bin/env python3
"""Route existing FTI frontend (3110) to NEW chain-97 contract API (3111).

Only changes the Nginx HTTPS server blocks for ftiprotocol.com and its three
existing workspaces. No contracts, wallets, keeper, build files or process
restarts are involved. Private backups, validation, and guarded rollback.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request

D = Path('/etc/nginx/conf.d/fti-domain.conf')
W = Path('/etc/nginx/conf.d/fti-workspaces.conf')
INCLUDE = Path('/etc/nginx/fti-fresh-api-routes.conf')
BACKUPS = Path('/var/backups/fti-same-domain')
STATE = BACKUPS / 'state.json'
EXPECTED = {
    'chainId': 97,
    'binary': '0xc02b4e207ACcDc020Be0dec190FEA732716B383A',
    'token': '0x1C38Ab2c2F64e1bcE96Fc438Da374c4998E70411',
    'usd': '0x6CFf59257D178AB3954aA0189ad48B20090B8a11'
}
HOSTS = ['ftiprotocol.com', 'app.ftiprotocol.com',
         'token.ftiprotocol.com', 'council.ftiprotocol.com']
TARGETS = {
    str(D): ['ftiprotocol.com'],
    str(W): ['app.ftiprotocol.com', 'token.ftiprotocol.com',
             'council.ftiprotocol.com']
}
ROUTES = """# Only dynamic read-only API/ABI/RPC/health traffic goes to NEW 3111.
# All HTML, JS, CSS, images, and /vendor remain on 3110.
location ^~ /api/ {
    proxy_pass http://127.0.0.1:3111;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_connect_timeout 5s;
    proxy_read_timeout 45s;
}
location ^~ /abi/ {
    proxy_pass http://127.0.0.1:3111;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_connect_timeout 5s;
    proxy_read_timeout 45s;
}
location = /rpc {
    proxy_pass http://127.0.0.1:3111;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_connect_timeout 5s;
    proxy_read_timeout 45s;
}
location = /health {
    proxy_pass http://127.0.0.1:3111;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_connect_timeout 5s;
    proxy_read_timeout 45s;
}
"""

def chk(condition, message):
    if not condition:
        raise RuntimeError(message)

def digest(value):
    return hashlib.sha256(value).hexdigest()

def command(args, timeout=30):
    p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if p.returncode:
        raise RuntimeError('COMMAND_FAILED: ' + ' '.join(args[:2]) +
                           ' - ' + (p.stderr or p.stdout).strip()[-400:])
    return p.stdout.strip()

def read(path):
    chk(path.is_file() and not path.is_symlink(), 'MISSING_OR_UNSAFE_FILE: ' + str(path))
    return path.read_bytes()

def atomic(path, content, mode):
    chk(not path.is_symlink(), 'SYMLINK_REFUSED: ' + str(path))
    temp = path.with_name('.' + path.name + '.stage-' + str(os.getpid()))
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'wb') as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink()

def patch(raw, names):
    lines = raw.decode('utf-8').splitlines(keepends=True)
    chk('fti-fresh-api-routes.conf' not in raw.decode('utf-8'),
        'ROUTES_ALREADY_INCLUDED')
    positions = []
    for i, line in enumerate(lines):
        matched = re.fullmatch(r'\s*server_name\s+(.+?)\s*;\s*\n?', line)
        if not matched or matched.group(1).split() != names:
            continue
        previous = ''.join(lines[max(0, i-8):i])
        if re.search(r'(?m)^\s*listen\s+443\s+ssl(?:\s+http2)?\s*;\s*$', previous):
            positions.append(i)
    chk(len(positions) == 1, 'SSL_SERVER_NAME_NOT_UNIQUE: ' + ','.join(names))
    i = positions[0]
    indent = re.match(r'\s*', lines[i]).group()
    lines.insert(i+1, indent + 'include ' + str(INCLUDE) + ';\n')
    return ''.join(lines).encode('utf-8')

def check_addresses(cfg):
    return isinstance(cfg, dict) and all(
        cfg.get(k) == v if k == 'chainId' else
        isinstance(cfg.get(k), str) and cfg[k].lower() == v.lower()
        for k, v in EXPECTED.items())

def local_json(port, path):
    with urllib.request.urlopen(
            'http://127.0.0.1:' + str(port) + path, timeout=25) as r:
        chk(r.status == 200, 'UPSTREAM_BAD_STATUS: ' + path)
        return json.loads(r.read(1000000))

def domain_json(host, path):
    output = command([
        'curl', '--noproxy', '*', '-fsS', '--connect-timeout', '5',
        '--max-time', '25', '--resolve', host + ':443:127.0.0.1',
        'https://' + host + path
    ], timeout=32)
    return json.loads(output)

def verify_ready():
    chk(command(['hostname']) == 'vps-titan-5320', 'WRONG_VPS')
    chk(command(['systemctl','is-active','fti-fresh-3111.service']) == 'active',
        'NEW_3111_SERVICE_NOT_ACTIVE')
    command(['nginx','-t'])
    chk(isinstance(local_json(3110, '/api/config'), dict),
        'OLD_3110_NOT_RESPONDING')
    new_health = local_json(3111,'/health')
    chk(new_health.get('ok') is True and new_health.get('chainId') == 97,
        'NEW_3111_HEALTH_FAILED')
    chk(check_addresses(local_json(3111,'/api/config')),
        'NEW_3111_ADDRESSES_MISMATCH')
    state=local_json(3111,'/api/state')
    chk('count' in state and 'pending' in state, 'NEW_STATE_FAILED')
    print('PREFLIGHT_OK: 3110 UI, 3111 BNB testnet API',flush=True)

def verify_domain():
    for host in HOSTS:
        cfg = domain_json(host, '/api/config')
        if not check_addresses(cfg):
            print('DOMAIN_MISMATCH host=' + host +
                  ' chain=' + str(cfg.get('chainId') if isinstance(cfg,dict) else 'invalid') +
                  ' token=' + str(cfg.get('token') if isinstance(cfg,dict) else 'invalid') +
                  ' binary=' + str(cfg.get('binary') if isinstance(cfg,dict) else 'invalid'),
                  flush=True)
        chk(check_addresses(cfg),
            'PUBLIC_DOMAIN_WRONG_CONTRACT: ' + host)
        health=domain_json(host,'/health')
        chk(health.get('chainId') == 97 and health.get('ok') is True,
            'PUBLIC_DOMAIN_HEALTH_FAILED: '+host)
        print('DOMAIN_OK='+host,flush=True)
    abi=domain_json(HOSTS[0],'/abi/FundedBinaryPlanUpgradeable')
    chk(isinstance(abi,list) and len(abi)>0,'NEW_ABI_UNAVAILABLE')
    state=domain_json(HOSTS[0],'/api/state')
    chk('count' in state and 'pending' in state,'NEW_STATE_UNAVAILABLE')
    rpc=command(['curl','--noproxy','*','-fsS','--connect-timeout','5',
                 '--max-time','25','--resolve',HOSTS[0]+':443:127.0.0.1',
                 '-H','Content-Type: application/json','--data',
                 '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}',
                 'https://'+HOSTS[0]+'/rpc'],timeout=32)
    chk(json.loads(rpc).get('result')=='0x61','NEW_RPC_WRONG_CHAIN')

def wait_for_domain(timeout=40, interval=2):
    """Nginx reload is asynchronous. Do not mistake a stale worker for failure."""
    stop = time.monotonic() + timeout
    last_error = None
    attempt = 0
    while True:
        attempt += 1
        try:
            verify_domain()
            print('ROUTE_VERIFIED_AFTER_ATTEMPTS=' + str(attempt), flush=True)
            return
        except Exception as exc:
            last_error = str(exc)
            print('ROUTE_PENDING attempt=' + str(attempt) + ' reason=' + last_error,
                  flush=True)
            remaining = stop - time.monotonic()
            if remaining <= 0:
                break
            time.sleep(min(interval, remaining))
    raise RuntimeError('CUTOVER_VERIFICATION_TIMEOUT: ' + str(last_error))

def restore(manifest):
    for row in manifest['files']:
        path=Path(row['path'])
        original=read(Path(row['backup']))
        chk(digest(original)==row['oldSHA'],'BACKUP_TAMPERED')
        current=read(path)
        chk(digest(current) in [row['oldSHA'],row['newSHA']],
            'CONFIG_CHANGED_AFTER_CUTOVER: '+str(path))
        if digest(current)!=row['oldSHA']:
            atomic(path,original,row['mode'])
    if INCLUDE.exists():
        chk(digest(read(INCLUDE))==manifest['includeSHA'],'ROUTES_MODIFIED')
        INCLUDE.unlink()
    command(['nginx','-t'])
    command(['systemctl','reload','nginx'])
    print('NGINX_RESTORED',flush=True)

def apply():
    chk(not STATE.exists(),'EXISTING_OR_INTERRUPTED_CUTOVER: use --status / --rollback')
    chk(not INCLUDE.exists() and not INCLUDE.is_symlink(),'ROUTES_INCLUDE_EXISTS')
    verify_ready()
    changes=[]
    folder=BACKUPS / ('backup-' + time.strftime('%Y%m%d-%H%M%S'))
    folder.mkdir(mode=0o700)
    for filename,names in TARGETS.items():
        path=Path(filename)
        original=read(path)
        updated=patch(original,names)
        original_mode=path.stat().st_mode & 0o777
        backup=folder/path.name
        atomic(backup,original,0o600)
        changes.append({
            'path':filename, 'backup':str(backup), 'mode':original_mode,
            'oldSHA':digest(original),'newSHA':digest(updated)
        })
    manifest={'schema':'FTI_SAME_DOMAIN_V1','files':changes,
              'backupFolder':str(folder),'includeSHA':digest(ROUTES.encode())}
    atomic(STATE,(json.dumps(manifest,indent=2)+'\n').encode(),0o600)
    print('BACKUP='+str(folder),flush=True)
    try:
        atomic(INCLUDE,ROUTES.encode(),0o600)
        for row in changes:
            path=Path(row['path'])
            chk(digest(read(path))==row['oldSHA'],'ADMIN_EDITED_CONFIG')
            original=read(path)
            atomic(path,patch(original,TARGETS[str(path)]),row['mode'])
        command(['nginx','-t'])
        command(['systemctl','reload','nginx'])
        wait_for_domain(timeout=40, interval=2)
        print('FTI_SAME_DOMAIN_TESTNET_CUTOVER_OK',flush=True)
        print('Old 3110 and new 3111 processes were NOT restarted.',flush=True)
    except Exception:
        print('VALIDATION_FAILED: attempting automatic rollback',flush=True)
        try:
            restore(manifest)
            STATE.unlink()
        except Exception as error:
            print('ROLLBACK_NEEDS_REVIEW: '+str(error),flush=True)
        raise

def rollback():
    chk(STATE.exists(),'NO_CUTOVER_STATE')
    manifest=json.loads(read(STATE))
    chk(manifest.get('schema')=='FTI_SAME_DOMAIN_V1','INVALID_STATE')
    chk({r['path'] for r in manifest['files']}==set(TARGETS),'INVALID_RESTORE_TARGETS')
    restore(manifest)
    STATE.unlink()

def main():
    chk(os.geteuid()==0,'RUN_AS_ROOT')
    os.umask(0o077)
    BACKUPS.mkdir(mode=0o700,parents=True,exist_ok=True)
    chk(not BACKUPS.is_symlink() and (BACKUPS.stat().st_mode & 0o077)==0,
        'BACKUP_DIRECTORY_PERMISSIONS_NOT_0700')
    fd=os.open(BACKUPS/'lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        cmd=sys.argv[1:]
        if cmd==['--status']:
            print(json.dumps({'cutoverStateExists':STATE.exists(),
                'routeIncludeExists':INCLUDE.exists(),
                'backupRoot':str(BACKUPS)}))
        elif cmd==['--apply']: apply()
        elif cmd==['--rollback']: rollback()
        else: raise RuntimeError('Use --apply, --status or --rollback')
    finally:
        os.close(fd)

if __name__=='__main__':
    try: main()
    except Exception as e:
        print('FTI_CUTOVER_STOPPED: '+str(e),file=sys.stderr)
        sys.exit(1)
