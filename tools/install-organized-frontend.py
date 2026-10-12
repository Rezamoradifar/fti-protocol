#!/usr/bin/env python3
"""Install the reviewed organized FTI frontend from the supplied local ZIP.

Frontend only. No keys/env, signing, contract deployment, git pull, npm install,
service restart or nginx changes. A byte-verified earlier installer is reused as
a previously reviewed static-file helper, with a NEW content-addressed UI manifest. This is
not a changed backend fingerprint. Both old HTML files are backed up for restore.
"""
import argparse
import copy
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile
import types
import urllib.request
import zipfile

ENGINE_REV = 'cbf7672ca648e7da9c328f12682b3600610e5244'
ENGINE_SHA256 = 'a0a9a48d33e1dbb383dd80b20fe535a0f0ccbfd610da217504f067f9103b892a'
BASE_REV = '530e993957459cbc94a5b403d9b819171df19f8f'
PACKAGE_SHA256 = '31233959d50bffa8a992d34542673fcb661deba917d11cd45f96a81827934ef7'
SOURCE_FINGERPRINT = 'cc7e572c1116ca2962e5a23869a708f8c2122ca72a72d64a28d03a80fcf56b87'
UPDATES = {'config/social-links.json': '43a7e1c0f9c6aeeb23f72a9fb6c3965c7934caf6c27ffdc00776f23b776fd556', 'frontend/controller.js': '10802382a8a2a86dcba92b2b9d60350a8efcd7b284d05015c23654a89d0bf103', 'frontend/core-translations.js': '0067ed2d096cea2e2703c8f5f17196f65600a70926d2c1ea425665cf48db250e', 'frontend/global-components.jsx': 'e3fb15ad20c7aba50365e7112837930a0601698beaafbca6a6f53201fae33be1', 'frontend/global-interface.css': '3f3dde77ca32116b66c1998750eae7eb09d4765e9d5114ec4705c1712dc51c93', 'frontend/language-policy.js': 'f687d21a1013c9819fdc905430c1bb32b5d56b4d1e473d23cdc4059d316c1780', 'frontend/live-market.js': 'cbd67b9cd24036246b6b2b8c92910f04c283370e2daf16dd04c8f2c400c4d112', 'frontend/main.jsx': '06600d4aa444a006865e359a33532ff27f70593138d35f2445e9386654b87147', 'frontend/social-policy.js': '2081b0341a5eb6608f5814d076966c48f18b01acdc1de3a02b2b2b9ffb164786', 'frontend/social-share.js': '8ac74237372495e48ba85ef22e405880ea27eac1e29eec8cd4d0740730263698', 'frontend/surfaces.js': '40aa9423d984a6486835fd4e86dc6534f1be49ecaa8e945e875a59177f40e931', 'frontend/trade-center.jsx': 'a779911dfd42ab6e21207279d849f4949f3ddb05bafed3b97394c9a2dc732585', 'frontend/workspace-layout.css': '5e7db7dd3429ae8f24e5164b3bb5726cae5aecc27f1e23cac5848db2c14e3ed3', 'frontend/workspace-navigation.js': '80cecec4a3ed5b1e9a6dad319c413ba7c3f6d93ceecbbe8afcc9ea3f2e0300c8', 'landing/src/initial-landing.jsx': '7b402dcf03f55e383b3220215638e96ee7c72446155a932dc31af52cb605bb8b', 'test/global-frontend.test.mjs': '106bb4e10d0c91e3069bdb525aa8d99fe65ab1e1a07b309cfcedcdc6063e74fc', 'test/organized-workspace.test.mjs': '4a4e380adc682355d6658a720e8f3306f8dc4c7f2f11952cc7da346a2ffe34e5'}
BUILD_FIXTURES = {'contracts/FundedBinaryPlanUpgradeable.sol': 'c24dc7c13190647a7d6743cedd00fdc2dff8176900e5cff95a6e451b5c44a9f8', 'contracts/FTIReserveTokenUpgradeable.sol': '28cdf5887df4c9a5afeaade889a3484d997147c6aa6aa25561fad6a7fe0e2667'}
ASSET_HASHES = {'workspace/app.js': '32aa9976d93bc7867573d00d5f076fee054f401f1013907deed5564215218512', 'workspace/app.js.LEGAL.txt': '573cc95a6417c69a6ca44804f440f00965283c8cdcc50025305a7a50f53940ac', 'workspace/style.css': '373a39681dd415c339a117034c7d5d5d9fc976b28730b1967e25dd4afb117190', 'workspace/member-landing-theme.css': '4a66ac54bbbd1282c61536ec6889f07047bdaeda1a54b6b431910da9b31d0198', 'workspace/global-interface.css': 'f49fab87b77e418ebeeb830dbc3ff835f04cacc79175605a76239f1cf7ec1064', 'workspace/favicon.svg': '3d3231707bd92961b2895e4a344569b7013e63de818afed1116696c1edda7aed', 'landing/app.js': 'f9b69e1f757943f4eda4b14a604f1e36d63602ee18cb15c75360af2611b2ea2f', 'landing/app.css': '512cb2db8dbc069d57282c329af442c8e49bf7ae0c5d730f9e1908874e5a5d94', 'landing/protocol-ring.webp': 'b3b743625a09fad6ee10cc77dac74a0fab7f173b9f23ffdd8bf517e02b6a4304'}
PREVIOUS_HTML_HASHES = {'web/index.html': '06ac29ac7157405a7e0f74658dc37c35c05dcab945bfbe84cbdb4e1953f8eaf0', 'landing/dist/index.html': '05f6534db0a55ff9830a28ea77cbbc3be363b8b78ac94b9a0e58e621761754cd'}
REVISION = 'organized-20261012-' + SOURCE_FINGERPRINT[:12]


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def get_engine_bytes():
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise RuntimeError('ENGINE_REDIRECT_REJECTED')
    client = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    url = ('https://raw.githubusercontent.com/Rezamoradifar/fti-protocol/'
           + ENGINE_REV + '/tools/install-global-frontend.py')
    with client.open(url, timeout=60) as response:
        require(response.status == 200, 'ENGINE_HTTP_FAILED')
        data = response.read(100_001)
    require(len(data) <= 100_000, 'ENGINE_TOO_LARGE')
    return data


