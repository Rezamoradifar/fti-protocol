#!/usr/bin/env python3
"""Attach only the existing web service to the verified mainnet deployment."""
import argparse
import fcntl
import getpass
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import signal
import sys
import time
import urllib.parse
import urllib.request
import warnings

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('cutover', HERE / 'activate-fresh-testnet.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
h.UNITS = {'web': 'fti-continuity-web.service'}
h.DROP_NAME = 'zzz-fti-mainnet-web.conf'
h.REVISION = 'ba82373a83d63fba0643332371cfb6d62903c849'
h.COPY_DIRS = (*h.COPY_DIRS, 'config')
DEPLOYMENT = HERE.parent / 'deployments/mainnet-20261016.json'
DIGEST = '0ec3a7d93f5e1225cbd4f5671f4ee6b92423718898f1734c42390337467f7480'


def check_target(cfg):
    h.require(cfg.get('chainId') == 56 and cfg.get('mode') == 'bnb-mainnet' and
              cfg.get('sourceRevision') == h.REVISION and cfg.get('mainnetPlanDigest') == DIGEST,
              'Wrong verified mainnet deployment.')
    for key, value in {'token': '0x43755B1E813b2d41F669ea08bcf859De07195eA1',
                       'binary': '0x13aC3Af4FE3e72DccfFd52AB67E4d884B6D97dF9'}.items():
        h.require(cfg.get(key) == value, 'Wrong mainnet ' + key)


def environment(saved, state, rpc):
    url = urllib.parse.urlsplit(rpc)
    h.require(url.scheme == 'https' and url.hostname and not url.username and
              not url.password and not url.fragment, 'An HTTPS mainnet RPC is required.')
    old = saved['env']
    h.require(old.get('PORT') == '3110' and old.get('HOST', '127.0.0.1') == '127.0.0.1',
              'Expected the existing web service on localhost:3110.')
    env = {'RPC_URL': rpc, 'PORT': '3110', 'HOST': '127.0.0.1',
           'DEPLOYMENT_FILE': str(state / 'deployment.json'), 'FTI_SOURCE_REVISION': h.REVISION,
           'PATH': str(saved['node'].parent) + ':/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
           'LANG': 'C.UTF-8', 'NODE_ENV': 'production'}
    if old.get('WALLETCONNECT_PROJECT_ID'):
        h.require(re.fullmatch('[a-fA-F0-9]{32}', old['WALLETCONNECT_PROJECT_ID']), 'Invalid WalletConnect ID.')
        env['WALLETCONNECT_PROJECT_ID'] = old['WALLETCONNECT_PROJECT_ID']
    return env


def check_web(cfg, base):
    health = h.http_json(base + '/health')
    h.require(health.get('ok') is True and health.get('chainId') == 56, 'Web network mismatch.')
    actual = h.http_json(base + '/api/config')
    for key in ('token', 'binary', 'usd', 'council', 'timelock', 'sourceRevision',
                'sourceFingerprint', 'mainnetPlanDigest', 'chainId'):
        h.require(actual.get(key) == cfg[key], 'Served mainnet mismatch: ' + key)
    h.require(actual.get('poolDistributionVersion') == 1 and actual.get('hourlyCapFlushVersion') == 1,
              'Wrong served pool version.')
    h.require(h.http_json(base + '/api/state').get('rewardModel') == 'hourly-global-pool-v2',
              'Wrong served reward model.')


def check_assets(release, base):
    routes = {'/': 'landing/dist/index.html', '/app/': 'web/index.html',
              '/token/': 'web/index.html', '/admin/': 'web/index.html',
              '/app/app.js': 'web/app.js', '/vendor/walletconnect.js': 'web/vendor/walletconnect.js'}
    for file in (release / 'landing/dist/assets').rglob('*'):
        if file.is_file():
            routes['/assets/' + file.relative_to(release / 'landing/dist/assets').as_posix()] = str(file.relative_to(release))
    h.require(len(routes) > 6, 'Missing hashed landing assets.')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for route, file in routes.items():
        with opener.open(base + route + '?fti_check=' + str(time.time_ns()), timeout=20) as response:
            h.require(response.read() == (release / file).read_bytes(), 'Asset mismatch: ' + route)


def switch(release, state, backup, saved, cfg):
    text = h.dropin('web', release, state, saved['node'])
    h.write(backup / 'switch.json', json.dumps({'dropHashes': {'web': hashlib.sha256(text.encode()).hexdigest()}}))
    print('ROLLBACK_COMMAND=python3 ' + str(backup / 'activate-mainnet-web.py') + ' --rollback ' + str(backup), flush=True)
    changed = False
    try:
        h.require(h.properties('web') == saved['properties'], 'Web process changed during preparation.')
        h.require(not os.path.lexists(h.drop_path('web')), 'Mainnet override already exists.')
        changed = True
        h.run(['systemctl', 'stop', h.UNITS['web']])
        h.drop_path('web').parent.mkdir(mode=0o755, exist_ok=True)
        h.write(h.drop_path('web'), text, 0o644)
        h.run(['systemctl', 'daemon-reload'])
        h.require(h.properties('web').get('WorkingDirectory') == str(release), 'Override superseded.')
        h.run(['systemctl', 'start', h.UNITS['web']])
        deadline = time.monotonic() + 180
        while True:
            try:
                check_web(cfg, 'http://127.0.0.1:3110')
                break
            except (OSError, ValueError, h.CutoverError):
                h.require(time.monotonic() < deadline, 'Mainnet web did not become healthy.')
                time.sleep(2)
        check_assets(release, 'http://127.0.0.1:3110')
        check_web(cfg, 'https://ftiprotocol.com')
        check_assets(release, 'https://ftiprotocol.com')
    except BaseException:
        if changed:
            h.rollback(backup)
        raise


def activate(source):
    cfg = h.load(DEPLOYMENT)
    check_target(cfg)
    h.require(source.is_absolute() and source.resolve() == source, 'Use an absolute source directory.')
    h.require(h.run(['git', '-C', str(source), 'rev-parse', 'HEAD']).strip() == h.REVISION, 'Wrong source revision.')
    h.run(['git', '-C', str(source), 'diff', '--quiet'])
    h.run(['git', '-C', str(source), 'diff', '--cached', '--quiet'])
    saved = h.capture('web')
    previous_config = Path(saved['env']['DEPLOYMENT_FILE'])
    if not previous_config.is_absolute():
        previous_config = Path(saved['properties']['WorkingDirectory']) / previous_config
    if h.load(previous_config).get('mainnetPlanDigest') == DIGEST:
        check_web(cfg, 'https://ftiprotocol.com')
        print('FTI_MAINNET_WEB_ALREADY_ACTIVE; KEEPER_NOT_VERIFIED')
        return
    h.require(not os.path.lexists(h.drop_path('web')), 'Existing mainnet override; inspect or roll back first.')
    # A terminal-only prompt prevents the credential from entering command history.
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        rpc = getpass.getpass('Mainnet HTTPS RPC (hidden): ').strip()
    account = pwd.getpwnam('fti-v3')
    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + str(os.getpid())
    release = Path('/opt/fti/releases/mainnet-web-' + stamp)
    state = Path('/var/lib/fti-continuity/mainnet-web-' + stamp)
    backup = Path('/var/lib/fti-continuity/cutover-backups/mainnet-web-' + stamp)
    env = environment(saved, state, rpc)
    backup.mkdir(parents=True, mode=0o700)
    os.chmod(backup, 0o700)
    for file in ('activate-mainnet-web.py', 'activate-fresh-testnet.py'):
        shutil.copyfile(HERE / file, backup / file)
    h.write(backup / 'web.unit.txt', h.run(['systemctl', 'cat', h.UNITS['web']]))
    h.write(backup / 'web.active-environment.json', json.dumps(saved['env']))
    print('FTI_MAINNET_WEB_BACKUP=' + str(backup), flush=True)
    h.stage_source(source, release, account.pw_gid)
    state.mkdir(mode=0o750)
    os.chmod(state, 0o750)
    os.chown(state, 0, account.pw_gid)
    h.write(state / 'deployment.json', json.dumps(cfg), 0o640)
    h.write(state / 'web.env', h.env_text(env), 0o640)
    for file in state.iterdir():
        os.chown(file, 0, account.pw_gid)
        os.chmod(file, 0o640)
    # Existing verifier checks exact source/build, chain, code hashes and roles.
    # No signer is created: the environment deliberately excludes Keeper keys.
    h.PREFLIGHT = h.PREFLIGHT.replace('97n', '56n').replace('chainId:97', 'chainId:56')
    h.preflight(saved, env, release, account)
    switch(release, state, backup, saved, cfg)
    report = {'result': 'FTI_MAINNET_WEB_ACTIVE', 'chainId': 56, 'token': cfg['token'],
              'binary': cfg['binary'], 'publicHttpsVerified': True, 'keeperActivated': False,
              'browserVerified': False, 'backup': str(backup)}
    h.write(backup / 'result.json', json.dumps(report))
    print(json.dumps(report), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--source', type=Path)
    group.add_argument('--rollback', type=Path)
    args = parser.parse_args()
    h.require(os.geteuid() == 0, 'Run on the FTI VPS as root.')
    os.umask(0o077)
    with open('/run/lock/fti-service-cutover.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        def interrupted(*_):
            raise h.CutoverError('Interrupted.')
        signal.signal(signal.SIGTERM, interrupted)
        signal.signal(signal.SIGHUP, interrupted)
        if args.rollback:
            h.require(args.rollback.resolve().parent == Path('/var/lib/fti-continuity/cutover-backups'), 'Unexpected backup path.')
            h.rollback(args.rollback)
        else:
            activate(args.source)


if __name__ == '__main__':
    try:
        main()
    except (h.CutoverError, KeyboardInterrupt) as error:
        print('FTI_MAINNET_WEB_STOPPED: ' + str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('FTI_MAINNET_WEB_STOPPED: local file/process/network failure; preserve private backup.', file=sys.stderr)
        sys.exit(1)
