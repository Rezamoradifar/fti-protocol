#!/usr/bin/env python3
"""Versioned mainnet workspace overlay; no restart, signer or contract changes."""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import sys
import tempfile

HERE = Path(__file__).resolve().parent


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


g = module('ui_files', 'install-global-frontend.py')
w = module('web_cutover', 'activate-mainnet-web.py')
sha = lambda data: hashlib.sha256(data).hexdigest()


def render(before, prefix):
    text = before.decode()
    g.require(text.count('src="./app.js"') == 1, 'Unexpected installed HTML; preserve existing overlay.')
    text = text.replace('src="./app.js"', 'src="/' + prefix + '/app.js"')
    return text.replace('FTI Protocol testnet workspace.', 'FTI Protocol on-chain workspace.').encode()


def restore(backup):
    record = json.loads(g.regular(backup / 'record.json')[0])
    root = Path(record['root'])
    g.require(root.parent == Path('/opt/fti/releases') and root.resolve() == root, 'Unexpected release path.')
    target = g.child(root, 'web/index.html')
    current, info = g.regular(target)
    g.require(sha(current) == record['after'], 'HTML changed since installation; preserve concurrent edit.')
    before = g.regular(backup / 'before.html')[0]
    g.require(sha(before) == record['before'], 'Backup hash mismatch.')
    g.replace(target, before, info)
    g.require(g.fetch('http://127.0.0.1:3110/app/')[0] == before, 'Restored HTML verification failed.')
    print('FTI_MAINNET_UI_RESTORED')


def apply(source):
    manifest = json.loads((HERE.parent / 'config/mainnet-ui-release.json').read_text())
    for name, expected in manifest['files'].items():
        g.require(sha(g.regular(g.child(source, name))[0]) == expected, 'UI build mismatch: ' + name)
    saved = w.h.capture('web')
    root = Path(saved['properties']['WorkingDirectory'])
    g.require(root.parent == Path('/opt/fti/releases') and root.resolve() == root, 'Unexpected running release.')
    cfg = w.h.http_json('http://127.0.0.1:3110/api/config')
    w.check_target(cfg)
    w.check_web(cfg, 'https://ftiprotocol.com')
    prefix = 'fti-mainnet-ui-' + manifest['files']['web/app.js'][:16]
    target = g.child(root, 'web/index.html')
    before, info = g.regular(target)
    if ('src="/' + prefix + '/app.js"').encode() in before:
        g.require(g.fetch('https://ftiprotocol.com/' + prefix + '/app.js')[0] == (source / 'web/app.js').read_bytes(), 'Installed bundle mismatch.')
        print('FTI_MAINNET_UI_ALREADY_INSTALLED')
        return
    after = render(before, prefix)
    protected = {p: sha(g.regular(root / p)[0]) for p in ('web/app.js', 'scripts/server.mjs', 'web/vendor/walletconnect.js')}
    base = Path('/var/backups/fti-mainnet-ui')
    base.mkdir(mode=0o700, exist_ok=True)
    g.require(not base.is_symlink() and base.stat().st_mode & 0o077 == 0, 'Private backup directory required.')
    backup = Path(tempfile.mkdtemp(prefix='install-', dir=base))
    record = {'root': str(root), 'before': sha(before), 'after': sha(after), 'prefix': prefix,
              'backendSourceRevision': cfg['sourceRevision'], 'protected': protected}
    g.save_new(backup / 'before.html', before)
    g.save_new(backup / 'record.json', json.dumps(record).encode())
    for name in ('apply-mainnet-ui.py', 'install-global-frontend.py', 'activate-mainnet-web.py', 'activate-fresh-testnet.py'):
        shutil.copyfile(HERE / name, backup / name)
    print('ROLLBACK_COMMAND=python3 ' + str(backup / 'apply-mainnet-ui.py') + ' --restore ' + str(backup), flush=True)
    destination = g.child(root, 'web/' + prefix)
    if not destination.exists():
        destination.mkdir(mode=0o755)
        destination.chmod(0o755)
    for name in ('app.js', 'app.js.LEGAL.txt'):
        data = g.regular(source / 'web' / name)[0]
        file = g.child(destination, name)
        if file.exists():
            g.require(g.regular(file)[0] == data, 'Versioned asset already differs.')
        else:
            g.save_new(file, data, 0o644)
        g.require(g.fetch('https://ftiprotocol.com/' + prefix + '/' + name)[0] == data, 'New asset not reachable.')
    changed = False
    try:
        g.require(w.h.properties('web') == saved['properties'], 'Web process changed.')
        g.require(g.regular(target)[0] == before, 'Concurrent HTML edit.')
        g.replace(target, after, info)
        changed = True
        for base_url in ('http://127.0.0.1:3110', 'https://ftiprotocol.com'):
            for route in ('/app/', '/token/', '/admin/'):
                g.require(g.fetch(base_url + route)[0] == after, 'Served HTML mismatch.')
        w.check_web(cfg, 'https://ftiprotocol.com')
        for name, expected in protected.items():
            g.require(sha(g.regular(root / name)[0]) == expected, 'Protected runtime changed.')
    except BaseException:
        if changed:
            restore(backup)
        raise
    print(json.dumps({'result': 'FTI_MAINNET_UI_INSTALLED', 'chainId': 56, 'backup': str(backup),
                      'contractsChanged': False, 'keeperActivated': False, 'frontendBundle': prefix}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--source', type=Path)
    group.add_argument('--restore', type=Path)
    args = parser.parse_args()
    g.require(os.geteuid() == 0, 'Run on the FTI VPS as root.')
    os.umask(0o077)
    with open('/run/lock/fti-service-cutover.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        def interrupted(*_):
            raise RuntimeError('Interrupted.')
        signal.signal(signal.SIGTERM, interrupted)
        signal.signal(signal.SIGHUP, interrupted)
        if args.restore:
            g.require(args.restore.resolve().parent == Path('/var/backups/fti-mainnet-ui'), 'Unexpected backup path.')
            restore(args.restore)
        else:
            apply(args.source.resolve())


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('FTI_MAINNET_UI_STOPPED: build, file or HTTP check failed; preserve private backup.', file=sys.stderr)
        sys.exit(1)
