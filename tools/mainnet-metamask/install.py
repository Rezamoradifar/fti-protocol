#!/usr/bin/env python3
"""Expose only the three generated static assets; no wallet key, RPC or service switch."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import stat
import subprocess
import tempfile
import time

ROUTES = Path('/etc/nginx/fti-fresh-api-routes.conf')
PUBLIC = Path('/var/www')
BACKUPS = Path('/var/backups/fti-metamask')
HOST = 'ftiprotocol.com'

def require(value, message):
    if not value:
        raise RuntimeError(message)

def run(args):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True).stdout

def regular(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and not path.is_symlink(), 'Expected a regular file: ' + str(path))
    return info

def atomic(path, data, info):
    fd, name = tempfile.mkstemp(prefix='.fti-metamask-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(name, stat.S_IMODE(info.st_mode))
        os.chown(name, info.st_uid, info.st_gid)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)

def validate_assets(source, digest):
    require(source.is_dir() and not source.is_symlink(), 'Generated directory required')
    info = source.stat()
    require(info.st_uid == 0 and info.st_mode & 0o022 == 0, 'Generated directory must be root-owned and not writable by other users')
    require(set(p.name for p in source.iterdir()) == {'index.html', 'operator.js', 'plan.json'}, 'Only generated static assets may be published')
    for name in ('index.html', 'operator.js', 'plan.json'):
        info = regular(source / name)
        require(info.st_uid == 0 and info.st_mode & 0o022 == 0, 'Generated assets must be root-owned and not writable by other users')
    plan = json.loads((source / 'plan.json').read_text())
    body = {k: v for k, v in plan.items() if k != 'digest'}
    actual = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    require(plan['digest'] == digest == actual, 'Plan digest mismatch')
    require(plan['input']['chainId'] == 56 and plan['readyToBroadcast'] is False, 'Unsigned mainnet plan required')
    require(('content="' + digest + '"') in (source / 'index.html').read_text(), 'HTML/plan mismatch')
    return plan

def rollback(backup):
    backup = backup.resolve()
    require(backup.parent == BACKUPS.resolve(), 'Unknown backup directory')
    before = (backup / 'before.conf').read_bytes()
    after = (backup / 'after.conf').read_bytes()
    info = regular(ROUTES)
    require(ROUTES.read_bytes() == after, 'Routes changed since installation; inspect before rollback')
    atomic(ROUTES, before, info)
    try:
        run(['nginx', '-t'])
        run(['systemctl', 'reload', 'nginx'])
    except Exception:
        atomic(ROUTES, after, info)
        raise
    # Keep immutable page files and evidence; only remove the operator URL mapping.
    return {'result': 'FTI_METAMASK_ROUTE_REMOVED', 'backup': str(backup)}

def install(source, digest):
    plan = validate_assets(source, digest)
    require(PUBLIC.is_dir() and not PUBLIC.is_symlink(), 'Expected /var/www directory')
    info = regular(ROUTES)
    require(info.st_uid == 0 and info.st_mode & 0o022 == 0, 'Nginx routes must be root-owned and not writable by other users')
    dump = run(['nginx', '-T'])
    require(str(ROUTES) in dump and HOST in dump, 'Observed FTI Nginx include and hostname required')
    slug = 'fti-mainnet-sign-' + secrets.token_hex(12)
    destination = PUBLIC / slug
    BACKUPS.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup = BACKUPS / slug
    backup.mkdir(mode=0o700)
    before = ROUTES.read_bytes()
    after = before + f'''\n# FTI MetaMask operator {slug}; no existing routes changed.
location ^~ /{slug}/ {{
    alias {destination}/;
    index index.html;
    autoindex off;
    access_log off;
    limit_except GET {{ deny all; }}
    add_header Cache-Control "no-store" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "no-referrer" always;
}}
'''.encode()
    (backup / 'before.conf').write_bytes(before)
    (backup / 'after.conf').write_bytes(after)
    wrote = False
    try:
        destination.mkdir(mode=0o755)
        os.chmod(destination, 0o755)  # setup uses umask 077; Nginx needs traversal
        for name in ('index.html', 'operator.js', 'plan.json'):
            shutil.copyfile(source / name, destination / name)
            os.chmod(destination / name, 0o644)
        require(ROUTES.read_bytes() == before, 'Routes changed during preparation')
        atomic(ROUTES, after, info)
        wrote = True
        run(['nginx', '-t'])
        run(['systemctl', 'reload', 'nginx'])
        # Reload is asynchronous: old workers may briefly serve the previous routes.
        # Never use an inherited HTTP proxy for an origin-local verification.
        for name in ('index.html', 'operator.js', 'plan.json'):
            for attempt in range(5):
                try:
                    received = run(['curl', '--noproxy', '*', '--fail', '--silent', '--show-error', '--max-time', '5', '--resolve', HOST + ':443:127.0.0.1', 'https://' + HOST + '/' + slug + '/' + name])
                    require(received.encode() == (destination / name).read_bytes(), 'Installed HTTPS content mismatch: ' + name)
                    break
                except (subprocess.CalledProcessError, RuntimeError) as error:
                    if attempt == 4:
                        detail = (error.stdout or '').strip() if isinstance(error, subprocess.CalledProcessError) else str(error)
                        raise RuntimeError('HTTPS verification failed for ' + name + ': ' + detail) from error
                    time.sleep(1)
        result = {'result': 'FTI_METAMASK_HTTPS_PAGE_INSTALLED', 'url': 'https://' + HOST + '/' + slug + '/', 'digest': digest, 'sourceRevision': plan['manifest']['sourceRevision'], 'planFile': str(destination / 'plan.json'), 'backup': str(backup), 'submitted': False, 'mainnetActivated': False}
        (backup / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        return result
    except Exception:
        if wrote:
            require(ROUTES.read_bytes() == after, 'Concurrent routes change; automatic rollback refused, inspect backup ' + str(backup))
            atomic(ROUTES, before, info)
            run(['nginx', '-t'])
            run(['systemctl', 'reload', 'nginx'])
        raise

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path)
    parser.add_argument('--digest')
    parser.add_argument('--rollback', type=Path)
    args = parser.parse_args()
    require(os.geteuid() == 0, 'Run as root on the FTI VPS')
    if args.rollback:
        require(not args.directory and not args.digest, 'Choose install or rollback')
        result = rollback(args.rollback)
    else:
        require(args.directory and args.digest, '--directory and --digest required')
        result = install(args.directory, args.digest)
    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        raise SystemExit('FTI_METAMASK_INSTALL_FAILED: ' + str(error))
