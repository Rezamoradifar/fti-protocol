#!/usr/bin/env python3
"""Build, check, install or restore the static FTI member workspace startup update."""
import argparse
import contextlib
import fcntl
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import zipfile

PREVIOUS = '1a3a7ccd596ee4e943e83d4512f4bc4e548240ba74cb0832f3e6e75997c1d182'
TOKEN = b'{BOOT_ASSETS}'
ROUTES = ('/app/', '/token/', '/admin/')
LOCK = '/run/lock/fti-service-cutover.lock'
TYPES = {'.js': ('application/javascript', 'text/javascript'),
         '.css': ('text/css',), '.webp': ('image/webp',), '.woff2': ('font/woff2',),
         '.svg': ('image/svg+xml',), '.txt': ('text/plain', 'application/octet-stream')}
SUFFIXES = ('.gz', '.br', '')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def asset_name(key):
    parts = key.split('/')
    require(all(re.fullmatch(r'[a-zA-Z0-9_][a-zA-Z0-9_.-]*', p) for p in parts)
            and Path(key).suffix in TYPES, 'Invalid startup asset: ' + key)
    return key


def bundle_name(template, hashes):
    inventory = json.dumps(hashes, sort_keys=True, separators=(',', ':')).encode()
    return 'fti-member-boot-' + digest(template + b'\0' + inventory)[:20]


def compressed(data):
    gz = io.BytesIO()
    with gzip.GzipFile(fileobj=gz, mode='wb', mtime=0) as g:
        g.write(data)
    br = subprocess.run(
        ['node', '-e', "const fs=require('node:fs'),z=require('node:zlib');"
         "process.stdout.write(z.brotliCompressSync(fs.readFileSync(0),"
         "{params:{[z.constants.BROTLI_PARAM_QUALITY]:8}}))"],
        input=data, check=True, capture_output=True).stdout
    return {'.gz': gz.getvalue(), '.br': br}


def build(previous, template, assets, output):
    require(digest(previous.read_bytes()) == PREVIOUS, 'Unexpected previous installer digest')
    with zipfile.ZipFile(previous) as old:
        files = {'__main__.py': Path(__file__).read_bytes(),
                 'fti_workspace_helpers.py': old.read('fti_workspace_helpers.py')}
        for suffix in SUFFIXES:
            files['old.html' + suffix] = old.read('new.html' + suffix)

    html = template.read_bytes()
    hashes = {}
    encoded = {}
    if assets is not None:
        require(assets.is_dir(), 'Missing boot assets directory')
        for path in sorted(assets.rglob('*')):
            require(not path.is_symlink(), 'Symlink in release inputs')
            if path.is_file():
                key = asset_name(path.relative_to(assets).as_posix())
                data = path.read_bytes()
                files['static/' + key] = data
                hashes[key] = digest(data)
                if len(data) > 500 and path.suffix in {'.js', '.css'}:
                    for suffix, wire in compressed(data).items():
                        files['static/' + key + suffix] = wire
                        encoded[key + suffix] = digest(wire)
    require(not hashes or b'/' + TOKEN + b'/' in html, 'HTML needs /{BOOT_ASSETS}/')
    name = bundle_name(html, {**hashes, **encoded})
    new = html.replace(TOKEN, name.encode())
    files['new.html'] = new
    for suffix, data in compressed(new).items():
        files['new.html' + suffix] = data
    files['manifest.json'] = json.dumps({'name': name, 'assets': hashes, 'encoded': encoded},
                                        sort_keys=True).encode()
    with zipfile.ZipFile(output, 'x') as archive:
        for key, data in sorted(files.items()):
            archive.writestr(zipfile.ZipInfo(key), data, compress_type=zipfile.ZIP_DEFLATED)
    print(name, digest(output.read_bytes()), output)


def asset_response(h, url, name, data):
    actual, mime = h.fetch(url)
    require(actual == data and mime in TYPES[Path(name).suffix],
            'Startup asset not served as expected: ' + name)


def publish(h, root, name, assets, encoded):
    folder = h.safe_path(root / 'web' / name)
    folder.mkdir(mode=0o755, exist_ok=True)
    h.sync_directory(folder.parent)
    for key, data in {**encoded, **assets}.items():
        path = h.safe_path(folder / key)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        h.publish_asset(path, data)
    for key, data in assets.items():
        for base in (h.LOCAL, h.PUBLIC):
            asset_response(h, base + '/' + name + '/' + key, key, data)