def load_engine(data):
    # Verify bytes BEFORE importing trusted, pinned helper code. __main__ is NOT run.
    require(digest(data) == ENGINE_SHA256, 'INSTALLER_HELPER_HASH_MISMATCH')
    module = types.ModuleType('fti_verified_static_helper')
    exec(compile(data, 'verified-static-helper.py', 'exec'), module.__dict__)
    module.original_manifest = copy.deepcopy(module.MANIFEST)
    return module


def configure_engine(m):
    manifest = copy.deepcopy(m.original_manifest)
    manifest['source'].update(UPDATES)
    manifest['source'].update(BUILD_FIXTURES)
    fingerprint = digest(json.dumps(manifest['source'], sort_keys=True,
                                    separators=(',', ':')).encode())
    require(fingerprint == SOURCE_FINGERPRINT, 'UI_SOURCE_IDENTITY_MISMATCH')
    require(set(manifest['assets']) == set(ASSET_HASHES), 'ASSET_MANIFEST_MISMATCH')
    for name, value in ASSET_HASHES.items():
        manifest['assets'][name]['sha256'] = value
    manifest.pop('ciRun', None)
    manifest.pop('ciArtifactSHA256', None)
    manifest.update(schema='FTI_ORGANIZED_LOCAL_PACKAGE_V1', revision=REVISION,
                    sourceSHA256=SOURCE_FINGERPRINT, packageSHA256=PACKAGE_SHA256)
    m.MANIFEST = manifest
    m.REV = REVISION
    m.PREFIX = 'fti-organized-' + SOURCE_FINGERPRINT[:12]

    def check_entries(root, get):
        originals = {}
        for relative, routes in m.ENTRYPOINTS.items():
            data, info = m.regular(m.child(root, relative), 200_000)
            require(all(get(route)[0] == data for route in routes), 'HTML_DISK_HTTP_MISMATCH')
            if digest(data) != PREVIOUS_HTML_HASHES[relative]:
                if relative.startswith('web/'):
                    text, count = re.subn(
                        r'<link id="fti-member-theme-overlay-v1" rel="stylesheet" '
                        r'href="\./member-theme-fd22458ee6b1\.css" '
                        r'integrity="sha256-[A-Za-z0-9+/]{43}=">', '', data.decode())
                    require(count <= 1 and m.blob(text.encode()) in m.WORKSPACE_BLOBS,
                            'UNREVIEWED_WORKSPACE_HTML')
                else:
                    require(m.blob(data) == m.LANDING_BLOB, 'UNREVIEWED_LANDING_HTML')
            originals[relative] = (data, info)
        return originals
    m.check_old_entries = check_entries
    return m


def package_files(m, file):
    raw = m.regular(file, 2_000_000)[0]
    require(digest(raw) == PACKAGE_SHA256, 'WRONG_OR_MODIFIED_ORGANIZED_PACKAGE')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)) and len(names) <= 100, 'DUPLICATE_ZIP_ENTRIES')
        results = {}
        for relative, expected in UPDATES.items():
            name = 'source-changes/' + relative
            require(name in names, 'MISSING_REVIEWED_SOURCE_FILE')
            item = archive.getinfo(name)
            require(not item.is_dir() and not stat.S_ISLNK(item.external_attr >> 16)
                    and item.file_size <= 1_000_000, 'UNSAFE_ZIP_ENTRY')
            data = archive.read(item)
            require(digest(data) == expected, 'ORGANIZED_SOURCE_HASH_MISMATCH')
            results[relative] = data
    # Evidence, screenshots and any other archive entries are NEVER extracted/executed.
    return results


