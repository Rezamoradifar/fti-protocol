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
import subprocess
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
# Independently published services, tested once using the deployed SDK.
# A Python-only rejection did not establish the active Node client's access.
PUBLIC_CANDIDATES = (
    ('publicnode-node', PUBLIC_RPC),
    ('nodies-public', 'https://bsc-pokt.nodies.app/'),
    ('drpc-public', 'https://bsc.drpc.org'),
    ('1rpc-public', 'https://public.1rpc.io/bnb'),
)
PLACEMENT = '/api/placement?referrer=0xD6492377C2C33047aFE61768930b2aedFF2B2704'
TOPIC = '0x199098452639b249bef6f727bc09ce903cece47ca72a8518bef9367ad39b6de7'
READ_METHODS = ('eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getLogs')
# The active web server uses this ethers HTTP transport. Keep credentials on
# stdin, run as the service user, and never add this helper to hashed sources.
NODE_RPC = r'''
import fs from 'node:fs';
import { FetchRequest } from 'ethers';
let fault = 'RPC_UNREACHABLE_OR_INVALID_RESPONSE';
try {
  const {url, payload} = JSON.parse(fs.readFileSync(0, 'utf8'));
  const address = new URL(url);
  if (address.protocol !== 'https:' || address.username || address.password || address.hash ||
      !['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getLogs'].includes(payload.method)) {
    fault = 'READ_ONLY_HTTPS_RPC_REQUIRED';
    throw new Error('stopped');
  }
  const request = new FetchRequest(url);
  request.timeout = 12000;
  request.body = JSON.stringify(payload);
  request.setHeader('content-type', 'application/json');
  request.setThrottleParams({maxAttempts: 1});
  request.retryFunc = async () => false;
  const getUrl = request.getUrlFunc;
  request.getUrlFunc = async (outgoing, signal) => {
    if (outgoing.url !== url || outgoing.method !== 'POST') {
      fault = 'RPC_REDIRECT_REJECTED';
      throw new Error('stopped');
    }
    const result = await getUrl(outgoing, signal);
    if (result.statusCode >= 300 && result.statusCode < 400) {
      fault = 'RPC_REDIRECT_REJECTED';
      throw new Error('stopped');
    }
    if ((result.body?.length ?? 0) > 4000000) {
      fault = 'RPC_RESPONSE_TOO_LARGE';
      throw new Error('stopped');
    }
    return result;
  };
  const response = await request.send();
  let envelope = null;
  try { envelope = response.bodyJson; } catch {}
  process.stdout.write(JSON.stringify({http: response.statusCode, envelope}));
} catch {
  process.stdout.write(JSON.stringify({clientError: fault}));
}
'''


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def rpc(url, method, params):
    r.require(method in READ_METHODS, 'READ_ONLY_RPC_REQUIRED')
    request = urllib.request.Request(url, r.packed({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}),
                                     {'Content-Type': 'application/json'})
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(request, timeout=12) as response:
            raw = response.read(4_000_001)
        r.require(len(raw) <= 4_000_000, 'RPC_RESPONSE_TOO_LARGE')
        result = json.loads(raw)
    except urllib.error.HTTPError as error:
        raise RuntimeError('RPC_HTTP_' + str(error.code) + ':' + method) from None
    except (OSError, ValueError):
        raise RuntimeError('RPC_UNREACHABLE_OR_INVALID_RESPONSE:' + method) from None
    return rpc_result(result, method)


def rpc_result(result, method):
    r.require(isinstance(result, dict) and result.get('jsonrpc') == '2.0' and result.get('id') == 1,
              'INVALID_RPC_ENVELOPE')
    if 'error' in result:
        code = result['error'].get('code') if isinstance(result['error'], dict) else None
        raise RuntimeError(('RPC_REJECTED_' + str(code) if isinstance(code, int) else 'RPC_REJECTED') + ':' + method)
    r.require('result' in result, 'RPC_RESULT_MISSING')
    return result['result']


def failure_detail(envelope):
    # Classify only known error text; never print arbitrary upstream messages.
    error = envelope.get('error', envelope) if isinstance(envelope, dict) else {}
    if not isinstance(error, dict):
        return ''
    code = error.get('code')
    suffix = ':CODE=' + str(code) if type(code) is int else ''
    message = error.get('message')
    if not isinstance(message, str):
        return suffix
    message = re.sub(r'https?://\S+', '', message[:4096]).lower()
    reasons = (
        ('HISTORICAL_DATA_RESTRICTED', r'archive|historical|pruned|history.*unavailable'),
        ('BLOCK_RANGE_LIMIT', r'block.{0,20}range|range.{0,20}(limit|exceed|maximum)'),
        ('AUTHENTICATION_REQUIRED', r'api.?key|unauthori[sz]ed|authentication|access.?token'),
        ('RATE_LIMIT', r'rate.?limit|too many requests'),
    )
    for name, pattern in reasons:
        if re.search(pattern, message):
            return suffix + ':DETAIL=' + name
    return suffix


