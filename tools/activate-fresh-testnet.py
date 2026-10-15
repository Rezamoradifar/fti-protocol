#!/usr/bin/env python3
"""Attach existing FTI systemd services to the reviewed, already deployed testnet.

No deployment, signer creation, key export, funding or contract upgrade. The
existing Keeper resumes ordinary testnet settlement after the service switch.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request

REVISION = 'bc2163070a6e79bcc129a6a788e61c4ace402bdf'
DIGEST = 'e2c54422e78d768bce0236379fe3047566ea01e465a1d8a81ce25c564ee053c1'
ADDRESSES = {
    'usd': '0xb0b8e7746A695423881981A2C3B53ec59330D483',
    'council': '0x20FEff81eB2355Ab5B011F61EB79D00ee9934597',
    'timelock': '0xE3ec19E1FC4A4933133C7AFC47B5b4d07710c36c',
    'tokenImplementation': '0xEd218d080fA597Ebcb9C3Ce89927A58D4F6EAe7a',
    'token': '0x3561f120Ae89C363580Cb3Fb34B53F1265E603D2',
    'binaryImplementation': '0xa2a0D4F20d8958E4bB6C87526ADF976553babb3c',
    'binary': '0x40e727e15b65461D52e92907aa96E27017Ea70fE',
}
UNITS = {role: 'fti-continuity-' + role + '.service' for role in ('web', 'keeper')}
DROP_NAME = 'zz-fti-fresh-testnet.conf'
API_ROUTES = Path('/etc/nginx/fti-fresh-api-routes.conf')
FTI_VHOSTS = {'/etc/nginx/conf.d/fti-domain.conf', '/etc/nginx/conf.d/fti-workspaces.conf'}
SETTINGS = {
    'web': ('RPC_URL', 'EVENT_RPC_URL', 'PORT', 'HOST', 'WALLETCONNECT_PROJECT_ID'),
    'keeper': ('RPC_URL', 'KEEPER_PRIVATE_KEY', 'KEEPER_INTERVAL_MS'),
}
COPY_DIRS = ('contracts', 'frontend', 'scripts', 'core', 'web', 'artifacts',
             'node_modules', 'landing/src', 'landing/dist')


class CutoverError(Exception):
    pass


def require(ok, message):
    if not ok:
        raise CutoverError(message)


def run(argv, **kwargs):
    result = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=kwargs.pop('timeout', 120), **kwargs)
    require(result.returncode == 0, 'Command failed: ' + Path(argv[0]).name +
            '. No secret-bearing command output is displayed.')
    return result.stdout.decode()


def write(file, text, mode=0o600):
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'w') as stream:
        stream.write(text)
        stream.flush()
        os.fsync(stream.fileno())


def load(file):
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as stream:
        require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode), 'Expected a regular JSON file.')
        return json.load(stream)


def properties(role):
    output = run(['systemctl', 'show', UNITS[role],
                  '--property=LoadState,ActiveState,MainPID,User,Group,WorkingDirectory'])
    return dict(line.split('=', 1) for line in output.splitlines() if '=' in line)


def capture(role):
    p = properties(role)
    require(p.get('LoadState') == 'loaded' and p.get('ActiveState') == 'active',
            role + ' service must already be loaded and active.')
    require(p.get('User') == 'fti-v3' and p.get('Group') == 'fti-v3',
            'Unexpected service user/group.')
    pid = int(p['MainPID'])
    require(pid > 1, 'Missing service process.')
    proc = Path('/proc') / str(pid)
    require(proc.stat().st_uid == pwd.getpwnam('fti-v3').pw_uid, 'Service process owner changed.')
    env = dict(item.decode().split('=', 1) for item in (proc / 'environ').read_bytes().split(b'\0')
               if item and b'=' in item)
    node = (proc / 'exe').resolve(strict=True)
    require(str(node).startswith('/opt/fti/runtime/node-v22.') and node.name == 'node',
            'Expected the installed FTI Node 22 runtime.')
    require(properties(role).get('MainPID') == str(pid), 'Service restarted during inspection; retry.')
    return {'properties': p, 'env': env, 'node': node}


def env_text(env):
    lines = []
    for key, value in sorted(env.items()):
        require(re.fullmatch(r'[A-Z][A-Z0-9_]*', key) and isinstance(value, str),
                'Unexpected environment setting.')
        require(not any(ord(c) < 32 or ord(c) == 127 for c in value),
                'Multiline/control-character environment values are unsupported.')
        # systemd EnvironmentFile double quotes: dollars/backticks remain literal.
        lines.append(key + '="' + value.replace('\\', '\\\\').replace('"', '\\"') + '"\n')
    return ''.join(lines)


def runtime_env(role, saved, state):
    old = saved['env']
    env = {key: old[key] for key in SETTINGS[role] if key in old}
    if not env.get('RPC_URL'):
        env['RPC_URL'] = load(Path(old['DEPLOYMENT_FILE'])).get('rpcUrl', '')
    require(env['RPC_URL'].startswith('https://'), 'An existing HTTPS testnet RPC is required.')
    if env.get('EVENT_RPC_URL'):
        require(env['EVENT_RPC_URL'].startswith('https://'), 'Event RPC must use HTTPS.')
    if role == 'web':
        require(env.get('PORT') == '3110' and env.get('HOST', '127.0.0.1') == '127.0.0.1',
                'Expected the existing localhost:3110 web service.')
        require(re.fullmatch('[a-fA-F0-9]{32}', env.get('WALLETCONNECT_PROJECT_ID', '')),
                'Existing WalletConnect project ID is missing.')
    else:
        require(re.fullmatch(r'(?:0x)?[a-fA-F0-9]{64}', env.get('KEEPER_PRIVATE_KEY', '')),
                'Existing Keeper signing key is missing or invalid.')
    env.update(DEPLOYMENT_FILE=str(state / 'deployment.json'), FTI_SOURCE_REVISION=REVISION,
               PATH=str(saved['node'].parent) + ':/usr/local/bin:/usr/bin:/bin', LANG='C.UTF-8')
    return env


def check_target(cfg, result):
    require(result.get('result') == 'FTI_FRESH_TESTNET_DEPLOYED', 'Successful deployment result required.')
    for obj in (cfg, result):
        require(obj.get('chainId') == 97 and obj.get('sourceRevision') == REVISION and
                obj.get('poolDistributionVersion') == 1 and
                obj.get('rewardModel') == 'hourly-global-pool-v2', 'Wrong deployment network/release/model.')
    require(cfg.get('deploymentKind') == 'fresh-testnet' and cfg.get('planDigest') == DIGEST,
            'Wrong fresh deployment plan.')
    for key, expected in ADDRESSES.items():
        require(cfg.get(key, '').lower() == expected.lower() and
                result.get('addresses', {}).get(key, '').lower() == expected.lower(),
                'Deployment address mismatch: ' + key)


def find_source(work):
    require(work.is_absolute() and work.resolve() == work and work.name.startswith('run-') and
            work.parent.name == REVISION, 'Use the original absolute run directory.')
    entries = list((work / 'candidates').iterdir())
    require(len(entries) == 1, 'Expected one prepared candidate.')
    prepared = load(entries[0] / 'result.json')
    require(prepared.get('commit') == REVISION and prepared.get('result') == 'CANDIDATE_PREPARED'
            and prepared.get('stage') == 'complete' and prepared.get('exitCode') == 0,
            'The saved build/tests did not pass.')
    source = entries[0] / 'source'
    require(run(['git', '-C', str(source), 'rev-parse', 'HEAD']).strip() == REVISION,
            'Prepared source revision changed.')
    run(['git', '-C', str(source), 'diff', '--quiet'])
    run(['git', '-C', str(source), 'diff', '--cached', '--quiet'])
    return source


def stage_source(source, release, gid):
    release.mkdir(mode=0o750)
    for name in COPY_DIRS:
        origin = source / name
        require(origin.is_dir() and not origin.is_symlink(), 'Missing or linked build directory: ' + name)
        shutil.copytree(origin, release / name, symlinks=True,
                        ignore=shutil.ignore_patterns('.env', '.env.*', 'test-genesis-keys.json'))
    for name in ('package.json', 'package-lock.json'):
        shutil.copyfile(source / name, release / name)
    # Never copy the run/deployment directory, .git, home, test keys or .env files.
    for base, dirs, files in os.walk(release):
        for file in [Path(base)] + [Path(base) / n for n in dirs + files]:
            if file.is_symlink():
                require(file.resolve().is_relative_to(release), 'Build symlink escapes release.')
                continue
            os.chown(file, 0, gid)
            os.chmod(file, 0o750 if file.is_dir() or file.stat().st_mode & 0o111 else 0o640)


PREFLIGHT = r"""
import fs from 'node:fs';
import {FetchRequest,JsonRpcProvider,Wallet} from 'ethers';
import {verifyV3Deployment} from './scripts/continuity-release.mjs';
const providers=[];
function provider(url){const t=new FetchRequest(url);t.timeout=15000;
 const p=new JsonRpcProvider(t,undefined,{batchMaxCount:1,cacheTimeout:-1});providers.push(p);return p;}
