#!/usr/bin/env python3
"""Verify and replace only FTI's event RPC; preserve sources and mainnet contracts."""
import argparse
import fcntl
import getpass
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import stat
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

HELPER = Path(__file__).absolute().with_name('recover-mainnet-source.py')
spec = importlib.util.spec_from_file_location('fti_source_recovery', HELPER)
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
BACKUPS = Path('/var/backups/fti-event-rpc')
SCHEMA = 'FTI_EVENT_RPC_REPAIR_V1'
PUBLIC_RPC = 'https://bsc-rpc.publicnode.com'
PLACEMENT = '/api/placement?referrer=0xD6492377C2C33047aFE61768930b2aedFF2B2704'
TOPIC = '0x199098452639b249bef6f727bc09ce903cece47ca72a8518bef9367ad39b6de7'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def rpc(url, method, params):
    r.require(method in ('eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getLogs'), 'READ_ONLY_RPC_REQUIRED')
    request = urllib.request.Request(url, r.packed({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}),
                                     {'Content-Type': 'application/json'})
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(request, timeout=12) as response:
            raw = response.read(4_000_001)
        r.require(len(raw) <= 4_000_000, 'RPC_RESPONSE_TOO_LARGE')
        result = json.loads(raw)
    except urllib.error.HTTPError as error:
        raise RuntimeError('RPC_HTTP_' + str(error.code)) from None
    except (OSError, ValueError):
        raise RuntimeError('RPC_UNREACHABLE_OR_INVALID_RESPONSE') from None
    r.require(isinstance(result, dict) and result.get('jsonrpc') == '2.0' and result.get('id') == 1,
              'INVALID_RPC_ENVELOPE')
    if 'error' in result:
        code = result['error'].get('code') if isinstance(result['error'], dict) else None
        raise RuntimeError('RPC_REJECTED_' + str(code) if isinstance(code, int) else 'RPC_REJECTED')
    r.require('result' in result, 'RPC_RESULT_MISSING')
    return result['result']


def valid_url(url):
    if not isinstance(url, str) or len(url) > 4096:
        return False
    try:
        parsed = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    return (parsed.scheme == 'https'
            and parsed.hostname and not parsed.username and not parsed.password and not parsed.fragment
            and not any(ord(c) <= 32 or ord(c) == 127 for c in url))


def env_values(text, initial=None):
    env = dict(initial or {})
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith(('#', ';')):
            continue
        key, separator, value = line.partition('=')
        r.require(separator and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key), 'INVALID_ENVIRONMENT_LINE')
        fields = shlex.split(value)
        r.require(len(fields) <= 1, 'INVALID_ENVIRONMENT_VALUE')
        env[key] = fields[0] if fields else ''
    return env


def candidates(properties, private, supplied=None):
    if supplied is not None:
        r.require(valid_url(supplied), 'HTTPS_RPC_URL_REQUIRED')
        return [('private-input', supplied)]
    env = dict(value.split('=', 1) for value in shlex.split(properties.get('Environment', '')) if '=' in value)
    rows = []
    for index, name in enumerate(r.environment_files(properties.get('EnvironmentFiles', ''))):
        env = env_values(private[name].decode(), env)
        # Reuse original configured providers before trying the public fallback.
        if env.get('EVENT_RPC_URL'):
            rows.append(('configured-events-' + str(index + 1), env['EVENT_RPC_URL']))
        if not env.get('FTI_MAINNET_RPC_FILE'):
            url = env.get('FTI_MAINNET_RPC_URL') or env.get('RPC_URL')
            if url:
                rows.append(('configured-rpc-' + str(index + 1), url))
    rows.append(('publicnode', PUBLIC_RPC))
    selected, seen = [], set()
    for label, url in rows:
        if valid_url(url) and url not in seen:
            selected.append((label, url))
            seen.add(url)
    r.require(len(selected) <= 8, 'TOO_MANY_RPC_CANDIDATES')
    return selected


def hex_number(value):
    r.require(isinstance(value, str) and re.fullmatch(r'0x[0-9a-fA-F]+', value), 'INVALID_RPC_NUMBER')
    return int(value, 16)


def anchor_block():
    head = r.json_get('/health')
    r.require(head.get('ok') is True and head.get('chainId') == 56 and isinstance(head.get('block'), int), 'MAIN_RPC_UNHEALTHY')
    number = max(1, head['block'] - 12)
    anchor = rpc('http://127.0.0.1:3110/rpc', 'eth_getBlockByNumber', [hex(number), False])
    r.require(isinstance(anchor, dict) and hex_number(anchor.get('number')) == number
              and re.fullmatch(r'0x[0-9a-fA-F]{64}', anchor.get('hash', '')), 'INVALID_REFERENCE_BLOCK')
    r.require(0 <= time.time() - hex_number(anchor.get('timestamp')) <= 180, 'MAIN_RPC_STALE')
    return anchor


