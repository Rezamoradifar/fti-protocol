#!/usr/bin/env python3
"""Interactive VPS runner for NEW FTI contracts on BNB public TESTNET 97 only.

Uses pinned, previously tested fresh-testnet.mjs. Never reads old deployment,
.env, council keys or server settings. No service changes, migration or mainnet.
Signing requires an operator-selected local private key file and plan consent.
"""
import argparse
import fcntl
import getpass
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

BASE_REV = 'bc2163070a6e79bcc129a6a788e61c4ace402bdf'
PREP_SHA256 = 'e396c543fd10afc742304bfce6e6be85a9cb633348c59d5d0425b17f168d6482'
DEFAULT_RPC = 'https://bsc-testnet-dataseed.bnbchain.org'
PREP_URL = ('https://raw.githubusercontent.com/Rezamoradifar/fti-protocol/'
            + BASE_REV + '/tools/prepare-fresh-testnet.sh')
ALLOWED_RPC = {'eth_chainId', 'eth_getBalance', 'eth_gasPrice', 'eth_getTransactionCount'}


class SetupError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise SetupError(message)


def public_address(value):
    require(isinstance(value, str) and re.fullmatch(r'0x[0-9a-fA-F]{40}', value)
            and int(value, 16) != 0, 'Enter a nonzero public 0x wallet address.')
    return value


def council_addresses(values):
    require(isinstance(values, list) and len(values) == 7,
            'Exactly seven public council addresses are required.')
    result = [public_address(v) for v in values]
    require(len({v.lower() for v in result}) == 7, 'Council addresses must be distinct.')
    return result


def atomic_units(value, decimals):
    # Decimal-string conversion only: never binary float or exponent notation.
    require(isinstance(value, str) and len(value) <= 80
            and re.fullmatch(r'(0|[1-9][0-9]*)(\.[0-9]+)?', value),
            'Enter a positive decimal amount without commas or exponent notation.')
    whole, _, fractional = value.partition('.')
    require(len(fractional) <= decimals, 'Too many decimal places.')
    number = int(whole) * 10 ** decimals + int((fractional + '0' * decimals)[:decimals] or '0')
    require(0 < number < 2 ** 256, 'Amount must be positive and within uint256.')
    return number


def decimal_units(number, decimals=18):
    whole, remainder = divmod(number, 10 ** decimals)
    return str(whole) + ('.' + str(remainder).zfill(decimals).rstrip('0') if remainder else '')


def rpc_url(value):
    require(isinstance(value, str) and len(value) <= 4096
            and not re.search(r'[\x00-\x20\x7f]', value), 'Invalid HTTPS RPC address.')
    u = urllib.parse.urlsplit(value)
    require(u.scheme == 'https' and u.hostname and not u.username and not u.password
            and not u.fragment, 'Use an HTTPS RPC endpoint without embedded login credentials.')
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise SetupError('Redirect refused; check the endpoint.')


def request_bytes(url, payload=None, limit=100_000):
    client = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    headers = {'User-Agent': 'FTI-Fresh-Testnet-Runner/1', 'Cache-Control': 'no-cache'}
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=payload, headers=headers)
    try:
        with client.open(req, timeout=30) as response:
            require(response.status == 200, 'Network request failed.')
            data = response.read(limit + 1)
        require(len(data) <= limit, 'Network response exceeded the size limit.')
        return data
    except SetupError:
        raise
    except Exception:
        # Provider exceptions can contain credential-bearing URLs.
        raise SetupError('RPC/download failed. Check the endpoint locally; do not post credentials.') from None


def rpc(endpoint, method, params):
    require(method in ALLOWED_RPC, 'This preflight supports read-only RPC methods only.')
    body = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode()
    result = json.loads(request_bytes(endpoint, body))
    value = result.get('result') if isinstance(result, dict) else None
    require(isinstance(result, dict) and result.get('id') == 1 and not result.get('error')
            and isinstance(value, str) and re.fullmatch(r'0x[0-9a-fA-F]+', value),
            'Incomplete RPC response.')
    return int(value, 16)