def stage_sources(m, raw, stage, changes):
    require(set(changes) == set(UPDATES), 'SOURCE_SET_MISMATCH')
    m.MANIFEST = copy.deepcopy(m.original_manifest)
    m.REV = BASE_REV
    m.MANIFEST['source'].update(BUILD_FIXTURES)
    m.source_from_archive(raw, stage)
    for relative, data in changes.items():
        require(digest(data) == UPDATES[relative], 'SOURCE_CHANGED_BEFORE_BUILD')
        target = m.child(stage, relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            require(target.is_file(), 'UNSAFE_STAGE_SOURCE')
            target.write_bytes(data)
        else:
            m.save_new(target, data)
    configure_engine(m)
    for relative, expected in m.MANIFEST['source'].items():
        require(digest(m.regular(m.child(stage, relative))[0]) == expected,
                'FINAL_STAGED_SOURCE_MISMATCH')


def build(m, root, stage, node):
    # The existing helper builds both surfaces, runs 38 tests, and verifies all
    # resulting bytes against the NEW reviewed manifest, not the old UI hashes.
    assets = m.build_sources(root, stage, node)
    env = {'HOME': str(stage / '.build-home'), 'PATH': str(node.parent) + ':/usr/bin:/bin',
           'LANG': 'C.UTF-8', 'CI': '1', 'NO_COLOR': '1'}
    with (stage / 'build.log').open('ab') as log:
        result = subprocess.run([str(node), '--test', 'test/organized-workspace.test.mjs'],
                                cwd=stage, env=env, stdout=log, stderr=subprocess.STDOUT,
                                timeout=180)
    require(result.returncode == 0, 'ORGANIZED_WORKSPACE_TESTS_FAILED')
    return assets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, choices=[3110], required=True)
    parser.add_argument('--package', type=Path)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--restore', type=Path)
    args = parser.parse_args()
    require(os.geteuid() == 0, 'RUN_AS_ROOT_ON_FTI_SERVER')
    require(not (args.apply and args.restore), 'CHOOSE_APPLY_OR_RESTORE')
    require(not args.apply or args.package is not None, 'LOCAL_ORGANIZED_ZIP_REQUIRED')
    m = configure_engine(load_engine(get_engine_bytes()))
    changes = package_files(m, args.package) if args.apply else None
    root, pid, node = m.identify(args.port)
    get = lambda route: m.local_get(args.port, route)
    cfg = m.read_config(get)
    identity = lambda: require(m.identify(args.port) == (root, pid, node), 'SERVING_PROCESS_CHANGED')
    require(digest(m.regular(root / 'package-lock.json')[0]) == m.MANIFEST['source']['package-lock.json'],
            'INSTALLED_DEPENDENCIES_CHANGED')
    if not args.apply and not args.restore:
        m.check_old_entries(root, get)
        print(json.dumps({'result': 'FTI_ORGANIZED_PREFLIGHT_PASS', 'root': str(root),
                          'frontendRevision': REVISION, 'installed': False}, indent=2))
        return
    # Share the predecessor installer's per-root lock, not a new independent lock.
    m.BACKUPS.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(not m.BACKUPS.is_symlink() and m.BACKUPS.stat().st_mode & 0o077 == 0,
            'PRIVATE_BACKUP_DIRECTORY_REQUIRED')
    lock = os.open(m.BACKUPS / ('lock-' + digest(str(root).encode())[:20]),
                   os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.restore:
            backup = args.restore.resolve(strict=True)
            require(backup.parent == m.BACKUPS.resolve(), 'BACKUP_OUTSIDE_PRIVATE_DIRECTORY')
            result = m.restore(root, backup, cfg, get, identity)
        else:
            stage = Path(tempfile.mkdtemp(prefix='organized-build-', dir=m.BACKUPS))
            print('FTI_BUILD_LOG=' + str(stage / 'build.log'), flush=True)
            before = m.protected_hashes(root)
            raw, _ = m.fetch('https://codeload.github.com/Rezamoradifar/fti-protocol/tar.gz/' + BASE_REV,
                             12_000_000)
            stage_sources(m, raw, stage, changes)
            print('FTI_STAGE=build_and_57_frontend_tests', flush=True)
            assets = build(m, root, stage, node)
            identity()
            require(m.protected_hashes(root) == before, 'BACKEND_CHANGED_DURING_BUILD')
            rendered = m.render_entries(stage, assets)
            result = m.install(root, assets, rendered, cfg, get, m.BACKUPS, identity)
            result['buildLog'] = str(stage / 'build.log')
        result['result'] = result['result'].replace('FTI_GLOBAL_FRONTEND', 'FTI_ORGANIZED_FRONTEND')
        result.update(frontendRevisionKind='content-sha256', frontendSourceSHA256=SOURCE_FINGERPRINT,
                      packageSHA256=PACKAGE_SHA256, contractsChanged=False,
                      servicesRestarted=False, fundsMoved=False)
        print(json.dumps(result, indent=2))
    finally:
        os.close(lock)


if __name__ == '__main__':
    os.umask(0o077)
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        message = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print('FTI_ORGANIZED_FRONTEND_FAILED: ' + message, file=sys.stderr)
        sys.exit(1)