def check_html(h, origin, content):
    for route in ROUTES:
        h.served(origin + route, content)


def install(h, archive, mode):
    _, root = h.service()
    manifest = json.loads(archive.read('manifest.json'))
    name = manifest['name']
    require(re.fullmatch(r'fti-member-boot-[0-9a-f]{20}', name), 'Invalid boot release name')
    assets = {asset_name(k): archive.read('static/' + k) for k in manifest['assets']}
    require(all(digest(data) == manifest['assets'][key] for key, data in assets.items()),
            'Boot asset digest mismatch')
    encoded = {}
    for key, expected in manifest['encoded'].items():
        stem, suffix = os.path.splitext(key)
        require(suffix in ('.gz', '.br') and stem in assets, 'Invalid encoded startup asset')
        data = archive.read('static/' + key)
        require(digest(data) == expected, 'Encoded startup asset digest mismatch')
        encoded[key] = data
    old = archive.read('old.html')
    new = archive.read('new.html')
    files = []
    for suffix in SUFFIXES:
        path = h.safe_path(root / 'web' / ('index.html' + suffix))
        if suffix and not path.exists():
            continue
        before, after = archive.read('old.html' + suffix), archive.read('new.html' + suffix)
        existing, stat = h.regular(path)
        require(existing in (before, after), 'Active file changed: ' + path.name)
        files.append((path, existing, stat, before, after))

    live = files[-1][1]
    if mode != 'restore':
        cfg = h.config()
        require(cfg['genesis'][0].lower() == '0xd6492377c2c33047afe61768930b2aedff2b2704',
                'Unexpected genesis wallet')
        check_html(h, h.LOCAL, live)
        h.served(h.PUBLIC + '/app/', live)
    if mode == 'check':
        installed = all(existing == after for _, existing, _, _, after in files)
        if installed:
            for key, data in encoded.items():
                require(h.regular(root / 'web' / name / key)[0] == data,
                        'Installed encoded startup asset differs: ' + key)
            for key, data in assets.items():
                asset_response(h, h.PUBLIC + '/' + name + '/' + key, key, data)
        print('INSTALLED' if installed else 'PREFLIGHT_OK', name)
        return
    if mode == 'apply' and assets:
        publish(h, root, name, assets, encoded)
    require(h.service()[1] == root, 'The active FTI release changed')
    changes = []
    try:
        for path, current, stat, before, after in files:
            desired = after if mode == 'apply' else before
            if current != desired:
                changes.append((path, current, desired))
                h.replace(path, current, desired, stat)
        check_html(h, h.LOCAL, new if mode == 'apply' else old)
        if mode == 'apply':
            check_html(h, h.PUBLIC, new)
    except BaseException as failure:
        if h.service()[1] == root:
            conflicts = []
            for path, former, desired in reversed(changes):
                try:
                    data, info = h.regular(path)
                    if data == desired:
                        h.replace(path, desired, former, info)
                    elif data != former:
                        conflicts.append(path.name)
                except Exception:
                    conflicts.append(path.name)
            if conflicts:
                raise RuntimeError('Rollback requires review: ' + ', '.join(conflicts)) from failure
        raise
    print('INSTALLED' if mode == 'apply' else 'RESTORED', name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument('--package', type=Path, metavar='TEMPLATE')
    action.add_argument('--apply', action='store_true')
    action.add_argument('--restore', action='store_true')
    parser.add_argument('--previous', type=Path,
                        default=Path('delivery/fti-member-workspace-20261121.pyz'))
    parser.add_argument('--assets', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.package:
        require(args.output is not None, '--output is required when packaging')
        build(args.previous, args.package, args.assets, args.output)
        return
    require(zipfile.is_zipfile(sys.argv[0]), 'Run the packaged .pyz on the FTI VPS')
    mode = 'apply' if args.apply else 'restore' if args.restore else 'check'
    import fti_workspace_helpers as h
    with contextlib.ExitStack() as stack:
        if mode != 'check':
            require(os.geteuid() == 0, 'Run the installer as the server operator')
            os.umask(0o022)
            lock = os.open(LOCK, os.O_CREAT | os.O_NOFOLLOW | os.O_RDWR, 0o600)
            stack.callback(os.close, lock)
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        archive = stack.enter_context(zipfile.ZipFile(sys.argv[0]))
        install(h, archive, mode)


if __name__ == '__main__':
    main()