try{
 const cfg=JSON.parse(fs.readFileSync(process.env.DEPLOYMENT_FILE));
 const p=provider(process.env.RPC_URL);
 if((await p.getNetwork()).chainId!==97n)throw Error();
 const {binary}=await verifyV3Deployment(cfg,p);
 if(await binary.poolDistributionVersion()!==1n||await binary.hourlyCapFlushVersion()!==1n)throw Error();
 const result={verified:true,chainId:97,poolDistributionVersion:1};
 if(process.env.EVENT_RPC_URL&&((await provider(process.env.EVENT_RPC_URL).getNetwork()).chainId!==97n))throw Error();
 if(process.env.KEEPER_PRIVATE_KEY){
  const address=new Wallet(process.env.KEEPER_PRIVATE_KEY).address;
  const balance=await p.getBalance(address);if(balance===0n)throw Error('KEEPER_HAS_NO_TEST_GAS');
  result.keeper=address;result.keeperBalanceWei=String(balance);
 }
 console.log(JSON.stringify(result));
}catch(e){console.log(JSON.stringify({verified:false,error:e.message==='KEEPER_HAS_NO_TEST_GAS'
 ?'KEEPER_HAS_NO_TEST_GAS':'RPC_OR_BUILD_VERIFICATION_FAILED'}));}
