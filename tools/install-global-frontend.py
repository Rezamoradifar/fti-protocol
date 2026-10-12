#!/usr/bin/env python3
"""Install the pinned FTI global UI, preserving the installed backend release.

Only new versioned static assets and two HTML entry points are changed.
No npm install, git pull, restart, environment/key read, contract call or signing.
Default is preflight; --apply installs; --restore BACKUP restores only this overlay.
"""
import argparse
import base64
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
import tarfile
import tempfile
import urllib.request

MANIFEST = {'schema': 'FTI_GLOBAL_UI_SOURCE_AND_BUILD_V1', 'revision': '530e993957459cbc94a5b403d9b819171df19f8f', 'ciRun': 38236873534, 'ciArtifactSHA256': 'a94dd6d10482718c3d3cad96e0233c91242c89bda36a800cc230339f9d8fe71b', 'source': {'config/social-links.json': 'aa3f2ba795df2d4c590c2180003eadb1f8f070b8a9c28137fa283aca3841c511', 'frontend/builder-view.js': '10af2ffa60d511207b5426b8071f1a8ab7f2149004528fbb810da5385dd9403a', 'frontend/candles.js': '57f7400868e908f1df90bf99b59a61d5dfd09666c68f8ca85bca7f90049c5f7c', 'frontend/controller.js': '37b1c8fd38c327ab61bc52985a762fce371cad0ae47d70d80dfb763843309b66', 'frontend/core-translations.js': '3b4c7ae79fcaceae01c731f83e90532029c36472274a26374142e9b513c2313b', 'frontend/global-components.jsx': '76cf4365e65b28d2de04f0010b87a40a72bfd33591de4885c8927d377ddb83a3', 'frontend/global-interface.css': 'a37f2d8eb46b7c6eec6a530bb1e12b9e99d8f4bd1377234f0d02548f3979a809', 'frontend/landing-translations.js': '7bb2278cb90c40191e718d90de7bd3ee35037a9fa153180a3924a778fa0ff81c', 'frontend/language-policy.js': '0b555f0e056ad62ce8e50d5018a92d8c22eae8f8814553bb9275bb73f8cf63fa', 'frontend/live-market.js': 'b6d2d29b83bd04cc89f89270453c984b6697dd4580d6784a20983e12311e4c86', 'frontend/locale.js': 'c2f3f192394822f282f4a3f391df0fad16caa410a9f484658de6fc3f4b830af0', 'frontend/main.jsx': '6f50bde8cc8e68cdbe5bdd3b5193e9e77a9d39f003918e0cc659130d09b6cb91', 'frontend/market-series.js': '25091387a5d46daaa7b95c3df33764a6f6c55686de7f29e25744d4a58742cd9c', 'frontend/member-landing-theme.css': '24d3a715036a683b9f030d6373aa5b5b2b585d9829bddb26d2095da5b83a885f', 'frontend/network-data.mjs': 'eb9cf73cbe85acc3d4d1f12656a2643d94f4b99b9191cd096bfe0371f08a1268', 'frontend/network-tree.js': 'dd7cb0836d1daa4bad0f530a60250d5484bbc2bb8a5453d0ad184c06f03eb292', 'frontend/settled-points.js': 'cc1ea27d48b79fbdd013f6a671caa0b4c0141251469d4b72bf420e9ae291a2bf', 'frontend/site-links.js': '3c1e1a200e6e548e4f15b8b37085560e5907209ae209ab0761fa7a748bb016cb', 'frontend/social-policy.js': 'f3a89223015cb5a158da5c00ef30195796c7e9cac7a6f8e7d4c9c1e91c59675c', 'frontend/spot-history.js': '360cbfbe5a1fc7abfc3c454d4a37c3470ec063f615b0c45030449532a6d158c0', 'frontend/surfaces.js': 'c485878f53e976c86dcbb2cb97e716060d7811f6c79976dfce386b48d55ad875', 'frontend/translate-tree.jsx': '314a37717184e4bde3c96f4e3e7fe8b7314275706bd660d20601d8133ead0b47', 'frontend/wallet-selector.js': '96585c4f26f6134070220954ac55227df12dae7b037be2b63fb8631991865d0e', 'frontend/walletconnect.js': '88ad09896428434e7037c5972fa65d34b38a3b57c795e73963a85cdd44e3f8ab', 'landing/build.mjs': 'f21b15273026daaeed8845ca7f3f326534a4906f328865da1d28b33e0d13c129', 'landing/package.json': '4e2d7887df4ebd4aaf19d74789bd5bd3ef011d47b1e50a9eefa1b0eca0af3771', 'landing/public/index.html': 'd71e013182c8e95b443f146097c5686811180726103e92bd122617e25cb55e5c', 'landing/public/protocol-ring.webp': 'b3b743625a09fad6ee10cc77dac74a0fab7f173b9f23ffdd8bf517e02b6a4304', 'landing/src/initial-landing.css': '66f91ae45da6e8ddd8a2a510ad21393e2bd6ebdf3436f0c1e3e56da2f5d9afa7', 'landing/src/initial-landing.jsx': '316a4e67af99d348313f2d504450b5f433e957441747634457a245a9a30532be', 'landing/src/main.jsx': 'd05ce375a7cb06f3f4b3820b6a21d4c5e29ac481ea466aa1cde51586b1432871', 'landing/src/protocol-data.mjs': 'f813502e5b523f33655abc0eefd41bd350fd0649e1b24f57931d601f732afd45', 'landing/src/public-site.jsx': '346f48d25edacd9fc054fa1ce22d90c09c7ad6136be17aee266db9c8ecc2e3f0', 'landing/src/sections.jsx': 'cc9e338baa5f557816ec066e6be09e564ac43c8283bbbfe2c35902c0ecaed810', 'landing/src/style.css': '7c6f1ee43551ead750805bdcefcb942cbac0ef3161b925e3e352388115ecf047', 'package-lock.json': '2f89db62ee68166894b78b51684033b2391e3fb73889cf4fcae52e7e8b614fbe', 'package.json': 'ff82c359a079748ddbec70d9b529041110b3b1c4b7179309e1576ad6f96ddf5d', 'scripts/build-web.mjs': '2d343616afa0e5b8fbfc41dd27e53733b3c14a2f8d9f9a1134b7a9b01c7ebcaa', 'test/global-frontend.test.mjs': '93e71dc2fc8517195dcef03fffa4e2540bac53916b1ed40b5be1406aa09e6dea', 'test/member-landing-theme.test.mjs': '8ffdcecc5180c1f635cad716d3af197fb69cb834d2e74f9b447924f103bad8a5', 'web/favicon.svg': '3d3231707bd92961b2895e4a344569b7013e63de818afed1116696c1edda7aed', 'web/index.html': 'b7567973a1d8e76f71b4c210a4e709a988025ca3509184ef4f0737d082dc211a', 'web/style.css': '373a39681dd415c339a117034c7d5d5d9fc976b28730b1967e25dd4afb117190'}, 'assets': {'workspace/app.js': {'source': 'web/app.js', 'sha256': 'e3214a5592ff685380bd48426a225b9c041ca1bb71534fe59696746908f678bd'}, 'workspace/app.js.LEGAL.txt': {'source': 'web/app.js.LEGAL.txt', 'sha256': '573cc95a6417c69a6ca44804f440f00965283c8cdcc50025305a7a50f53940ac'}, 'workspace/style.css': {'source': 'web/style.css', 'sha256': '373a39681dd415c339a117034c7d5d5d9fc976b28730b1967e25dd4afb117190'}, 'workspace/member-landing-theme.css': {'source': 'web/member-landing-theme.css', 'sha256': '4a66ac54bbbd1282c61536ec6889f07047bdaeda1a54b6b431910da9b31d0198'}, 'workspace/global-interface.css': {'source': 'web/global-interface.css', 'sha256': '99615a145ac3389152ff11ddf6ca6d04ce5ccde1d0830991db592e1465d21b95'}, 'workspace/favicon.svg': {'source': 'web/favicon.svg', 'sha256': '3d3231707bd92961b2895e4a344569b7013e63de818afed1116696c1edda7aed'}, 'landing/app.js': {'source': 'landing/dist/app.js', 'sha256': '15f2e93eed55611faa159a2bc4de1edb1d0945c774c9ec4d2b794bc0e714e0aa'}, 'landing/app.css': {'source': 'landing/dist/app.css', 'sha256': '8325927fc037d5c5f85d58a1d19cc6e3a22443efa0ef0ab74fa2e864149c3e38'}, 'landing/protocol-ring.webp': {'source': 'landing/dist/protocol-ring.webp', 'sha256': 'b3b743625a09fad6ee10cc77dac74a0fab7f173b9f23ffdd8bf517e02b6a4304'}}, 'walletConnectSHA256': '7d34e6802e40bc81512da2ab02d483bc45bad8c33b1e684708b5f0d6ca68cea8'}
REV = MANIFEST['revision']
PREFIX = 'fti-ui-' + REV[:12]
BACKUPS = Path('/var/backups/fti-global-frontend')
SERVER_BLOBS = {'a3bfcf8b3973fb3cad0ce03c5cff2ce560d71859',
                '66ab3d1dc1ecf757c37904f6077ed4fa155af0b9'}
