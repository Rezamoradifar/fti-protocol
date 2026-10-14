#!/usr/bin/env python3
"""Launch a bounded, resumable test of the already-active FTI testnet release."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

REVISION = 'bc2163070a6e79bcc129a6a788e61c4ace402bdf'
BINARY = '0x40e727e15b65461D52e92907aa96E27017Ea70fE'
STATE = Path('/root/.fti-fresh-journey') / BINARY.lower()
KEY = Path('/root/.fti-private/testnet-deployer.key')
UNIT = 'fti-testnet-journey'
RUNNER_HASH = '644468f66db010e838836bd0d524a92d9e83d806508d9568a0b46535de882c08'


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, text=True, timeout=90, **kwargs)
    require(result.returncode == 0, 'Local preflight failed: ' + Path(args[0]).name)
    return result.stdout


def inspect_service(role):
    unit = 'fti-continuity-' + role + '.service'
    props = dict(line.split('=', 1) for line in run([
        'systemctl', 'show', unit, '--property=ActiveState,MainPID,WorkingDirectory,User'
    ]).splitlines() if '=' in line)
    require(props.get('ActiveState') == 'active' and props.get('User') == 'fti-v3', role + ' service not ready')
    pid = int(props['MainPID'])
    require(pid > 1, 'Invalid service PID')
    proc = Path('/proc') / str(pid)
    env = dict(item.decode().split('=', 1) for item in (proc / 'environ').read_bytes().split(b'\0') if b'=' in item)
    node = (proc / 'exe').resolve(strict=True)
    require(str(node).startswith('/opt/fti/runtime/node-v22.') and node.name == 'node', 'Expected installed Node 22')
    require(run(['systemctl', 'show', unit, '--property=MainPID', '--value']).strip() == str(pid), 'Service restarted; retry')
    return props, env, node


def private_regular(file):
    st = file.lstat()
    require(stat.S_ISREG(st.st_mode) and st.st_uid == 0 and st.st_mode & 0o077 == 0, 'Private root-owned file required: ' + str(file))


def prepare():
    require(os.geteuid() == 0, 'Run as root on the existing FTI server')
    script = Path(__file__).resolve().with_name('fresh-testnet-journey.mjs')
    require(hashlib.sha256(script.read_bytes()).hexdigest() == RUNNER_HASH, 'Test runner hash mismatch')
    web, settings, node = inspect_service('web')
    _, keeper, _ = inspect_service('keeper')
    source = Path(web['WorkingDirectory']).resolve(strict=True)
    require(str(source).startswith('/opt/fti/releases/fresh-bc2163070a6e-'), 'Active web is not the reviewed fresh release')
    deployment = Path(settings['DEPLOYMENT_FILE']).resolve(strict=True)
    cfg = json.loads(deployment.read_text())
    require(cfg.get('chainId') == 97 and cfg.get('sourceRevision') == REVISION and cfg.get('binary', '').lower() == BINARY.lower(), 'Wrong active deployment')
    keeper_cfg = json.loads(Path(keeper['DEPLOYMENT_FILE']).read_text())
    require(keeper_cfg == cfg, 'Keeper and web deployment differ')
    require(settings.get('RPC_URL', '').startswith('https://'), 'Existing HTTPS RPC required')
    require(keeper.get('KEEPER_PRIVATE_KEY'), 'Cannot establish separate Keeper signer')
    private_regular(KEY)
    # Secret input stays on this server and is never a command-line argument.
    code = "import {Wallet} from 'ethers';import fs from 'node:fs';const x=JSON.parse(fs.readFileSync(0,'utf8'));const addr=k=>new Wallet(k.startsWith('0x')?k:'0x'+k).address;console.log(JSON.stringify([addr(x.keeper),addr(x.owner)]));"
    addresses = json.loads(run([str(node), '--input-type=module', '-e', code], cwd=source,
        input=json.dumps({'keeper': keeper['KEEPER_PRIVATE_KEY'], 'owner': KEY.read_text().strip()}),
        env={'PATH': str(node.parent) + ':/usr/bin:/bin'}))
    require(addresses[0].lower() != addresses[1].lower(), 'Use a test funder separate from Keeper; no wallet was changed')
    require(addresses[1].lower() == cfg['deployer'].lower(), 'Wrong test funder')
    env = {'PATH': str(node.parent) + ':/usr/local/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8',
           'FTI_SOURCE_REVISION': REVISION, 'FTI_JOURNEY_SOURCE': str(source),
           'FTI_JOURNEY_DEPLOYMENT': str(deployment), 'FTI_JOURNEY_RPC': settings['RPC_URL'],
           'FTI_JOURNEY_KEY_FILE': str(KEY), 'FTI_JOURNEY_KEEPER_ADDRESS': addresses[0],
           'FTI_JOURNEY_BUDGET': '0.03', 'FTI_JOURNEY_GAS_GWEI': '0.1', 'FTI_JOURNEY_STATE': str(STATE)}
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    require(STATE.lstat().st_uid == 0 and STATE.lstat().st_mode & 0o077 == 0 and not STATE.is_symlink(), 'Unsafe state directory')
    return script, source, node, env, addresses[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--worker', action='store_true')
    args = parser.parse_args()
    script, source, node, env, owner = prepare()
    if args.worker:
        fd = os.open(STATE / 'runner.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        # Keep the kernel lock across exec; crashes release it, never delete journals.
        os.set_inheritable(fd, True)
        os.chdir(source)
        os.execve(str(node), [str(node), str(script)], env)
    status = run(['systemctl', 'show', UNIT + '.service', '--property=ActiveState', '--value']).strip()
    if status in ('active', 'activating'):
        print('FTI_TEST_ALREADY_RUNNING; journalctl -u ' + UNIT + ' -n 30 --no-pager')
        return
    print(json.dumps({'network': 'BNB TESTNET 97', 'source': REVISION, 'binary': BINARY, 'gasFunder': owner,
                      'newTestWallets': 4, 'membershipTestUSD': 800, 'tokenBuyTestUSD': 10,
                      'maximumTotalTestBNB': '0.03', 'maximumGasPriceGwei': '0.1',
                      'includesGasAndWalletFunding': True, 'existingKeeperGasExcluded': True,
                      'waitForRealHourlySettlement': True, 'resumeUsesSamePrivateJournal': True}, indent=2), flush=True)
    print('Existing hourly pool will be shared with eligible test wallets under the deployed rules. No new contracts or service cutover.', flush=True)
    require(input('To run these test transactions, type TEST 97: ').strip() == 'TEST 97', 'Cancelled; no transactions sent')
    run(['systemd-run', '--unit=' + UNIT, '--collect', '--property=Type=exec',
         '--property=UMask=0077', '--property=TimeoutStopSec=150',
         '/usr/bin/python3', str(Path(__file__).resolve()), '--worker'])
    print('FTI_TEST_STARTED; SSH can disconnect safely.')
    print('journalctl -u ' + UNIT + ' -n 40 --no-pager')
    print('PUBLIC_REPORT=' + str(STATE / 'report.json'))
    print('Share report.json only; never journal.json or key files.')


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt) as exc:
        print('FTI_TEST_LAUNCH_STOPPED: ' + (str(exc) if isinstance(exc, RuntimeError) else 'Local preflight/process failure; no secret output displayed.'), file=sys.stderr)
        sys.exit(1)