def read_preflight(endpoint, deployer, budget, ceiling):
    require(rpc(endpoint, 'eth_chainId', []) == 97,
            'STOP: this runner accepts BNB TESTNET chain 97 only, never mainnet.')
    balance = rpc(endpoint, 'eth_getBalance', [deployer, 'latest'])
    price = rpc(endpoint, 'eth_gasPrice', [])
    latest = rpc(endpoint, 'eth_getTransactionCount', [deployer, 'latest'])
    pending = rpc(endpoint, 'eth_getTransactionCount', [deployer, 'pending'])
    require(latest == pending, 'Resolve pending transactions before a fresh deployment.')
    require(price > 0 and price <= ceiling, 'Current gas price exceeds your selected ceiling.')
    require(balance >= budget, 'Test wallet balance is below your selected TOTAL gas budget.')
    return {'chainId': 97, 'balanceWei': str(balance), 'gasPriceWei': str(price), 'nonce': latest}


def check_key_path(value):
    p = Path(value).expanduser()
    require(p.is_absolute(), 'Supply the absolute path to a local private key file, not the key itself.')
    for item in [p, *p.parents]:
        require(not item.is_symlink(), 'Symlink key paths are not accepted.')
    info = p.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
            and info.st_uid == os.geteuid() and (info.st_mode & 0o077) == 0
            and 64 <= info.st_size <= 128,
            'Key file must be private (0600 or 0400), owned by this user, with a single raw key.')
    return p


def private_dir(path):
    require(path.is_absolute() and all(not p.is_symlink() for p in [path, *path.parents]),
            'Private output path must not contain symlinks.')
    path.mkdir(mode=0o700, exist_ok=True)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
            and info.st_mode & 0o077 == 0, 'Output directory must be private and owned by this user.')
    return path


def write_new(path, value):
    data = value if isinstance(value, bytes) else (json.dumps(value, indent=2) + '\n').encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    folder = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(folder)
    finally:
        os.close(folder)


def clean_environment(home, node, endpoint=None):
    env = {'HOME': str(home), 'TMPDIR': str(home / 'tmp'),
           'PATH': str(node.parent) + ':/usr/local/bin:/usr/bin:/bin',
           'LANG': 'C.UTF-8', 'CI': '1', 'NO_COLOR': '1', 'GIT_TERMINAL_PROMPT': '0'}
    if endpoint is not None:
        env['FTI_FRESH_RPC_URL'] = endpoint
    return env


def run_checked(args, cwd, env, timeout, log=None):
    if log is not None:
        with log.open('ab') as stream:
            p = subprocess.run(args, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                               stdout=stream, stderr=subprocess.STDOUT, timeout=timeout)
    else:
        p = subprocess.run(args, cwd=cwd, env=env, stdin=subprocess.DEVNULL, timeout=timeout)
    require(p.returncode == 0, 'Stage failed. Preserve the logs and any deployment journal; do not blindly retry.')


def select_node(explicit=None):
    arch = {'x86_64': 'x64', 'aarch64': 'arm64'}.get(platform.machine(), '')
    known = Path('/opt/fti/runtime/node-v22.23.3-' + arch + '/bin/node')
    selected = explicit or (str(known) if known.is_file() else shutil.which('node'))
    require(selected, 'Node 22+ is required; --node accepts its absolute executable path.')
    p = Path(selected)
    require(p.is_absolute() and p.name == 'node' and p.is_file() and os.access(p, os.X_OK),
            'Invalid Node executable path.')
    return p


def deploy_command(node, out, digest, keyfile, budget, ceiling):
    require(re.fullmatch(r'[a-f0-9]{64}', digest), 'Invalid reviewed plan digest.')
    return [str(node), 'scripts/fresh-testnet.mjs', 'deploy', '--out', str(out),
            '--send', '--confirm-plan', digest, '--key-file', str(keyfile),
            '--max-fee-wei', str(budget), '--max-gas-price-wei', str(ceiling), '--confirmations', '2']