WORKSPACE_BLOBS = {'9e46fba35dd0741f75874a7f8399bde0f4fb6828',
                   'f3a5bf5816dc6147c751c45dbd9a7e4692fe1971'}
LANDING_BLOB = 'ccc93efdccc3cce2690f496d7458e8c33f3f03a4'
ENTRYPOINTS = {'web/index.html': ['/app/', '/token/', '/admin/'],
               'landing/dist/index.html': ['/', '/token-site/', '/whitepaper/', '/roadmap/']}


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def regular(file, limit=32_000_000):
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
                and info.st_size <= limit, 'EXPECTED_REGULAR_BOUNDED_FILE')
        with os.fdopen(os.dup(fd), 'rb') as stream:
            data = stream.read(limit + 1)
        require(len(data) <= limit, 'FILE_TOO_LARGE')
        return data, info
    finally:
        os.close(fd)


def child(root, relative):
    require(relative and not Path(relative).is_absolute()
            and '..' not in Path(relative).parts, 'UNSAFE_PATH')
    target = root
    for part in Path(relative).parts:
        target = target / part
        require(not target.is_symlink(), 'SYMLINK_PATH_REJECTED')
    return target


def save_new(file, data, mode=0o600):
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        os.fchmod(stream.fileno(), mode)
        stream.flush()
        os.fsync(stream.fileno())