def safe_error_message(envelope, url):
    error = envelope.get('error', envelope) if isinstance(envelope, dict) else None
    message = error.get('message') if isinstance(error, dict) else error
    if not isinstance(message, str):
        return ''
    parsed = urllib.parse.urlsplit(url)
    secrets = {url, urllib.parse.unquote(url), parsed.path, urllib.parse.unquote(parsed.path)}
    secrets.update(urllib.parse.unquote(part) for part in parsed.path.split('/'))
    secrets.update(value for _, value in urllib.parse.parse_qsl(parsed.query))
    for secret in sorted((value for value in secrets if len(value) >= 8), key=len, reverse=True):
        message = message.replace(secret, '[REDACTED]')
    message = re.sub(r'(?:https?|wss?)://\S+', '[URL]', message)
    message = re.sub(r'\b[A-Za-z0-9_+/=-]{24,}\b', '[REDACTED]', message)
    message = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', ' ', message)
    return ' '.join(message.split())[:500]


def runtime_rpc(root, node, url, method, params, explain=False):
    r.require(method in READ_METHODS, 'READ_ONLY_RPC_REQUIRED')
    r.require(valid_url(url), 'HTTPS_RPC_URL_REQUIRED')
    payload = {'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}
    try:
        result = subprocess.run(
            [node, '--input-type=module', '--eval', NODE_RPC],
            input=r.packed({'url': url, 'payload': payload}), cwd=root,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=18,
            env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'},
            user='fti-v3', group='fti-v3', extra_groups=[])
        r.require(result.returncode == 0 and len(result.stdout) <= 4_001_024, 'RPC_RUNTIME_CLIENT_FAILED')
        packet = json.loads(result.stdout)
    except (OSError, ValueError, subprocess.SubprocessError):
        raise RuntimeError('RPC_RUNTIME_CLIENT_FAILED:' + method) from None
    r.require(isinstance(packet, dict), 'INVALID_RUNTIME_RPC_RESPONSE')
    if 'clientError' in packet:
        allowed = ('RPC_UNREACHABLE_OR_INVALID_RESPONSE', 'READ_ONLY_HTTPS_RPC_REQUIRED',
                   'RPC_REDIRECT_REJECTED', 'RPC_RESPONSE_TOO_LARGE')
        code = packet['clientError'] if packet['clientError'] in allowed else 'RPC_RUNTIME_CLIENT_FAILED'
        raise RuntimeError(code + ':' + method)
    status = packet.get('http')
    r.require(type(status) is int and 100 <= status <= 599, 'INVALID_RUNTIME_HTTP_STATUS')
    envelope = packet.get('envelope')
    message = safe_error_message(envelope, url) if explain else ''
    explanation = ':MESSAGE=' + json.dumps(message, ensure_ascii=True) if message else ''
    if status != 200:
        raise RuntimeError('RPC_HTTP_' + str(status) + ':' + method + failure_detail(envelope) + explanation)
    if isinstance(envelope, dict) and 'error' in envelope:
        # Keep the original error code while adding only a fixed diagnostic category.
        try:
            return rpc_result(envelope, method)
        except RuntimeError as error:
            raise RuntimeError(str(error) + failure_detail(envelope) + explanation) from None
    return rpc_result(envelope, method)


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


def candidates(properties, private, supplied=None, public_only=False):
    if public_only:
        r.require(supplied is None, 'CHOOSE_PUBLIC_OR_PRIVATE_RPC')
        return list(PUBLIC_CANDIDATES)
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


def verify_provider(url, cfg, anchor, call=None):
    query = call or rpc
    r.require(valid_url(url), 'HTTPS_RPC_URL_REQUIRED')
    r.require(hex_number(query(url, 'eth_chainId', [])) == 56, 'WRONG_RPC_CHAIN')
    number = hex_number(anchor['number'])
    remote = query(url, 'eth_getBlockByNumber', [anchor['number'], False])
    r.require(isinstance(remote, dict) and remote.get('hash') == anchor['hash']
              and remote.get('number') == anchor['number'], 'RPC_BLOCK_DISAGREEMENT')
    start = cfg.get('deployedBlock')
    r.require(isinstance(start, int) and 0 < start <= number, 'INVALID_DEPLOYMENT_BLOCK')
    for first, last in ((start, min(start + 1499, number)), (max(start, number - 1499), number)):
        logs = query(url, 'eth_getLogs', [{'address': cfg['binary'], 'topics': [TOPIC],
                                       'fromBlock': hex(first), 'toBlock': hex(last)}])
        r.require(isinstance(logs, list), 'INVALID_LOG_RESPONSE')
        for log in logs:
            r.require(isinstance(log, dict) and log.get('address', '').lower() == cfg['binary'].lower()
                      and isinstance(log.get('topics'), list) and log['topics'][:1] == [TOPIC]
                      and first <= hex_number(log.get('blockNumber')) <= last and not log.get('removed')
                      and re.fullmatch(r'0x[0-9a-fA-F]{64}', log.get('blockHash', ''))
                      and re.fullmatch(r'0x[0-9a-fA-F]{64}', log.get('transactionHash', '')), 'INVALID_FILTERED_LOG')


def diagnose_single_blocks(url, cfg, anchor, call):
    # These observations never satisfy the 1,500-block deployment preflight.
    for label, number in (('HISTORICAL_SINGLE_BLOCK', cfg['deployedBlock']),
                          ('RECENT_SINGLE_BLOCK', hex_number(anchor['number']))):
        try:
            logs = call(url, 'eth_getLogs', [{'address': cfg['binary'], 'topics': [TOPIC],
                                            'fromBlock': hex(number), 'toBlock': hex(number)}])
            r.require(isinstance(logs, list), 'INVALID_LOG_RESPONSE')
            print('RPC_DIAGNOSTIC=' + label + ':READ_OK_LOG_COUNT=' + str(len(logs)), flush=True)
        except RuntimeError as error:
            print('RPC_DIAGNOSTIC=' + label + ':' + str(error), flush=True)
            if re.search(r'RPC_HTTP_(401|403|429)|AUTHENTICATION_REQUIRED|RATE_LIMIT|RPC_REJECTED_-32001', str(error)):
                break


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
    action.add_argument('--diagnose-rpc', action='store_true', help='Check only and show sanitized upstream error messages; never apply configuration')
    provider = parser.add_mutually_exclusive_group()
    provider.add_argument('--private-rpc', action='store_true', help='Read an HTTPS URL securely from the terminal')
    provider.add_argument('--public-rpcs', action='store_true', help='Test independent public providers from this VPS without prompting')
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
        root, node, cfg, private, current_identity = snapshot
        _, _, changes = r.plan(root, cfg)
        r.require(not changes, 'RESTORE_ORIGINAL_SOURCE_FIRST')
        properties = r.properties()
        r.require(identity(properties, private) == current_identity, 'CONFIGURATION_CHANGED_DURING_INSPECTION')
        supplied = getpass.getpass('BNB mainnet HTTPS RPC (hidden): ') if args.private_rpc else None
        anchor = anchor_block()
        def query(url, method, params):
            return runtime_rpc(root, node, url, method, params, explain=args.diagnose_rpc)
        print('RPC_CLIENT=ACTIVE_NODE_ETHERS_TRANSPORT', flush=True)
        if args.diagnose_rpc:
            print('FTI_RPC_DIAGNOSTIC_ONLY_NO_CHANGES', flush=True)
        selected = None
        for label, url in candidates(properties, private, supplied, public_only=args.public_rpcs):
            print('RPC_PROBE=' + label, flush=True)
            try:
                verify_provider(url, cfg, anchor, call=query)
            except RuntimeError as error:
                print('RPC_REJECTED=' + label + ':' + str(error), flush=True)
                if (args.diagnose_rpc and supplied is not None and 'RPC_REJECTED_-32000:eth_getLogs' in str(error)
                        and not re.search(r'not supported|unsupported|disabled|not available|denied|forbidden|quota|usage limit|rate.?limit', str(error), re.I)):
                    diagnose_single_blocks(url, cfg, anchor, query)
                continue
            print('RPC_VERIFIED=' + label + ':CHAIN_56_AND_1500_BLOCK_LOGS', flush=True)
            selected = url
            break
        r.require(selected, 'RPC_DIAGNOSTIC_FAILED_NO_CHANGES' if args.diagnose_rpc
                  else 'NO_USABLE_PUBLIC_LOG_RPC_NO_CHANGES' if args.public_rpcs
                  else 'NO_USABLE_LOG_RPC_NO_CHANGES_PRIVATE_RPC_REQUIRED')
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