def verify_provider(url, cfg, anchor):
    r.require(valid_url(url), 'HTTPS_RPC_URL_REQUIRED')
    r.require(hex_number(rpc(url, 'eth_chainId', [])) == 56, 'WRONG_RPC_CHAIN')
    number = hex_number(anchor['number'])
    remote = rpc(url, 'eth_getBlockByNumber', [anchor['number'], False])
    r.require(isinstance(remote, dict) and remote.get('hash') == anchor['hash']
              and remote.get('number') == anchor['number'], 'RPC_BLOCK_DISAGREEMENT')
    start = cfg.get('deployedBlock')
    r.require(isinstance(start, int) and 0 < start <= number, 'INVALID_DEPLOYMENT_BLOCK')
    for first, last in ((start, min(start + 1499, number)), (max(start, number - 1499), number)):
        logs = rpc(url, 'eth_getLogs', [{'address': cfg['binary'], 'topics': [TOPIC],
                                       'fromBlock': hex(first), 'toBlock': hex(last)}])
        r.require(isinstance(logs, list), 'INVALID_LOG_RESPONSE')
        for log in logs:
            r.require(isinstance(log, dict) and log.get('address', '').lower() == cfg['binary'].lower()
                      and isinstance(log.get('topics'), list) and log['topics'][:1] == [TOPIC]
                      and first <= hex_number(log.get('blockNumber')) <= last and not log.get('removed')
                      and re.fullmatch(r'0x[0-9a-fA-F]{64}', log.get('blockHash', ''))
                      and re.fullmatch(r'0x[0-9a-fA-F]{64}', log.get('transactionHash', '')), 'INVALID_FILTERED_LOG')


def identity(properties, private):
    return r.digest(r.packed({'properties': properties, 'files': {k: r.digest(v) for k, v in private.items()}}))


def wait_placement():
    deadline = time.monotonic() + 360
    next_notice = 0
    while time.monotonic() < deadline:
        try:
            result = r.json_get(PLACEMENT, timeout=12)
            if (isinstance(result, dict) and re.fullmatch(r'0x[0-9a-fA-F]{40}', result.get('placementParent', ''))
                    and result.get('side') in ('left', 'right')):
                return True
        except Exception:
            pass
        if time.monotonic() >= next_notice:
            print('FTI_PLACEMENT_HISTORY_WARMING', flush=True)
            next_notice = time.monotonic() + 30
        time.sleep(2)
    return False


def restore(backup):
    backup = r.safe(backup)
    r.require(backup.parent == BACKUPS and backup.is_dir() and backup.stat().st_uid == 0
              and not backup.stat().st_mode & 0o077, 'INVALID_EVENT_RPC_BACKUP')
    record = json.loads(r.read(backup / 'record.json')[0])
    r.require(record.get('schema') == SCHEMA, 'INVALID_EVENT_RPC_RECORD')
    root, _, _, _, current = r.inspect_service()
    r.require(str(root) == record['root'] and current in (record['beforeIdentity'], record['afterIdentity']),
              'CONFIGURATION_CHANGED_NO_RPC_ROLLBACK')
    r.unchanged(root, record['sources'], record['artifacts'], current)
    original = r.read(backup / 'original.env')[0]
    r.require(r.digest(original) == record['beforeEnvHash'], 'BACKUP_CHECKSUM_FAILED')
    r.replace(Path(record['envFile']), original, record['metadata'])
    r.unchanged(root, record['sources'], record['artifacts'], record['beforeIdentity'])
    r.command(['systemctl', 'restart', r.SERVICE])
    r.require(r.wait_health(), 'RPC_ROLLBACK_HEALTH_FAILED')
    r.unchanged(root, record['sources'], record['artifacts'], record['beforeIdentity'])
    print('FTI_PREVIOUS_EVENT_RPC_RESTORED', flush=True)