def replace(file, data, info):
    fd, name = tempfile.mkstemp(prefix='.fti-global-', dir=file.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            os.fchmod(stream.fileno(), stat.S_IMODE(info.st_mode))
            if os.geteuid() == 0:
                os.fchown(stream.fileno(), info.st_uid, info.st_gid)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, file)
        folder = os.open(file.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(folder)
        finally:
            os.close(folder)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def fetch(url, limit=16_000_000):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise RuntimeError('HTTP_REDIRECT_REJECTED')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache',
                                                'User-Agent': 'FTI-Verified-UI-Installer/1'})
    with opener.open(request, timeout=60) as response:
        require(response.status == 200, 'HTTP_STATUS')
        data = response.read(limit + 1)
        require(len(data) <= limit, 'HTTP_SIZE_LIMIT')
        return data, response.headers.get_content_type()


def local_get(port, route):
    return fetch('http://127.0.0.1:' + str(port) + route)


def read_config(get):
    cfg = json.loads(get('/api/config')[0])
    require(isinstance(cfg, dict) and cfg.get('chainId') == 97,
            'EXPECTED_BNB_TESTNET')
    require(cfg.get('binaryContract') == 'FundedBinaryPlanUpgradeable'
            and cfg.get('tokenContract') == 'FTIReserveTokenUpgradeable',
            'THIS_INSTALLER_REQUIRES_THE_CONTINUITY_BACKEND')
    for key in ('binary', 'token', 'usd', 'council', 'timelock'):
        require(re.fullmatch(r'0x[0-9a-fA-F]{40}', str(cfg.get(key, '')))
                and int(cfg[key], 16) != 0, 'BAD_DEPLOYMENT_ADDRESS')
    require(re.fullmatch(r'[a-f0-9]{40}', str(cfg.get('sourceRevision', ''))),
            'MISSING_BACKEND_REVISION')
    health = json.loads(get('/health')[0])
    require(health.get('ok') is True and health.get('chainId') == 97,
            'BACKEND_HEALTH_FAILED')
    return cfg