finally{for(const p of providers)p.destroy();}
"""


def preflight(saved, env, release, account):
    # Run with the actual service UID, including its file access restrictions.
    result = json.loads(run([str(saved['node']), '--input-type=module'], cwd=release,
                            input=PREFLIGHT.encode(), env=env, user=account.pw_uid,
                            group=account.pw_gid, extra_groups=[], timeout=240))
    require(result.get('verified') is True, 'Read-only preflight: ' + result.get('error', 'FAILED'))
    return result


def http_json(url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request(url + '?fti_check=' + str(time.time_ns()),
                                     headers={'Cache-Control': 'no-cache'})
    with opener.open(request, timeout=20) as response:
        return json.load(response)


def check_web(cfg, base='http://127.0.0.1:3110'):
    health = http_json(base + '/health')
    require(health.get('ok') is True and health.get('chainId') == 97, 'Web health/network mismatch.')
    actual = http_json(base + '/api/config')
    for key in (*ADDRESSES, 'sourceRevision', 'sourceFingerprint'):
        require(actual.get(key) == cfg.get(key), 'Served deployment mismatch at ' + base + ': ' + key)
    require(actual.get('poolDistributionVersion') == 1 and actual.get('hourlyCapFlushVersion') == 1,
            'Web reward model mismatch.')
    state = http_json(base + '/api/state')
    require(state.get('rewardModel') == 'hourly-global-pool-v2', 'Wrong served pool model.')
    return actual


def check_assets(release, base='http://127.0.0.1:3110'):
    routes = {'/': 'landing/dist/index.html', '/app/': 'web/index.html',
              '/token/': 'web/index.html', '/admin/': 'web/index.html',
              '/app.js': 'landing/dist/app.js', '/app.css': 'landing/dist/app.css',
              '/app/app.js': 'web/app.js', '/vendor/walletconnect.js': 'web/vendor/walletconnect.js'}
    for route, file in routes.items():
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        request = urllib.request.Request(base + route + '?fti_check=' + str(time.time_ns()),
                                         headers={'Cache-Control': 'no-cache'})
        with opener.open(request, timeout=20) as response:
            require(response.read() == (release / file).read_bytes(), 'Wrong served asset: ' + route)


def dropin(role, release, state, node):
    entry = 'server' if role == 'web' else 'keeper'
    return ('[Service]\nWorkingDirectory=' + str(release) + '\nEnvironment=\nEnvironmentFile=\n'
            'EnvironmentFile=' + str(state / (role + '.env')) + '\nExecStart=\nExecStart=' +
            str(node) + ' ' + str(release / 'scripts' / (entry + '.mjs')) + '\n')


def drop_path(role):
    return Path('/etc/systemd/system') / (UNITS[role] + '.d') / DROP_NAME


def repair_proxy_text(original):
    """Change only explicit loopback proxy destinations; retain routes/auth/limits/URIs."""
    uncommented = re.sub(r'(?m)#.*$', '', original)
    count = len(re.findall(r'\bproxy_pass\s+', uncommented))
    pattern = re.compile(r'(?m)^(\s*proxy_pass\s+http://)(127\.0\.0\.1|localhost):(\d+)([^;\n]*;)')
    matches = list(pattern.finditer(uncommented))
    require(count > 0 and count == len(matches),
            'API routes contain a non-loopback, variable or unsupported proxy destination; no change made.')
    require(all(1024 <= int(m[3]) <= 65535 for m in matches), 'Unexpected API backend port.')
    # Use spans in the original text: stripping comments must not shift offsets.
    masked = re.sub(r'(?m)#.*$', lambda m: ' ' * len(m[0]), original)
    edits = list(pattern.finditer(masked))
    result = original
    for match in reversed(edits):
        begin, end = match.span(2)[0], match.span(3)[1]
        result = result[:begin] + '127.0.0.1:3110' + result[end:]
    return result


def validate_api_references(dump):
    users = set()
    for part in re.split(r'(?m)^# configuration file ', dump)[1:]:
        name, _, body = part.partition('\n')
        body = re.sub(r'(?m)#.*$', '', body)
        if re.search(r'\binclude\s+[\"\']?' + re.escape(str(API_ROUTES)) + r'[\"\']?\s*;', body):
            users.add(name.rstrip(':'))
    require(users and users.issubset(FTI_VHOSTS),
            'The API include is not exclusively referenced by the known FTI vhosts.')


def prepare_api_repair(backup):
    addresses = {row[4][0] for row in socket.getaddrinfo('ftiprotocol.com', 443, type=socket.SOCK_STREAM)}
    require(addresses == {'185.114.206.44'}, 'Main domain DNS does not match the approved VPS.')
    file = API_ROUTES
    require(file.is_file() and not file.is_symlink(), 'Expected the existing FTI API routes file.')
    info = file.stat()
    require(info.st_uid == 0 and not info.st_mode & 0o022,
            'API routes must be root-owned and not writable by group/others.')
    validate_api_references(run(['nginx', '-T']))
    before = file.read_text()
    after = repair_proxy_text(before)
    require(before != after, 'API routes already use port 3110; inspect the HTTPS listener before retrying.')
    write(backup / 'nginx-api.before.conf', before)
    write(backup / 'nginx-api.after.conf', after)
    return {'path': str(file), 'before': hashlib.sha256(before.encode()).hexdigest(),
            'after': hashlib.sha256(after.encode()).hexdigest(),
            'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid, 'gid': info.st_gid}


def api_file_state(record):
    file = Path(record['path'])
    require(file == API_ROUTES and file.is_file() and not file.is_symlink(), 'Unexpected API repair path.')
    digest = hashlib.sha256(file.read_bytes()).hexdigest()
    require(digest in (record['before'], record['after']),
            'API routes were edited after preparation; preserve them for manual review.')
    return digest


def replace_api_file(backup, record, side):
    content = (backup / ('nginx-api.' + side + '.conf')).read_bytes()
    require(hashlib.sha256(content).hexdigest() == record[side], 'API backup hash mismatch.')
    previous = api_file_state(record)
    fd, name = tempfile.mkstemp(prefix='.fti-api-', dir=API_ROUTES.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
            os.fchown(stream.fileno(), record['uid'], record['gid'])
            os.fchmod(stream.fileno(), record['mode'])
        require(api_file_state(record) == previous, 'API routes changed during replacement.')
        os.replace(temporary, API_ROUTES)
    finally:
        temporary.unlink(missing_ok=True)


def rollback(backup):
    record = load(backup / 'switch.json')
    api = record.get('apiRepair')
    if api:
        api_file_state(api)
    # Refuse to remove files subsequently edited by an operator.
    for role in UNITS:
        file = drop_path(role)
        if os.path.lexists(file):
            require(not file.is_symlink() and hashlib.sha256(file.read_bytes()).hexdigest() ==
                    record['dropHashes'][role], 'Cutover drop-in changed; preserve it for manual review.')
    run(['systemctl', 'stop', *UNITS.values()])
    for role in UNITS:
        drop_path(role).unlink(missing_ok=True)
    if api and api_file_state(api) != api['before']:
        replace_api_file(backup, api, 'before')
        run(['nginx', '-t'])
        run(['systemctl', 'reload', 'nginx'])
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'start', *UNITS.values()])
    require(all(properties(r).get('ActiveState') == 'active' for r in UNITS), 'Rollback services failed to start.')
    print('FTI_PREVIOUS_SERVICES_RESTORED', flush=True)


def switch(release, state, backup, saved, cfg, api_repair=None):
    texts = {r: dropin(r, release, state, saved[r]['node']) for r in UNITS}
    record = {'release': str(release), 'state': str(state),
              'dropHashes': {r: hashlib.sha256(t.encode()).hexdigest() for r, t in texts.items()},
              'apiRepair': api_repair}
    write(backup / 'switch.json', json.dumps(record))
    print('ROLLBACK_COMMAND=python3 ' + str(backup / 'activate.py') + ' --rollback ' + str(backup), flush=True)
    changed = False
    try:
        for role in UNITS:
            require(properties(role) == saved[role]['properties'], 'Service changed during preparation; retry.')
            require(not os.path.lexists(drop_path(role)), 'A fresh cutover drop-in already exists.')
        if api_repair:
            require(api_file_state(api_repair) == api_repair['before'], 'API routes changed before cutover.')
        # Disable the old settlement loop before attaching either service to the new deployment.
        changed = True
        run(['systemctl', 'stop', *UNITS.values()])
        for role in UNITS:
            file = drop_path(role)
            file.parent.mkdir(exist_ok=True, mode=0o755)
            write(file, texts[role], 0o644)
        run(['systemctl', 'daemon-reload'])
        require(all(properties(r).get('WorkingDirectory') == str(release) for r in UNITS),
                'Another systemd override supersedes the new working directory.')
        run(['systemctl', 'start', UNITS['web']])
        deadline = time.monotonic() + 150
        while True:
            try:
                check_web(cfg)
                break
            except (OSError, ValueError, CutoverError):
                require(time.monotonic() < deadline, 'New web service did not become healthy.')
                time.sleep(2)
        check_assets(release)
        print('LOCAL_WEB_AND_ASSETS_VERIFIED', flush=True)
        if api_repair:
            print('STAGE=align_existing_https_api_routes_to_3110', flush=True)
            require(api_file_state(api_repair) == api_repair['before'], 'API routes changed before repair.')
            replace_api_file(backup, api_repair, 'after')
            run(['nginx', '-t'])
            run(['systemctl', 'reload', 'nginx'])
        # Public HTTPS must agree before the new Keeper is allowed to run.
        deadline = time.monotonic() + (45 if api_repair else 0)
        while True:
            try:
                check_web(cfg, 'https://ftiprotocol.com')
                break
            except (OSError, ValueError, CutoverError):
                if time.monotonic() >= deadline:
                    raise
                time.sleep(2)
        print('PUBLIC_HTTPS_DEPLOYMENT_VERIFIED', flush=True)
        if api_repair:
            check_assets(release, 'https://ftiprotocol.com')
            print('PUBLIC_HTTPS_FRONTEND_VERIFIED', flush=True)
        run(['systemctl', 'start', UNITS['keeper']])
        deadline = time.monotonic() + 20
        while True:
            try:
                keeper = capture('keeper')
                break
            except (OSError, CutoverError):
                require(time.monotonic() < deadline, 'Keeper process did not start.')
                time.sleep(1)
        require(keeper['env'].get('DEPLOYMENT_FILE') == str(state / 'deployment.json'),
                'Keeper did not receive the new deployment configuration.')
        pid = keeper['properties']['MainPID']
        for _ in range(5):
            time.sleep(2)
            p = properties('keeper')
            require(p.get('ActiveState') == 'active' and p.get('MainPID') == pid,
                    'Keeper exited or restarted after activation.')
    except BaseException:
        if changed:
            print('FTI_CUTOVER_FAILED: restoring previous services.', flush=True)
            rollback(backup)
        raise


def activate(work, repair_api_routes=False):
    cfg = load(work / 'deployment/deployment.json')
    result = load(work / 'deployment/result.json')
    check_target(cfg, result)
    source = find_source(work)
    saved = {role: capture(role) for role in UNITS}
    if all(load(Path(saved[r]['env']['DEPLOYMENT_FILE'])).get('planDigest') == DIGEST for r in UNITS):
        check_web(cfg)
        check_web(cfg, 'https://ftiprotocol.com')
        print('FTI_FRESH_TESTNET_SERVICES_ALREADY_ACTIVE')
        return
    require(all(not os.path.lexists(drop_path(r)) for r in UNITS),
            'Prior cutover exists; use its saved rollback command before another activation.')
    account = pwd.getpwnam('fti-v3')
    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + str(os.getpid())
    name = 'fresh-' + REVISION[:12] + '-' + stamp
    release = Path('/opt/fti/releases') / name
    state = Path('/var/lib/fti-continuity') / name
    backup = Path('/var/lib/fti-continuity/cutover-backups') / stamp
    backup.mkdir(parents=True, mode=0o700)
    os.chmod(backup, 0o700)
    shutil.copyfile(__file__, backup / 'activate.py')
    print('FTI_CUTOVER_BACKUP=' + str(backup), flush=True)
    api_repair = prepare_api_repair(backup) if repair_api_routes else None
    for role in UNITS:
        write(backup / (role + '.unit.txt'), run(['systemctl', 'cat', UNITS[role]]))
        write(backup / (role + '.active-environment.json'), json.dumps(saved[role]['env']))
    print('STAGE=copy_verified_build', flush=True)
    stage_source(source, release, account.pw_gid)
    state.mkdir(mode=0o750)
    os.chmod(state, 0o750)
    os.chown(state, 0, account.pw_gid)
    # This deployment file contains public receipts/addresses, never signing keys.
    write(state / 'deployment.json', json.dumps(cfg, indent=2), 0o640)
    environments = {r: runtime_env(r, saved[r], state) for r in UNITS}
    for role in UNITS:
        write(state / (role + '.env'), env_text(environments[role]), 0o640)
    for file in state.iterdir():
        os.chown(file, 0, account.pw_gid)
        os.chmod(file, 0o640)
    print('STAGE=read_only_contract_and_service_preflight', flush=True)
    checks = {r: preflight(saved[r], environments[r], release, account) for r in UNITS}
    write(backup / 'preflight.json', json.dumps(checks, indent=2))
    print('STAGE=switch_web_then_keeper', flush=True)
    switch(release, state, backup, saved, cfg, api_repair)
    report = {'result': 'FTI_FRESH_TESTNET_SERVICES_ACTIVE', 'chainId': 97,
              'sourceRevision': REVISION, 'token': cfg['token'], 'binary': cfg['binary'],
              'poolDistributionVersion': 1, 'rewardModel': cfg['rewardModel'],
              'publicHttpsVerified': True, 'keeperProcessStable': True,
              'httpsApiRoutesRepaired': bool(api_repair),
              'hourlyPayoutTestCompleted': False, 'backup': str(backup)}
    write(backup / 'result.json', json.dumps(report, indent=2))
    print(json.dumps(report), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--run-work', type=Path)
    modes.add_argument('--rollback', type=Path)
    parser.add_argument('--repair-api-routes', action='store_true',
                        help='Align existing /etc/nginx/fti-fresh-api-routes.conf loopback targets with port 3110.')
    args = parser.parse_args()
    require(os.geteuid() == 0, 'Run as root on the existing FTI VPS.')
    os.umask(0o077)
    with open('/run/lock/fti-service-cutover.lock', 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise CutoverError('Another service cutover is running.') from None
        def interrupted(*_):
            raise CutoverError('Interrupted.')
        signal.signal(signal.SIGTERM, interrupted)
        signal.signal(signal.SIGHUP, interrupted)
        if args.rollback:
            require(args.rollback.resolve().parent == Path('/var/lib/fti-continuity/cutover-backups'),
                    'Unexpected backup directory.')
            rollback(args.rollback)
        else:
            activate(args.run_work, args.repair_api_routes)


if __name__ == '__main__':
    try:
        main()
    except (CutoverError, KeyboardInterrupt) as error:
        print('FTI_SERVICE_CUTOVER_STOPPED: ' + str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('FTI_SERVICE_CUTOVER_STOPPED: local file, process or network failure. '
              'Preserve the private backup; do not share environment files.', file=sys.stderr)
        sys.exit(1)
