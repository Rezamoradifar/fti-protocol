#!/usr/bin/env python3
"""Package the member workspace, or preflight/apply/restore the packaged version on the FTI VPS."""
import argparse
import contextlib
import fcntl
import gzip
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

BASE = '/fti-panel-completion-13aa86ae47e035b4e23f/'
REFERRAL = '/fti-referral-c6abd61ddf79782e795c2484/referral-context.js'
BACKUPS = Path('/var/backups/fti-member-workspace')
LOCK = '/run/lock/fti-service-cutover.lock'
FILES = ('app.js', 'app.js.LEGAL.txt', 'app.css', 'global-interface.css',
         'member-reserve-panel.css', 'vendor/ethers.js', 'vendor/walletconnect.js',
         'vendor/walletconnect.js.LEGAL.txt')
ROUTES = ('/app/', '/token/', '/admin/')


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def entry_html(before, name):
    html = before.decode()
    for old, new in [(BASE + 'entry.js', f'/{name}/entry.js'),
                     (BASE + 'global-interface.css', f'/{name}/global-interface.css'),
                     (BASE + 'theme.css"', f'/{name}/member-reserve-panel.css"><link rel="stylesheet" href="/{name}/app.css"')]:
        require(html.count(old) == 1, 'Unexpected workspace entry or stylesheet')
        html = html.replace(old, new)
    return html.encode()


def pack(root, baseline, output):
    web = root / 'web'
    assets = {key: (web / key).read_bytes() for key in FILES}
    for asset in re.findall(rb'url\(["\']?(\./assets/[a-zA-Z0-9_.-]+)', assets['member-reserve-panel.css']):
        key = asset.decode().removeprefix('./')
        assets[key] = (web / key).read_bytes()
    assets['entry.js'] = (f"import {{installReferralContext}} from '{REFERRAL}';\n"
                          "installReferralContext(window);\nawait import('./app.js');\n").encode()
    hashes = {key: sha(data) for key, data in sorted(assets.items())}
    name = 'fti-member-workspace-' + sha(json.dumps(hashes, sort_keys=True).encode())[:20]
    original = baseline.read_bytes()
    updated = entry_html(original, name)
    brotli = subprocess.run(['node', '-e', "const z=require('node:zlib'),fs=require('node:fs');"
                             "process.stdout.write(z.brotliCompressSync(fs.readFileSync(0)))"],
                            input=updated, capture_output=True, check=True).stdout
    bundle = {'__main__.py': Path(__file__).read_bytes(),
              'fti_workspace_helpers.py': (root/'tools/install-panel-completion.py').read_bytes(),
              'manifest.json': json.dumps({'name': name, 'assets': hashes}).encode(),
              'old.html': original, 'new.html': updated, 'new.html.gz': gzip.compress(updated, mtime=0),
              'new.html.br': brotli}
    bundle.update({'static/' + key: value for key, value in assets.items()})
    with zipfile.ZipFile(output, 'x') as archive:
        for key, data in sorted(bundle.items()):
            archive.writestr(zipfile.ZipInfo(key), data, compress_type=zipfile.ZIP_DEFLATED)


def write_once(h, path, data, mode):
    if path.exists():
        require(h.regular(path)[0] == data, 'Existing release file differs: ' + path.name)
        return
    with tempfile.TemporaryDirectory(dir=path.parent) as temp:
        staged = Path(temp) / 'file'
        h.create(staged, data, mode)
        os.link(staged, path, follow_symlinks=False)
    h.sync_directory(path.parent)


def change(h, path, old, new):
    current, stat = h.regular(path)
    if current != new:
        require(current == old, 'Workspace changed concurrently: ' + path.name)
        h.replace(path, old, new, stat)