def identify(port):
    p = subprocess.run(['ss', '-H', '-ltnp', 'sport = :' + str(port)],
                       capture_output=True, text=True, check=True, timeout=10)
    pids = set(re.findall(r'pid=(\d+)', p.stdout))
    require(len(pids) == 1, 'PORT_REQUIRES_ONE_IDENTIFIED_SERVER')
    pid = next(iter(pids))
    proc = Path('/proc') / pid
    args = (proc / 'cmdline').read_bytes().split(b'\0')
    entries = [os.fsdecode(x) for x in args
               if x == b'scripts/server.mjs' or x.endswith(b'/scripts/server.mjs')]
    require(len(entries) == 1, 'EXPECTED_DIRECT_SERVER_PROCESS')
    entry = Path(entries[0])
    if not entry.is_absolute():
        entry = (proc / 'cwd').resolve(strict=True) / entry
    entry = entry.resolve(strict=True)
    root = entry.parent.parent
    require(entry.parent.name == 'scripts' and blob(regular(entry)[0]) in SERVER_BLOBS,
            'UNREVIEWED_BACKEND_SERVER')
    for folder in ('web', 'landing', 'landing/dist', 'frontend', 'scripts', 'contracts', 'artifacts'):
        require(child(root, folder).is_dir(), 'REQUIRED_BACKEND_DIRECTORY_MISSING')
    return root, pid, (proc / 'exe').resolve(strict=True)


def protected_hashes(root):
    files = {'package.json', 'package-lock.json', 'web/app.js', 'web/style.css',
             'web/vendor/walletconnect.js'}
    for folder in ('frontend', 'scripts', 'contracts', 'artifacts', 'landing/src'):
        for file in child(root, folder).rglob('*'):
            require(not file.is_symlink(), 'SYMLINK_IN_PROTECTED_FILES')
            if file.is_file():
                files.add(file.relative_to(root).as_posix())
    return {p: sha(regular(child(root, p))[0]) for p in sorted(files)}


def check_old_entries(root, get):
    originals = {}
    for relative, routes in ENTRYPOINTS.items():
        data, info = regular(child(root, relative), 200_000)
        require(all(get(route)[0] == data for route in routes), 'HTML_DISK_HTTP_MISMATCH')
        if relative.startswith('web/'):
            text = data.decode('utf-8')
            # Accept the previously reviewed presentation overlay, not arbitrary HTML edits.
            clean, count = re.subn(r'<link id="fti-member-theme-overlay-v1" rel="stylesheet" '
                                  r'href="\./member-theme-fd22458ee6b1\.css" '
                                  r'integrity="sha256-[A-Za-z0-9+/]{43}=">', '', text)
            require(count <= 1 and blob(clean.encode()) in WORKSPACE_BLOBS,
                    'UNREVIEWED_WORKSPACE_HTML')
        else:
            require(blob(data) == LANDING_BLOB, 'UNREVIEWED_LANDING_HTML')
        originals[relative] = (data, info)
    return originals


def source_from_archive(raw, stage):
    prefix = 'fti-protocol-' + REV + '/'
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        selected = {}
        for member in archive.getmembers():
            if member.name.startswith(prefix) and member.name[len(prefix):] in MANIFEST['source']:
                relative = member.name[len(prefix):]
                require(relative not in selected and member.isfile() and not member.issym()
                        and not member.islnk() and member.size <= 2_000_000,
                        'UNSAFE_OR_DUPLICATE_SOURCE')
                selected[relative] = member
        require(set(selected) == set(MANIFEST['source']), 'INCOMPLETE_SOURCE_ARCHIVE')
        for relative, expected in MANIFEST['source'].items():
            data = archive.extractfile(selected[relative]).read(2_000_001)
            require(sha(data) == expected, 'SOURCE_HASH_MISMATCH')
            file = child(stage, relative)
            file.parent.mkdir(parents=True, exist_ok=True)
            save_new(file, data)