def confirm_and_deploy(answer, digest, marker, out, node, keyfile, budget, ceiling, root, env):
    require(answer == 'DEPLOY 97 ' + digest, 'Cancelled: confirmation did not match the reviewed testnet plan.')
    # This marker deliberately survives every subsequent outcome, even SIGKILL.
    write_new(marker, {'planDigest': digest, 'out': str(out), 'source': str(root),
                       'note': 'Do not delete this marker and repeat; inspect the deployment journal first.'})
    run_checked(deploy_command(node, out, digest, keyfile, budget, ceiling), root, env, 1800)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node', help='Absolute Node 22+ executable; does not replace the service runtime.')
    args = parser.parse_args(argv)
    require(sys.stdin.isatty(), 'Run interactively in the server terminal, not curl | python or a heredoc.')
    os.umask(0o077)
    base = private_dir(Path.home() / 'fti-fresh-testnet-runner')
    # A new reviewed release gets its own one-shot journal. Old runs remain intact.
    base = private_dir(base / BASE_REV)
    lock = os.open(base / 'runner.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        marker = base / 'deployment-requested.json'
        require(not marker.exists(), 'A deployment was already requested. Inspect deployment-requested.json and its journal; no automatic repeat.')
        print('BNB TESTNET 97 ONLY — new contracts; no old users/funds imported.', flush=True)
        print('REVIEWED_SOURCE=' + BASE_REV, flush=True)
        print('Needs a test-gas wallet and seven explicitly chosen public council addresses.')
        print('Never paste a private key here. Only the PATH of its protected local file is requested.')
        endpoint = rpc_url(getpass.getpass('Testnet HTTPS RPC (hidden; Enter = official public endpoint): ') or DEFAULT_RPC)
        deployer = public_address(input('Public deployer address (0x...): ').strip())
        partners = council_addresses([input('Public council address ' + str(i + 1) + '/7: ').strip() for i in range(7)])
        keyfile = check_key_path(input('Absolute PRIVATE KEY FILE PATH (not the key): ').strip())
        budget = atomic_units(input('Approved TOTAL gas budget in tBNB (decimal; no default): ').strip(), 18)
        ceiling = atomic_units(input('Approved maximum gas price in gwei (decimal; no default): ').strip(), 9)
        require(input('Type TEST-GENESIS to accept 31 NEW unpurchased test positions: ').strip() == 'TEST-GENESIS',
                '31-position test bootstrap not accepted; nothing deployed.')
        print(json.dumps(read_preflight(endpoint, deployer, budget, ceiling), indent=2), flush=True)
        node = select_node(args.node)
        work = Path(tempfile.mkdtemp(prefix='run-', dir=base))
        (work / 'tmp').mkdir(mode=0o700)
        env = clean_environment(work, node)
        require(int(subprocess.check_output([str(node), '-p', 'process.versions.node.split(".")[0]'],
                                            env=env, timeout=10).strip()) >= 22, 'Node 22+ required.')
        prep = request_bytes(PREP_URL)
        require(hashlib.sha256(prep).hexdigest() == PREP_SHA256, 'Pinned preparation script hash mismatch.')
        prep_file = work / 'prepare-fresh-testnet.sh'
        write_new(prep_file, prep)
        candidates = work / 'candidates'
        candidates.mkdir(mode=0o700)
        env.update(FTI_NODE_BINARY=str(node), FTI_FRESH_CANDIDATE_ROOT=str(candidates))
        log = work / 'prepare.log'
        print('FTI_PREPARE_LOG=' + str(log), flush=True)
        print('Building and testing the pinned release in a NEW private directory. Keep this session open.', flush=True)
        run_checked(['/bin/bash', str(prep_file), BASE_REV], work, env, 5400, log)
        entries = list(candidates.iterdir())
        require(len(entries) == 1, 'Unexpected preparation directory count.')
        candidate = entries[0]
        result = json.loads((candidate / 'result.json').read_text())
        require(result.get('commit') == BASE_REV and result.get('result') == 'CANDIDATE_PREPARED'
                and result.get('exitCode') == 0, 'Preparation did not pass.')
        root = candidate / 'source'
        env = clean_environment(work, node, endpoint)
        head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, env=env, timeout=10).decode().strip()
        require(head == BASE_REV, 'Checkout identity changed.')
        run_checked(['git', 'diff', '--exit-code', 'HEAD', '--'], root, env, 15)
        # Local derivation only; never print/store the key or collect council keys.
        probe = '''import {Wallet} from 'ethers';
import {readPrivateKey} from './scripts/address-migration-policy.mjs';
try { console.log(new Wallet(readPrivateKey(process.argv[1])).address); }
catch { console.error('KEY_FILE_INVALID'); process.exitCode=1; }'''
        address = subprocess.check_output([str(node), '--input-type=module', '-e', probe, str(keyfile)],
                                         cwd=root, env=env, timeout=15, stderr=subprocess.DEVNULL).decode().strip()
        require(address.lower() == deployer.lower(), 'Selected key file does not match the reviewed deployer address.')
        dao = work / 'new-council.json'
        write_new(dao, {'threshold': 5, 'partners': partners})
        out = work / 'deployment'
        run_checked([str(node), 'scripts/fresh-testnet.mjs', 'plan', '--chain', '97', '--deployer', deployer,
                     '--dao-file', str(dao), '--test-genesis', '--out', str(out)], root, env, 300)
        plan = json.loads((out / 'plan.json').read_text())
        digest = plan.get('digest', '')
        require(re.fullmatch(r'[a-f0-9]{64}', digest) and plan.get('chainId') == 97
                and plan.get('deployer', '').lower() == deployer.lower()
                and [p.lower() for p in plan.get('partners', [])] == [p.lower() for p in partners]
                and len(plan.get('transactions', [])) == 8, 'Unexpected plan; no send.')
        print(json.dumps({'planFile': str(out / 'plan.json'), 'chainId': 97, 'deployer': deployer,
                          'newCouncil': partners, 'bootstrapPositions': 31, 'importedUsers': 0,
                          'predictedAddresses_NOT_DEPLOYED': plan['addresses'], 'planDigest': digest,
                          'maximumGasBudget_tBNB': decimal_units(budget),
                          'maximumGasPrice_gwei': decimal_units(ceiling, 9)}, indent=2), flush=True)
        print('Eight separate transactions: an interruption can leave PARTIAL new contracts and spent test gas.')
        print('Review the full plan file above. Old sites/contracts stay unchanged; no automatic service cutover.')
        print('To send, type exactly: DEPLOY 97 ' + digest, flush=True)
        answer = input('Confirmation (anything else cancels): ').strip()
        check_key_path(str(keyfile))
        read_preflight(endpoint, deployer, budget, ceiling)
        print('FTI_DEPLOYMENT_JOURNAL=' + str(out / 'journal.jsonl'), flush=True)
        confirm_and_deploy(answer, digest, marker, out, node, keyfile, budget, ceiling, root, env)
        final = json.loads((out / 'result.json').read_text())
        require(final.get('result') == 'FTI_FRESH_TESTNET_DEPLOYED' and final.get('chainId') == 97
                and final.get('sourceRevision') == BASE_REV and final.get('importedUsers') == 0
                and final.get('poolDistributionVersion') == 1
                and final.get('rewardModel') == 'hourly-global-pool-v2',
                'No verified deployment result; preserve the journal.')
        print('VERIFIED_RESULT=' + str(out / 'result.json'), flush=True)
        print('Keep the source checkout and private output. Share ONLY result.json, never test-genesis-keys.json.', flush=True)
    finally:
        os.close(lock)


if __name__ == '__main__':
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print('\nSTOPPED. Preserve any deployment journal and do not blindly repeat.', file=sys.stderr)
        sys.exit(130)
    except SetupError as error:
        print('FTI_TESTNET_RUNNER_STOPPED: ' + str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('FTI_TESTNET_RUNNER_STOPPED: local file, process or network error. Preserve logs; do not share secrets.', file=sys.stderr)
        sys.exit(1)