def apply(url, snapshot, properties):
    root, _, cfg, private, before_identity = snapshot
    sources = r.source_hashes(root)
    artifacts = r.artifact_hashes(root, cfg)
    r.require(r.fingerprint(sources) == r.FINGERPRINT, 'RESTORE_ORIGINAL_SOURCE_FIRST')
    names = r.environment_files(properties.get('EnvironmentFiles', ''))
    r.require(names, 'NO_SERVICE_ENVIRONMENT_FILE')
    target = Path(names[-1])
    original, info = r.read(target)
    r.require(original == private[str(target)] and identity(properties, private) == before_identity,
              'CONFIGURATION_CHANGED_BEFORE_RPC_REPAIR')
    r.require(valid_url(url), 'HTTPS_RPC_URL_REQUIRED')
    encoded = url.replace('\\', '\\\\').replace('"', '\\"')
    content = original + ('\n# Verified FTI event RPC\nEVENT_RPC_URL="' + encoded + '"\n').encode()
    updated_private = dict(private, **{str(target): content})
    after_identity = identity(properties, updated_private)
    r.safe(BACKUPS).mkdir(mode=0o700, parents=True, exist_ok=True)
    r.require(BACKUPS.stat().st_uid == 0 and not BACKUPS.stat().st_mode & 0o077, 'UNSAFE_EVENT_BACKUP_DIRECTORY')
    backup = Path(tempfile.mkdtemp(prefix='repair-', dir=BACKUPS))
    metadata = {'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid, 'gid': info.st_gid}
    record = {'schema': SCHEMA, 'root': str(root), 'envFile': str(target), 'beforeEnvHash': r.digest(original),
              'beforeIdentity': before_identity, 'afterIdentity': after_identity, 'metadata': metadata,
              'sources': sources, 'artifacts': artifacts,
              'privateFiles': {name: index for index, name in enumerate(private)}}
    r.save(backup / 'original.env', original)
    r.save(backup / 'record.json', r.packed(record))
    for name, index in record['privateFiles'].items():
        r.save(backup / 'private' / str(index), private[name])
    for file in (Path(__file__).absolute(), HELPER):
        r.save(backup / file.name, r.read(file)[0])
    r.require(r.digest(r.read(backup / 'original.env')[0]) == record['beforeEnvHash'], 'BACKUP_CHECKSUM_FAILED')
    print('BACKUP=' + str(backup), flush=True)
    print('ROLLBACK=python3 ' + str(backup / Path(__file__).name) + ' --restore ' + str(backup), flush=True)
    r.unchanged(root, sources, artifacts, before_identity)
    try:
        r.replace(target, content, metadata)
        r.unchanged(root, sources, artifacts, after_identity)
        print('FTI_RESTARTING_WEB_FOR_EVENT_RPC', flush=True)
        r.command(['systemctl', 'restart', r.SERVICE])
        r.require(r.wait_health(), 'WEB_HEALTH_FAILED')
        r.unchanged(root, sources, artifacts, after_identity)
        r.require(wait_placement(), 'PLACEMENT_NOT_READY_AFTER_RPC_CHANGE')
        r.unchanged(root, sources, artifacts, after_identity)
    except BaseException:
        try:
            restore(backup)
        except BaseException:
            print('RPC_ROLLBACK_INCOMPLETE_INSPECT_BACKUP=' + str(backup), flush=True)
        raise
    print(json.dumps({'result': 'FTI_EVENT_RPC_AND_PLACEMENT_READY', 'backup': str(backup),
                      'contractsChanged': False, 'sourceChanged': False, 'mainRpcChanged': False,
                      'keeperChanged': False, 'walletSigningTested': False}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument('--apply', action='store_true')
    action.add_argument('--restore', type=Path)
    parser.add_argument('--private-rpc', action='store_true', help='Read a private HTTPS URL securely from the terminal')
    args = parser.parse_args()
    r.require(os.geteuid() == 0, 'RUN_AS_ROOT_ON_FTI_SERVER')
    os.umask(0o077)
    fd = os.open(r.safe(Path('/run/lock/fti-service-cutover.lock')), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.restore:
            restore(args.restore)
            return
        snapshot = r.inspect_service()
        root, _, cfg, private, current_identity = snapshot
        _, _, changes = r.plan(root, cfg)
        r.require(not changes, 'RESTORE_ORIGINAL_SOURCE_FIRST')
        properties = r.properties()
        r.require(identity(properties, private) == current_identity, 'CONFIGURATION_CHANGED_DURING_INSPECTION')
        supplied = getpass.getpass('BNB mainnet HTTPS RPC (hidden): ') if args.private_rpc else None
        anchor = anchor_block()
        selected = None
        for label, url in candidates(properties, private, supplied):
            print('RPC_PROBE=' + label, flush=True)
            try:
                verify_provider(url, cfg, anchor)
            except RuntimeError as error:
                print('RPC_REJECTED=' + label + ':' + str(error), flush=True)
                continue
            print('RPC_VERIFIED=' + label + ':CHAIN_56_AND_1500_BLOCK_LOGS', flush=True)
            selected = url
            break
        r.require(selected, 'NO_USABLE_LOG_RPC_NO_CHANGES_PRIVATE_RPC_REQUIRED')
        if args.apply:
            apply(selected, snapshot, properties)
        else:
            print('FTI_EVENT_RPC_CHECK_ONLY_NO_CHANGES', flush=True)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('FTI_EVENT_RPC_INTERRUPTED', flush=True)
        raise SystemExit(130)
    except Exception as error:
        print('FTI_EVENT_RPC_STOPPED:' + (str(error) if isinstance(error, RuntimeError) else type(error).__name__), flush=True)
        raise SystemExit(1)