def build_sources(root, stage, node):
    require(sha(regular(root / 'package-lock.json')[0]) == MANIFEST['source']['package-lock.json'],
            'DEPENDENCIES_LOCK_MISMATCH_NO_NPM_INSTALL_PERFORMED')
    dependency = root / 'node_modules'
    require(dependency.is_dir(), 'EXISTING_DEPENDENCIES_REQUIRED')
    compiler = json.loads(regular(dependency / 'esbuild/package.json')[0])
    require(compiler.get('version') == '0.25.10', 'ESBUILD_VERSION_MISMATCH')
    (stage / 'node_modules').symlink_to(dependency.resolve(), target_is_directory=True)
    home = stage / '.build-home'
    home.mkdir(mode=0o700)
    env = {'HOME': str(home), 'PATH': str(node.parent) + ':/usr/local/bin:/usr/bin:/bin',
           'LANG': 'C.UTF-8', 'CI': '1', 'NO_COLOR': '1'}
    version = subprocess.check_output([str(node), '-p', 'process.versions.node'],
                                     env=env, timeout=10, text=True).strip()
    require(int(version.split('.')[0]) >= 22, 'NODE_22_OR_NEWER_REQUIRED')
    jobs = [(stage, ['scripts/build-web.mjs']), (stage / 'landing', ['build.mjs']),
            (stage, ['--test', 'test/global-frontend.test.mjs', 'test/member-landing-theme.test.mjs'])]
    with (stage / 'build.log').open('wb') as log:
        for cwd, args in jobs:
            result = subprocess.run([str(node)] + args, cwd=cwd, env=env,
                                    stdout=log, stderr=subprocess.STDOUT, timeout=180)
            require(result.returncode == 0, 'ISOLATED_FRONTEND_BUILD_OR_TEST_FAILED')
    assets = {}
    for destination, item in MANIFEST['assets'].items():
        data = regular(stage / item['source'])[0]
        require(sha(data) == item['sha256'], 'BUILT_ASSET_DIFFERS_FROM_VERIFIED_CI')
        assets[destination] = data
    require(sha(regular(root / 'web/vendor/walletconnect.js')[0]) == MANIFEST['walletConnectSHA256'],
            'INSTALLED_WALLET_LIBRARY_MISMATCH')
    return assets


def sri(data):
    return 'sha256-' + base64.b64encode(hashlib.sha256(data).digest()).decode()


def render_entries(stage, assets):
    outputs = {}
    mappings = {
        'web/index.html': {'./app.js': 'workspace/app.js', './style.css': 'workspace/style.css',
                          './member-landing-theme.css': 'workspace/member-landing-theme.css',
                          './global-interface.css': 'workspace/global-interface.css',
                          './favicon.svg': 'workspace/favicon.svg'},
        'landing/dist/index.html': {'/app.js': 'landing/app.js', '/app.css': 'landing/app.css'}}
    for relative, mapping in mappings.items():
        text = regular(stage / relative)[0].decode('utf-8')
        for old, destination in mapping.items():
            attribute = 'src' if old.endswith('.js') else 'href'
            needle = attribute + '="' + old + '"'
            require(text.count(needle) == 1, 'UNEXPECTED_BUILT_HTML')
            replacement = attribute + '="/' + PREFIX + '/' + destination + '"'
            if old.endswith(('.js', '.css')):
                replacement += ' integrity="' + sri(assets[destination]) + '"'
            text = text.replace(needle, replacement)
        require(text.count('</head>') == 1, 'UNEXPECTED_HTML_HEAD')
        text = text.replace('</head>', '<meta name="fti-frontend-revision" content="' + REV + '"></head>')
        outputs[relative] = text.encode('utf-8')
    return outputs


def verify_assets(root, assets, get):
    for name, data in assets.items():
        actual, mime = get('/' + PREFIX + '/' + name)
        require(actual == data, 'STATIC_ASSET_HTTP_MISMATCH')
        if name.endswith('.js'):
            require(mime in ('text/javascript', 'application/javascript'), 'SCRIPT_MIME_MISMATCH')
        elif name.endswith('.css'):
            require(mime == 'text/css', 'STYLE_MIME_MISMATCH')