def workspace(h, archive, manifest, mode, backups=BACKUPS):
    _, root = h.service()
    web = root / 'web'
    name = manifest['name']
    if mode != 'restore':
        cfg = h.config()
        require(cfg['genesis'][0].lower() == '0xd6492377c2c33047afe61768930b2aedff2b2704', 'Root wallet changed')
    old, new = archive.read('old.html'), archive.read('new.html')
    require(entry_html(old, name) == new, 'Invalid HTML patch')
    index = web / 'index.html'
    live = h.regular(index)[0]
    require(live in (old, new), 'Active workspace differs from the packaged baseline')
    assets = {key: archive.read('static/' + key) for key in manifest['assets']}
    require(all(sha(data) == manifest['assets'][k] for k, data in assets.items()), 'Asset digest mismatch')
    folder = h.safe_path(web / name)
    backup = h.safe_path(backups / (root.name + '-' + name))
    for route in ROUTES:
        h.served(h.LOCAL + route, live)
    if mode != 'restore':
        h.served(h.PUBLIC + '/app/', live)
    if mode == 'check':
        print('INSTALLED' if live == new else 'PREFLIGHT_OK', name)
        return
    if mode == 'apply':
        backup.mkdir(parents=True, exist_ok=True, mode=0o700)
        write_once(h, backup / 'index.html', old, 0o600)
        folder.mkdir(mode=0o755, exist_ok=True)
        for key, data in assets.items():
            dest = h.safe_path(folder / key)
            dest.parent.mkdir(mode=0o755, exist_ok=True)
            write_once(h, dest, data, 0o644)
            if not key.endswith('.txt'):
                h.served(h.LOCAL + '/' + name + '/' + key, data, dest.suffix.lstrip('.'))
    else:
        require(h.regular(backup/'index.html')[0] == old, 'The original entry backup is required')
    entries = []
    for suffix in ('.gz', '.br'):
        target = h.safe_path(web / ('index.html' + suffix))
        saved = backup / target.name
        if target.exists():
            if not saved.exists():
                require(mode == 'apply' and live == old, 'Original encoding backup is missing')
                write_once(h, saved, h.regular(target)[0], 0o600)
            entries.append((target, h.regular(saved)[0], archive.read('new.html' + suffix)))
    entries.append((index, old, new))
    require(h.service()[1] == root, 'The service release changed')
    desired = new if mode == 'apply' else old
    try:
        for path, before, after in entries:
            if mode == 'apply':
                change(h, path, before, after)
            else:
                change(h, path, after, before)
        for base in ((h.LOCAL, h.PUBLIC) if mode == 'apply' else (h.LOCAL,)):
            for route in ROUTES:
                h.served(base + route, desired)
        if mode == 'apply':
            h.served(h.PUBLIC + '/' + name + '/app.js', assets['app.js'], 'js')
    except BaseException:
        if mode == 'apply' and h.service()[1] == root:
            for path, before, after in reversed(entries):
                change(h, path, after, before)
        raise
    print('INSTALLED' if mode == 'apply' else 'RESTORED', name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument('--package', type=Path)
    actions.add_argument('--apply', action='store_true')
    actions.add_argument('--restore', action='store_true')
    parser.add_argument('--baseline', type=Path)
    args = parser.parse_args()
    if args.package:
        require(args.baseline is not None, 'Supply the current public /app/ HTML with --baseline')
        pack(Path(__file__).resolve().parents[1], args.baseline, args.package)
        return
    require(zipfile.is_zipfile(sys.argv[0]), 'Run the packaged .pyz on the FTI VPS')
    import fti_workspace_helpers as h
    mode = 'apply' if args.apply else 'restore' if args.restore else 'check'
    with contextlib.ExitStack() as stack:
        if mode != 'check':
            require(os.geteuid() == 0, 'Run the installer as the server operator')
            os.umask(0o022)
            fd = os.open(LOCK, os.O_CREAT | os.O_NOFOLLOW | os.O_RDWR, 0o600)
            stack.callback(os.close, fd)
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        archive = stack.enter_context(zipfile.ZipFile(sys.argv[0]))
        workspace(h, archive, json.loads(archive.read('manifest.json')), mode)


if __name__ == '__main__':
    main()