def install(root, assets, rendered, cfg, get, backup_base, identity=lambda: None):
    current = {p: regular(child(root, p))[0] for p in ENTRYPOINTS}
    if current == rendered:
        verify_assets(root, assets, get)
        require(all(get(route)[0] == rendered[p] for p, routes in ENTRYPOINTS.items() for route in routes),
                'EXISTING_HTML_HTTP_MISMATCH')
        return {'result': 'FTI_GLOBAL_FRONTEND_ALREADY_INSTALLED', 'frontendRevision': REV,
                'root': str(root), 'contractsChanged': False, 'fundsMoved': False}
    originals = check_old_entries(root, get)
    protected = protected_hashes(root)
    # The landing still refers to this original illustration by its existing URL.
    require(get('/protocol-ring.webp')[0] == assets['landing/protocol-ring.webp'],
            'LANDING_ILLUSTRATION_MISMATCH')
    backup_base.mkdir(parents=True, exist_ok=True, mode=0o700)
    require(not backup_base.is_symlink() and backup_base.stat().st_mode & 0o077 == 0,
            'PRIVATE_BACKUP_DIRECTORY_REQUIRED')
    backup = Path(tempfile.mkdtemp(prefix='install-', dir=backup_base))
    info = {'schema': 'FTI_GLOBAL_FRONTEND_OVERLAY_V1', 'root': str(root),
            'frontendRevision': REV, 'backendRevision': cfg['sourceRevision'],
            'configSHA256': sha(json.dumps(cfg, sort_keys=True).encode()), 'protected': protected,
            'files': {p: {'before': sha(v[0]), 'after': sha(rendered[p])} for p, v in originals.items()}}
    for i, (p, (data, _)) in enumerate(originals.items()):
        info['files'][p]['backupName'] = str(i) + '.before.html'
        save_new(backup / (str(i) + '.before.html'), data)
    save_new(backup / 'record.json', (json.dumps(info, indent=2) + '\n').encode())
    print('FTI_FRONTEND_BACKUP=' + str(backup), flush=True)
    destination = child(root, 'web/' + PREFIX)
    try:
        identity()
        if not destination.exists():
            destination.mkdir(mode=0o755)
            destination.chmod(0o755)
        require(destination.is_dir(), 'VERSIONED_ASSET_DIRECTORY_REQUIRED')
        for name, data in assets.items():
            file = child(destination, name)
            if not file.parent.exists():
                file.parent.mkdir(mode=0o755)
                file.parent.chmod(0o755)
            if file.exists():
                require(regular(file)[0] == data, 'EXISTING_VERSIONED_ASSET_DIFFERS')
            else:
                save_new(file, data, 0o644)
        verify_assets(root, assets, get)
        require(protected_hashes(root) == protected, 'BACKEND_CHANGED_DURING_BUILD')
        require(read_config(get) == cfg, 'BACKEND_CONFIG_CHANGED')
        for relative, (before, metadata) in originals.items():
            identity()
            require(regular(child(root, relative))[0] == before, 'CONCURRENT_HTML_EDIT')
            replace(root / relative, rendered[relative], metadata)
        require(all(get(route)[0] == rendered[p] for p, routes in ENTRYPOINTS.items() for route in routes),
                'POST_INSTALL_HTML_CHECK_FAILED')
        require(read_config(get) == cfg and protected_hashes(root) == protected,
                'BACKEND_CHANGED_DURING_INSTALL')
        identity()
        result = {'result': 'FTI_GLOBAL_FRONTEND_INSTALLED', 'root': str(root), 'backup': str(backup),
                  'frontendRevision': REV, 'backendRevision': cfg['sourceRevision'],
                  'contractsChanged': False, 'servicesRestarted': False, 'fundsMoved': False,
                  'note': 'Frontend only; old contract limits stay in force. Public domain routing is unchanged.'}
        save_new(backup / 'result.json', (json.dumps(result, indent=2) + '\n').encode())
    except BaseException:
        conflicts = []
        for p, (before, metadata) in originals.items():
            now = regular(root / p)[0]
            if now == rendered[p]:
                replace(root / p, before, metadata)
            elif now != before:
                conflicts.append(p)
        if conflicts:
            raise RuntimeError('CONCURRENT_EDIT_PRESERVED_REVIEW_BACKUP') from None
        # Immutable assets remain for clients holding an intermediate HTML document.
        raise
    return result


def restore(root, backup, cfg, get, identity=lambda: None):
    info = json.loads(regular(backup / 'record.json')[0])
    require(info.get('schema') == 'FTI_GLOBAL_FRONTEND_OVERLAY_V1'
            and info.get('root') == str(root) and info.get('frontendRevision') == REV,
            'WRONG_BACKUP')
    require(set(info['files']) == set(ENTRYPOINTS), 'INVALID_BACKUP_FILES')
    require(info['configSHA256'] == sha(json.dumps(cfg, sort_keys=True).encode())
            and protected_hashes(root) == info['protected'], 'BACKEND_CHANGED_SINCE_INSTALL')
    plans = []
    for p, item in info['files'].items():
        require(item['backupName'] in ('0.before.html', '1.before.html'), 'UNSAFE_BACKUP_NAME')
        before = regular(backup / item['backupName'])[0]
        current, metadata = regular(root / p)
        require(sha(before) == item['before'], 'BACKUP_HASH_MISMATCH')
        require(sha(current) in (item['before'], item['after']), 'LATER_HTML_EDIT_NOT_OVERWRITTEN')
        plans.append((p, before, current, metadata))
    identity()
    for p, before, current, metadata in plans:
        require(regular(root / p)[0] == current, 'CONCURRENT_RESTORE_EDIT')
        if current != before:
            replace(root / p, before, metadata)
    require(all(get(route)[0] == before for p, before, _, _ in plans for route in ENTRYPOINTS[p]),
            'RESTORE_HTTP_CHECK_FAILED')
    return {'result': 'FTI_GLOBAL_FRONTEND_RESTORED', 'root': str(root), 'fundsMoved': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, required=True, choices=[3110])
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--restore', type=Path)
    args = parser.parse_args()
    require(os.geteuid() == 0, 'RUN_AS_ROOT_ON_FTI_SERVER')
    require(not (args.apply and args.restore), 'CHOOSE_APPLY_OR_RESTORE')
    root, pid, node = identify(args.port)
    get = lambda route: local_get(args.port, route)
    cfg = read_config(get)
    identity = lambda: require(identify(args.port) == (root, pid, node), 'SERVING_PROCESS_CHANGED')
    require(sha(regular(root / 'package-lock.json')[0]) == MANIFEST['source']['package-lock.json'],
            'INSTALLED_DEPENDENCIES_CHANGED')
    if not args.apply and not args.restore:
        check_old_entries(root, get)
        print(json.dumps({'result': 'FTI_GLOBAL_FRONTEND_PREFLIGHT_PASS', 'root': str(root),
                          'backendRevision': cfg['sourceRevision'], 'frontendRevision': REV,
                          'installed': False}, indent=2))
        return
    BACKUPS.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(not BACKUPS.is_symlink() and BACKUPS.stat().st_mode & 0o077 == 0,
            'PRIVATE_BACKUP_DIRECTORY_REQUIRED')
    fd = os.open(BACKUPS / ('lock-' + sha(str(root).encode())[:20]),
                 os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.restore:
            backup = args.restore.resolve(strict=True)
            require(backup.parent == BACKUPS.resolve(), 'BACKUP_OUTSIDE_PRIVATE_DIRECTORY')
            result = restore(root, backup, cfg, get, identity)
        else:
            with tempfile.TemporaryDirectory(prefix='fti-global-build-') as work:
                stage = Path(work)
                before_build = protected_hashes(root)
                print('FTI_FRONTEND_STAGE=download_verified_source', flush=True)
                raw, _ = fetch('https://codeload.github.com/Rezamoradifar/fti-protocol/tar.gz/' + REV,
                               12_000_000)
                source_from_archive(raw, stage)
                print('FTI_FRONTEND_STAGE=isolated_build_and_38_tests', flush=True)
                assets = build_sources(root, stage, node)
                identity()
                require(protected_hashes(root) == before_build, 'BACKEND_CHANGED_DURING_BUILD')
                rendered = render_entries(stage, assets)
                print('FTI_FRONTEND_STAGE=verified_static_install', flush=True)
                result = install(root, assets, rendered, cfg, get, BACKUPS, identity)
        print(json.dumps(result, indent=2))
    finally:
        os.close(fd)


if __name__ == '__main__':
    os.umask(0o077)
    # A normal termination rolls back installed HTML; SIGKILL/power loss needs --restore.
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        code = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print('FTI_GLOBAL_FRONTEND_FAILED: ' + code, file=sys.stderr)
        sys.exit(1)
