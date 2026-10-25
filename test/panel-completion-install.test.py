"""Local installer transaction fixtures; never contact production or submit a wallet request."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
m = load('panel_completion', ROOT / 'tools/install-panel-completion.py')
pro = load('professional_predecessor', ROOT / 'tools/install-professional-user-panel-release.py')
PRO = pro.payload(pro.RELEASE)
APP = b"import './vendor/ethers.js';const bridge=()=>import('./vendor/walletconnect.js');const markers='retry-pending-check member-command-hero member-support-form';"
SDK = b"export const bridge='" + b'x' * 51_000 + b"';"
BOOT = b'/* preserved reviewed boot */'
STYLE = b'<style data-fti-boot-style>body{color:white}</style>'
SHELL = b'<div id="root"><!-- FTI_BOOT_FALLBACK_BEGIN --><section>Loading</section><!-- FTI_BOOT_FALLBACK_END --></div><noscript>Enable JavaScript</noscript>'
OVERLAY = b"const channel='https://t.me/FTIProtocol_Official';"
ETHERS = b'reviewed ethers runtime fixture'
GLOBAL = b'.market-chart text{display:block}.market-axis-labels{display:flex}' + b'/* reviewed shared styles */' * 4
OLD_GLOBAL = b'original reviewed shared interface'
RUNTIME = {name: ("export const name=" + repr(name) + ';').encode() for name in m.RUNTIME_FILES}
RUNTIME[m.ENTRY] = b"import './member-history.mjs';import './support-tickets.mjs';import './operational-release.mjs';export const startWeb=()=>{};"


def fixture_release():
    canonical = {f'scripts/frozen-{i:03d}.mjs': m.compressed(b'export const frozen=true;') for i in range(100)}
    canonical[m.ENTRY] = m.compressed(b'original reviewed server')
    canonical['scripts/site-routing.mjs'] = m.compressed(b'original route policy')
    canonical['scripts/continuity-release.mjs'] = m.compressed(b'unchanged release verifier')
    canonical['scripts/keeper.mjs'] = m.compressed(b'unchanged keeper')
    return {'schema': 'FTI_PANEL_COMPLETION_V1', 'app': m.compressed(APP),
        'sdk': m.compressed(SDK), 'sdkLegal': m.compressed(b'reviewed legal notice'),
        'css': m.compressed(PRO[1]), 'image': m.compressed(PRO[2]),
        'runtime': {name: m.compressed(data) for name, data in RUNTIME.items()},
        'required': {'scripts/site-routing.mjs': [m.sha(b'original route policy')]},
        'canonical': canonical,
        'professional': {key: m.compressed(value) for key, value in zip(('app', 'css', 'image'), PRO)}}


class CompletionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.workspace = Path(self.temp.name)
        self.root = self.workspace / 'original'
        self.root.mkdir()
        self.release = fixture_release()
        self.baselines = copy.deepcopy(m.BASELINES)
        for key, baseline in self.baselines.items():
            baseline['appSHA'] = m.sha(('old app ' + key).encode())
            baseline['cssSHA'] = m.sha(('old css ' + key).encode())
            baseline['imageSHA'] = m.sha(('old art ' + key).encode())
            if 'boot' in baseline:
                baseline.update(bootSHA=m.sha(BOOT), styleSHA=m.sha(STYLE), shellSHA=m.sha(SHELL))
        self.saved = {'WorkingDirectory': str(self.root), 'User': 'fti-v3', 'Group': 'fti-v3',
            'FragmentPath': '/test/unit.service', 'DropInPaths': '', 'MainPID': '123',
            'ActiveState': 'active', 'SubState': 'running',
            'ExecStart': '/test/node ' + str(self.root / 'scripts/server.mjs')}
        self.cfg = dict(m.CONFIG, stateReaderVersion=1, eventHistoryVersion=1)
        self.server_before = b'original reviewed server'
        self.cache_before = b'original reviewed cache'
        self.before_cfg = copy.deepcopy(self.cfg)
        self.metadata = {'/test/unit.service': [1, 2, 100, 200, 0, 0, 0o644]}
        self.restart_count = 0
        self.calls = []
        self.fail_asset = False
        self.fail_import = False
        self.fail_new_web = False
        self.concurrent_file = None
        self.before_html = b''
        files = {'scripts/server.mjs': self.server_before,
            'scripts/history-cache.mjs': self.cache_before,
            'scripts/state-reader.mjs': b'original state reader',
            'scripts/site-routing.mjs': b'original route policy',
            'scripts/continuity-release.mjs': b'unchanged release verifier',
            'scripts/keeper.mjs': b'unchanged keeper',
            'web/app.js': b'unchanged root app',
            'node_modules/ethers/dist/ethers.min.js': ETHERS,
            'web/vendor/walletconnect.js': b'unchanged root wallet bridge',
            'landing/dist/index.html': b'unchanged landing',
            'web/' + m.BASE + '/app.js': b'original base app',
            'web/' + m.BASE + '/app.js.LEGAL.txt': b'original legal',
            'web/' + m.BASE + '/vendor/ethers.js': ETHERS,
            'web/' + m.BASE + '/vendor/walletconnect.js': b'unchanged immutable wallet bridge',
            'web/' + m.BASE + '/style.css': b'unchanged original shared style',
            'web/' + m.BASE + '/global-interface.css': OLD_GLOBAL,
            'web' + m.REFERRAL + 'referral-context.js': b'preserved referral context',
            'web' + m.REFERRAL + 'entry.js': b'preserved referral entry',
            'web' + m.OFFICIAL_OVERLAY: OVERLAY,
            '.env': b'operator secret fixture; installer must not read or change',
            'data/users.json': b'operator user data fixture',
            'artifacts/MockUSD.json': b'{}'}
        for key, baseline in self.baselines.items():
            files['web' + baseline['app']] = ('old app ' + key).encode()
            files['web' + baseline['entry']] = m.entry_code(baseline['app'])
            files['web' + baseline['css']] = ('old css ' + key).encode()
            files['web' + baseline['image']] = ('old art ' + key).encode()
            if 'boot' in baseline:
                files['web' + baseline['boot']] = BOOT
        self.files = files
        for name, data in files.items():
            file = self.root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(data)
        (self.root / 'node_modules').mkdir(exist_ok=True)
        blob = files['web' + m.REFERRAL + 'referral-context.js']
        referral_hash = m.hashlib.sha1(b'blob ' + str(len(blob)).encode() + b'\0' + blob).hexdigest()
        patches = [patch.object(m, 'BASELINES', self.baselines),
            patch.object(m, 'BASE_APP', m.sha(b'original base app')),
            patch.object(m, 'ETHERS_SHA', m.sha(ETHERS)),
            patch.object(m, 'BASE_GLOBAL_CSS_SHA', m.sha(OLD_GLOBAL)),
            patch.object(m, 'LEGAL', m.sha(b'original legal')),
            patch.object(m, 'REFERRAL_BLOB', referral_hash),
            patch.object(m, 'OFFICIAL_OVERLAY_SHA', m.sha(OVERLAY)),
            patch.object(m, 'SERVER_BASES', (m.sha(self.server_before),)),
            patch.object(m, 'CACHE_BASES', (m.sha(self.cache_before),)),
            patch.object(m, 'BACKUPS', self.workspace / 'backups'),
            patch.object(m, 'DROP_FOLDER', self.workspace / 'unit.d'),
            patch.object(m, 'SUPPORT_ROOT', self.workspace / 'support'),
            patch.object(m, 'active_service', side_effect=lambda: (dict(self.saved), Path(self.saved['WorkingDirectory']))),
            patch.object(m, 'unit_properties', side_effect=lambda: dict(self.saved)),
            patch.object(m, 'unit_metadata', side_effect=self.unit_metadata),
            patch.object(m, 'reload_units', side_effect=self.reload),
            patch.object(m, 'fingerprint_preflight', side_effect=self.fingerprint),
            patch.object(m, 'node_executable', return_value='/test/node'),
            patch.object(m, 'config', side_effect=lambda expected=None: dict(self.cfg)),
            patch.object(m, 'served', side_effect=self.served),
            patch.object(m, 'fetch', side_effect=self.fetch),
            patch.object(m, 'restart_web', side_effect=self.restart),
            patch.object(m, 'wait_web', side_effect=self.verify_new_web),
            patch.object(m, 'probe_member_apis'),
            patch.object(m, 'storage_namespace_check'),
            patch.object(m.subprocess, 'run', side_effect=self.command),
            patch.object(m.pwd, 'getpwnam', return_value=types.SimpleNamespace(pw_uid=os.geteuid(), pw_gid=os.getegid())),
            patch.object(m.grp, 'getgrnam', return_value=types.SimpleNamespace(gr_gid=os.getegid()))]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)
        self.use_baseline('panel-reliability')
        self.original_files = {p.relative_to(self.root).as_posix(): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}

    def write(self, name, data):
        file = self.root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)

    def baseline_html(self, key, overlay=True):
        b = m.completion_baselines(PRO)[key]
        boot = 'boot' in b
        return (b'<html><head><link rel="stylesheet" href="/' + m.BASE.encode() + b'/style.css">' +
            m.css_link(m.BASE_GLOBAL_CSS) +
            m.css_link(b['css']) + (STYLE if boot else b'') + b'</head><body>' +
            (SHELL if boot else b'<div id="root"></div>') +
            (('<script defer src="' + b['boot'] + '" data-fti-boot-guard></script>').encode() if boot else b'') +
            m.script_tag(b['entry'], boot) + (m.script_tag(m.OFFICIAL_OVERLAY) if overlay else b'') + b'</body></html>')

    def use_baseline(self, key):
        if key == 'professional-user-panel':
            b = m.completion_baselines(PRO)[key]
            for name, data in [('app', PRO[0]), ('css', PRO[1]), ('image', PRO[2])]:
                self.write('web' + b[name], data)
            self.write('web' + b['entry'], m.entry_code(b['app']))
        self.before_html = self.baseline_html(key)
        self.write('web/index.html', self.before_html)

    def served(self, url, data, kind='html'):
        self.calls.append(url)
        from urllib.parse import urlsplit
        path = urlsplit(url).path
        root = Path(self.saved['WorkingDirectory'])
        file = root / ('node_modules/ethers/dist/ethers.min.js' if path == '/vendor/ethers.js' else 'web/index.html' if path in m.ROUTES else 'web' + path)
        actual = file.read_bytes()
        self.assertEqual(actual, data)
        if self.fail_asset and '/fti-panel-completion-' in path:
            raise RuntimeError('fixture asset verification failure')

    def fetch(self, url):
        from urllib.parse import urlsplit
        path = urlsplit(url).path
        if path == '/health':
            return json.dumps({'ok': True, 'chainId': 56, 'block': 100}).encode(), 'application/json'
        return (Path(self.saved['WorkingDirectory']) / ('web' + path)).read_bytes(), 'application/octet-stream'

    def command(self, argv, **kwargs):
        if '--eval' in argv:
            if self.concurrent_file:
                self.write(self.concurrent_file, b'foreign operator edit')
            if self.fail_import:
                raise RuntimeError('fixture module import failure')
        return subprocess.CompletedProcess(argv, 0, b'', b'')

    def restart(self):
        self.restart_count += 1
        self.saved['MainPID'] = str(123 + self.restart_count)
        if m.dropin_path().exists():
            self.cfg.update(supportTicketVersion=1, memberHistoryVersion=1, stateReaderVersion=1, eventHistoryVersion=1)
        else:
            self.cfg = copy.deepcopy(self.before_cfg)

    def unit_metadata(self, saved):
        result = dict(self.metadata)
        for drop in m.DROP_FOLDER.glob('*.conf'):
            info = drop.stat()
            result[str(drop)] = [info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
                                 info.st_uid, info.st_gid, info.st_mode & 0o777]
        return result

    def reload(self):
        drop = m.dropin_path()
        previous = m.DROP_FOLDER / m.PREVIOUS_DROP_NAME
        if not drop.exists() and previous.exists():
            drop = previous
        if drop.exists():
            text = drop.read_text()
            self.saved['WorkingDirectory'] = next(line.split('=', 1)[1] for line in text.splitlines() if line.startswith('WorkingDirectory='))
            self.saved['ExecStart'] = next(line.split('=', 1)[1] for line in reversed(text.splitlines()) if line.startswith('ExecStart='))
            self.saved['DropInPaths'] = ' '.join(str(p) for p in sorted(m.DROP_FOLDER.glob('*.conf')))
        else:
            self.saved['WorkingDirectory'] = str(self.root)
            self.saved['ExecStart'] = '/test/node ' + str(self.root / 'scripts/server.mjs')
            self.saved['DropInPaths'] = ''

    def fingerprint(self, stage, node, cfg, account):
        if getattr(self, 'fail_fingerprint', False):
            raise RuntimeError('SOURCE_MANIFEST_MISMATCH_RECOVER_SOURCE_FIRST')
        return {'sourceFingerprint': cfg['sourceFingerprint']}

    def stage(self):
        return self.root.parent / m.release_name(self.release)

    def overlay(self):
        name, _ = m.overlay_files(RUNTIME)
        return self.stage() / name

    def verify_new_web(self, cfg, html, assets):
        if self.fail_new_web:
            raise RuntimeError('fixture new web API unavailable')
        return m.check_new_web(cfg, html, assets)

    def backup(self):
        return next(m.BACKUPS.glob('install-*'))

    def assert_original(self):
        self.assertEqual((self.root / 'web/index.html').read_bytes(), self.before_html)
        self.assertEqual((self.root / m.ENTRY).read_bytes(), self.server_before)
        self.assertEqual((self.root / 'scripts/history-cache.mjs').read_bytes(), self.cache_before)
        for name in ('scripts/member-history.mjs', 'scripts/support-tickets.mjs', 'core/history-read-policy.mjs'):
            self.assertFalse((self.root / name).exists())
        for name, data in self.files.items():
            self.assertEqual((self.root / name).read_bytes(), data, name)

    def test_preflight_does_not_write_or_restart(self):
        before = sorted(str(p.relative_to(self.root)) for p in self.root.rglob('*'))
        m.install_completion(self.release)
        self.assertEqual(before, sorted(str(p.relative_to(self.root)) for p in self.root.rglob('*')))
        self.assertEqual(self.restart_count, 0)
        self.assert_original()

    def test_canonical_ethers_route_needs_no_web_vendor_copy(self):
        self.assertFalse((self.root / 'web/vendor/ethers.js').exists())
        m.install_completion(self.release)
        self.assertIn(m.PUBLIC + '/vendor/ethers.js', self.calls)
        m.install_completion(self.release, apply=True)
        self.assertFalse((self.stage() / 'web/vendor/ethers.js').exists())
        m.install_completion(self.release)
        m.restore_completion(self.backup())
        self.assert_original()

    def test_optional_web_vendor_copy_is_preserved(self):
        shadow = self.root / 'web/vendor/ethers.js'
        self.write('web/vendor/ethers.js', b'optional unused copy')
        m.install_completion(self.release, apply=True)
        m.install_completion(self.release)
        m.restore_completion(self.backup())
        self.assertEqual(shadow.read_bytes(), b'optional unused copy')

    def test_missing_or_unreviewed_actual_ethers_fails_before_switch(self):
        actual = self.root / 'node_modules/ethers/dist/ethers.min.js'
        actual.write_bytes(b'unreviewed library')
        with self.assertRaisesRegex(RuntimeError, 'UNREVIEWED_ETHERS_RUNTIME'):
            m.install_completion(self.release, apply=True)
        self.assertEqual(self.restart_count, 0)
        self.assertFalse(self.stage().exists())

    def test_ethers_concurrency_and_optional_presence_are_protected(self):
        baseline = m.completion_baselines(PRO)['panel-reliability']
        pins = m.capture_protected(self.root, self.release['required'], baseline, True)
        self.assertIsNone(pins['web/vendor/ethers.js'])
        self.write('web/vendor/ethers.js', b'concurrent new copy')
        with self.assertRaisesRegex(RuntimeError, 'PROTECTED_RUNTIME_CHANGED'):
            m.check_protected(self.root, pins)
        (self.root / 'web/vendor/ethers.js').unlink()
        self.write('node_modules/ethers/dist/ethers.min.js', b'concurrent SDK edit')
        with self.assertRaisesRegex(RuntimeError, 'PROTECTED_RUNTIME_CHANGED'):
            m.check_protected(self.root, pins)

    def test_arbitrary_dependency_symlink_and_absolute_backup_pin_rejected(self):
        other = self.workspace / 'other'; other.mkdir()
        import shutil
        shutil.rmtree(self.root / 'node_modules')
        (self.root / 'node_modules').symlink_to(other, target_is_directory=True)
        with self.assertRaises((OSError, RuntimeError, KeyError)):
            m.install_completion(self.release, apply=True)
        (self.root / 'node_modules').unlink()
        self.write('node_modules/ethers/dist/ethers.min.js', ETHERS)
        with self.assertRaisesRegex(RuntimeError, 'UNSAFE_PROTECTED_PATH'):
            m.check_protected(self.root, {'/etc/shadow': 'untrusted'})

    def test_read_only_preflight_verifies_old_source_as_service_user(self):
        calls = []
        with patch.object(m, 'fingerprint_preflight', side_effect=lambda *args: calls.append(args)):
            m.install_completion(self.release)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], self.root)
        self.assertEqual(calls[0][2]['sourceFingerprint'], self.cfg['sourceFingerprint'])
        self.assertEqual(calls[0][3].pw_uid, os.geteuid())
        self.assertEqual(calls[0][3].pw_gid, os.getegid())
        self.assertFalse(self.stage().exists())
        self.assertEqual(self.restart_count, 0)
        self.assert_original()

    def test_reliability_install_and_restore(self):
        m.install_completion(self.release, apply=True)
        self.assertEqual(self.restart_count, 1)
        _, expected = m.overlay_files(RUNTIME)
        self.assertEqual({p.name: p.read_bytes() for p in self.overlay().iterdir()}, expected)
        self.assertNotEqual((self.stage() / 'web/index.html').read_bytes(), self.before_html)
        self.assertEqual((self.root / 'web/index.html').read_bytes(), self.before_html)
        for name in ('web/vendor/walletconnect.js', 'web/' + m.BASE + '/vendor/walletconnect.js', '.env', 'data/users.json'):
            self.assertEqual((self.root / name).read_bytes(), self.files[name])
        m.restore_completion(self.backup())
        self.assertEqual(self.restart_count, 2)
        self.assert_original()

    def test_professional_predecessor_install(self):
        self.use_baseline('professional-user-panel')
        m.install_completion(self.release, apply=True)
        self.assertEqual(self.restart_count, 1)
        _, expected = m.overlay_files(RUNTIME)
        self.assertEqual({p.name: p.read_bytes() for p in self.overlay().iterdir()}, expected)
        m.restore_completion(self.backup())
        self.assert_original()

    def test_reserve_predecessor_install(self):
        self.use_baseline('member-reserve')
        m.install_completion(self.release, apply=True)
        self.assertEqual(self.restart_count, 1)
        m.restore_completion(self.backup())
        self.assert_original()

    def test_repeat_install_is_read_only(self):
        m.install_completion(self.release, apply=True)
        backups = list(m.BACKUPS.glob('*'))
        m.install_completion(self.release, apply=True)
        self.assertEqual(self.restart_count, 1)
        self.assertEqual(list(m.BACKUPS.glob('*')), backups)

    def test_default_repeat_preflight_never_writes_storage_canary(self):
        m.install_completion(self.release, apply=True)
        with patch.object(m, 'storage_namespace_check') as probe:
            m.install_completion(self.release)
            probe.assert_not_called()
        self.assertEqual(self.restart_count, 1)

    def test_invalid_new_asset_rolls_back_without_restart(self):
        self.fail_fingerprint = True
        with self.assertRaisesRegex(RuntimeError, 'SOURCE_MANIFEST_MISMATCH'):
            m.install_completion(self.release, apply=True)
        self.assertEqual(self.restart_count, 0)
        self.assert_original()

    def test_import_failure_restores_before_restart(self):
        self.fail_import = True
        with self.assertRaisesRegex(RuntimeError, 'import failure'):
            m.install_completion(self.release, apply=True)
        self.assertEqual(self.restart_count, 0)
        self.assert_original()

    def test_failed_post_restart_api_verification_rolls_back(self):
        self.fail_new_web = True
        with self.assertRaisesRegex(RuntimeError, 'new web API'):
            m.install_completion(self.release, apply=True)
        self.assertEqual(self.restart_count, 2)
        self.assert_original()

    def test_concurrent_server_edit_preserved(self):
        self.concurrent_file = m.ENTRY
        with self.assertRaisesRegex(RuntimeError, 'PROTECTED_RUNTIME_CHANGED'):
            m.install_completion(self.release, apply=True)
        self.assertEqual((self.root / m.ENTRY).read_bytes(), b'foreign operator edit')
        self.assertEqual(self.restart_count, 0)
        self.assertEqual((self.root / 'web/index.html').read_bytes(), self.before_html)

    def test_private_storage_namespace_failure_rolls_back_web_only(self):
        with patch.object(m, 'storage_namespace_check', side_effect=RuntimeError('namespace write denied')):
            with self.assertRaisesRegex(RuntimeError, 'namespace write denied'):
                m.install_completion(self.release, apply=True)
        self.assertEqual(self.restart_count, 2)
        self.assertFalse(m.dropin_path().exists())
        self.assert_original()

    def test_missing_namespace_tools_rejected_in_read_only_preflight(self):
        with patch.object(m.shutil, 'which', return_value=None):
            with self.assertRaisesRegex(RuntimeError, 'SERVICE_NAMESPACE_CHECK_TOOLS_REQUIRED'):
                m.install_completion(self.release, apply=True)
        self.assertEqual(self.restart_count, 0)
        self.assertFalse(m.BACKUPS.exists())
        self.assert_original()

    def test_manual_restore_refuses_concurrent_html(self):
        m.install_completion(self.release, apply=True)
        self.write('web/index.html', b'foreign HTML')
        with self.assertRaisesRegex(RuntimeError, 'CONCURRENT_ORIGINAL_HTML_EDIT'):
            m.restore_completion(self.backup())
        self.assertEqual((self.root / 'web/index.html').read_bytes(), b'foreign HTML')
        self.assertEqual((self.root / m.ENTRY).read_bytes(), self.server_before)

    def test_manual_restore_refuses_concurrent_dropin(self):
        m.install_completion(self.release, apply=True)
        m.dropin_path().write_bytes(b'foreign override')
        with self.assertRaisesRegex(RuntimeError, 'CONCURRENT_DROPIN_EDIT'):
            m.restore_completion(self.backup())
        self.assertEqual(m.dropin_path().read_bytes(), b'foreign override')
        self.assertEqual(Path(self.saved['WorkingDirectory']), self.stage())

    def test_support_records_survive_rollback(self):
        m.install_completion(self.release, apply=True)
        folder = m.SUPPORT_ROOT / ('56-' + self.cfg['binary'].lower())
        record = folder / 'fixture-ticket.json'
        record.write_bytes(b'private durable ticket fixture')
        m.restore_completion(self.backup())
        self.assertEqual(record.read_bytes(), b'private durable ticket fixture')

    def test_public_assets_readable_under_private_umask(self):
        previous = os.umask(0o077)
        try:
            m.install_completion(self.release, apply=True)
        finally:
            os.umask(previous)
        entry, css_url, assets = m.completion_destinations(APP, SDK, b'reviewed legal notice', PRO[1], PRO[2])
        for url in assets:
            file = self.stage() / ('web' + url)
            self.assertEqual(file.stat().st_mode & 0o777, 0o644)
            self.assertEqual(file.parent.stat().st_mode & 0o777, 0o755)
        self.assertEqual(m.SUPPORT_ROOT.stat().st_mode & 0o777, 0o755)
        private = m.SUPPORT_ROOT / ('56-' + self.cfg['binary'].lower())
        self.assertEqual(private.stat().st_mode & 0o777, 0o700)
        backup = self.backup()
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        self.assertEqual((backup / 'record.json').stat().st_mode & 0o777, 0o600)

    def test_bad_server_baseline_rejected_before_write(self):
        self.write(m.ENTRY, b'unreviewed server')
        with self.assertRaisesRegex(RuntimeError, 'UNREVIEWED_SERVER_BASELINE'):
            m.install_completion(self.release, apply=True)
        self.assertFalse(m.BACKUPS.exists())
        self.assertEqual(self.restart_count, 0)

    def test_original_extra_script_is_never_changed(self):
        self.write('scripts/support-tickets.mjs', b'operator unrelated service')
        m.install_completion(self.release, apply=True)
        self.assertEqual((self.root / 'scripts/support-tickets.mjs').read_bytes(), b'operator unrelated service')
        m.restore_completion(self.backup())
        self.assertEqual((self.root / 'scripts/support-tickets.mjs').read_bytes(), b'operator unrelated service')

    def test_fingerprint_failure_stops_before_service_switch(self):
        self.fail_fingerprint = True
        with self.assertRaisesRegex(RuntimeError, 'OLD_RELEASE_SOURCE_MANIFEST_MISMATCH.*SERVICE_UNCHANGED'):
            m.install_completion(self.release, apply=True)
        self.assertFalse(self.stage().exists())
        self.assertFalse(m.BACKUPS.exists())
        self.assertFalse(m.dropin_path().exists())
        self.assertEqual(self.restart_count, 0)
        self.assert_original()

    def test_dropin_grants_only_exact_private_support_namespace(self):
        m.install_completion(self.release, apply=True)
        text = m.dropin_path().read_text()
        expected = str(m.SUPPORT_ROOT / ('56-' + self.cfg['binary'].lower()))
        self.assertEqual([line for line in text.splitlines() if line.startswith('ReadWritePaths=')],
                         ['ReadWritePaths=' + expected])
        self.assertNotIn('ProtectSystem=', text)
        self.assertNotIn('Environment=', text)
        self.assertNotIn('EnvironmentFile=', text)
        self.assertNotIn('ReadWritePaths=\n', text)
        self.assertNotIn('keeper', text)
        m.restore_completion(self.backup())
        self.assertFalse(m.dropin_path().exists())
        self.assertEqual(self.saved['DropInPaths'], '')

    def test_interrupted_public_copy_does_not_block_clean_retry(self):
        copy = m.copy_public_tree
        calls = 0
        def interrupted(source, target, expected=None):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError('fixture interrupted public copy')
            return copy(source, target, expected)
        with patch.object(m, 'copy_public_tree', side_effect=interrupted):
            with self.assertRaisesRegex(RuntimeError, 'interrupted public copy'):
                m.install_completion(self.release, apply=True)
        self.assertFalse(self.stage().exists())
        self.assertFalse(list(self.workspace.glob('.fti-panel-completion-stage-*')))
        self.assertFalse(m.dropin_path().exists())
        self.assertEqual(self.restart_count, 0)
        self.assert_original()
        m.install_completion(self.release, apply=True)
        self.assertEqual(self.restart_count, 1)

    def assert_no_install_writes(self):
        self.assertFalse(m.BACKUPS.exists())
        self.assertFalse(m.SUPPORT_ROOT.exists())
        self.assertFalse(self.stage().exists())
        self.assertFalse(m.dropin_path().exists())
        self.assertFalse(list(self.workspace.glob('.fti-panel-completion-stage-*')))
        self.assertEqual(self.restart_count, 0)
        self.assert_original()

    def test_public_history_over_legacy_byte_limit_is_preserved(self):
        source = self.workspace / 'large-public-history'
        source.mkdir()
        data = b'/* retained immutable public asset */' + b'x' * 2_999_961
        for index in range(34):
            (source / ('old-%03d.js' % index)).write_bytes(data)
        plan = m.public_copy_plan(source)
        self.assertGreater(plan['bytes'], 100_000_000)
        destination = self.workspace / 'large-public-copy'
        m.copy_public_tree(source, destination, plan)
        self.assertEqual(len(list(destination.iterdir())), 34)
        self.assertEqual(sum(file.stat().st_size for file in destination.iterdir()), plan['bytes'])
        self.assertTrue(all(file.read_bytes() == data for file in destination.iterdir()))

    def test_public_history_over_legacy_file_limit_is_preserved(self):
        source = self.workspace / 'many-public-history'
        source.mkdir()
        for index in range(4001):
            (source / ('old-%04d.js' % index)).write_bytes(b'/* retained */')
        plan = m.public_copy_plan(source)
        self.assertGreater(len(plan['files']), 4000)
        destination = self.workspace / 'many-public-copy'
        m.copy_public_tree(source, destination, plan)
        self.assertEqual(len(list(destination.iterdir())), 4001)
        self.assertTrue(all(file.read_bytes() == b'/* retained */' for file in destination.iterdir()))

    def test_public_byte_budget_is_global_and_checked_before_writes(self):
        plan = m.public_runtime_plan(self.root)
        largest_tree = max(item['bytes'] for item in plan.values())
        total = sum(item['bytes'] for item in plan.values())
        self.assertLess(largest_tree, total)
        with patch.object(m, 'PUBLIC_COPY_MAX_BYTES', largest_tree):
            with self.assertRaisesRegex(RuntimeError, 'PUBLIC_RUNTIME_COPY_BUDGET_EXCEEDED'):
                m.install_completion(self.release, apply=True)
        self.assert_no_install_writes()

    def test_public_entry_budget_is_global_and_checked_before_writes(self):
        plan = m.public_runtime_plan(self.root)
        largest_tree = max(item['entries'] for item in plan.values())
        total = sum(item['entries'] for item in plan.values())
        self.assertLess(largest_tree, total)
        with patch.object(m, 'PUBLIC_COPY_MAX_ENTRIES', largest_tree):
            with self.assertRaisesRegex(RuntimeError, 'PUBLIC_RUNTIME_COPY_BUDGET_EXCEEDED'):
                m.install_completion(self.release, apply=True)
        self.assert_no_install_writes()

    def test_public_directory_entries_consume_budget(self):
        source = self.workspace / 'public-directories'
        source.mkdir()
        for index in range(30):
            (source / ('empty-%03d' % index)).mkdir()
        plan = m.public_copy_plan(source)
        self.assertEqual(plan['bytes'], 0)
        self.assertEqual(plan['files'], {})
        self.assertEqual(len(plan['directories']), 31)
        self.assertGreaterEqual(plan['entries'], 30)
        with patch.object(m, 'PUBLIC_COPY_MAX_ENTRIES', 20):
            with self.assertRaisesRegex(RuntimeError, 'PUBLIC_RUNTIME_COPY_BUDGET_EXCEEDED'):
                m.public_copy_plan(source)

    def test_public_budget_error_identifies_tree_and_measured_totals(self):
        source = self.workspace / 'oversized-public-history'
        source.mkdir()
        (source / 'public.js').write_bytes(b'123456789')
        with patch.object(m, 'PUBLIC_COPY_MAX_BYTES', 8):
            with self.assertRaisesRegex(RuntimeError, 'PUBLIC_RUNTIME_COPY_BUDGET_EXCEEDED') as failure:
                m.public_copy_plan(source)
        diagnostic = str(failure.exception)
        self.assertIn(source.name, diagnostic)
        self.assertIn('bytes', diagnostic)
        self.assertIn('entries', diagnostic)

    def test_public_copy_space_uses_measured_bytes_and_payload_headroom(self):
        plan = m.public_runtime_plan(self.root)
        extra = 123_456
        required_bytes = sum(item['bytes'] for item in plan.values()) + extra + m.PUBLIC_COPY_HEADROOM_BYTES
        required_inodes = sum(item['entries'] for item in plan.values()) + m.STAGE_EXTRA_INODES
        space = types.SimpleNamespace(f_bavail=required_bytes, f_frsize=1, f_favail=required_inodes)
        with patch.object(m.os, 'statvfs', return_value=space):
            m.check_public_copy_space(self.root, plan, extra)
            with self.assertRaisesRegex(RuntimeError, 'INSUFFICIENT_FREE_SPACE_OR_INODES'):
                m.check_public_copy_space(self.root, plan, extra + 1)
        space.f_bavail += 1
        space.f_favail -= 1
        with patch.object(m.os, 'statvfs', return_value=space):
            with self.assertRaisesRegex(RuntimeError, 'INSUFFICIENT_FREE_SPACE_OR_INODES'):
                m.check_public_copy_space(self.root, plan, extra)

    def test_insufficient_public_copy_space_or_inodes_stops_preflight_before_writes(self):
        for available_bytes, available_inodes in ((0, 100_000), (10**12, 0)):
            with self.subTest(bytes=available_bytes, inodes=available_inodes):
                space = types.SimpleNamespace(f_bavail=available_bytes, f_frsize=1, f_favail=available_inodes)
                with patch.object(m.os, 'statvfs', return_value=space):
                    with self.assertRaisesRegex(RuntimeError, 'INSUFFICIENT_FREE_SPACE_OR_INODES'):
                        m.install_completion(self.release)
                self.assert_no_install_writes()

    def test_changed_public_source_is_rejected_before_destination_writes(self):
        for change in ('edit', 'add', 'remove', 'directory', 'permissions'):
            with self.subTest(change=change):
                source = self.workspace / ('public-source-' + change)
                source.mkdir()
                file = source / 'public.js'
                file.write_bytes(b'original')
                plan = m.public_copy_plan(source)
                if change == 'edit':
                    info = file.stat()
                    file.write_bytes(b'modified')
                    os.utime(file, ns=(info.st_atime_ns, info.st_mtime_ns + 1_000_000_000))
                elif change == 'add':
                    (source / 'new.js').write_bytes(b'added')
                elif change == 'remove':
                    file.unlink()
                elif change == 'directory':
                    (source / 'new-directory').mkdir()
                else:
                    file.chmod(0o600)
                destination = self.workspace / ('changed-public-copy-' + change)
                with self.assertRaisesRegex(RuntimeError, 'PUBLIC_RUNTIME_CHANGED_DURING_COPY'):
                    m.copy_public_tree(source, destination, plan)
                self.assertFalse(destination.exists())

    def test_install_uses_preflight_public_plan_and_rolls_back_source_drift(self):
        prepare = m.prepare_stage
        def changed_after_preflight(*args, **kwargs):
            self.write('web/late-public.js', b'concurrent public file')
            return prepare(*args, **kwargs)
        with patch.object(m, 'prepare_stage', side_effect=changed_after_preflight):
            with self.assertRaisesRegex(RuntimeError, 'PUBLIC_RUNTIME_CHANGED_DURING_COPY'):
                m.install_completion(self.release, apply=True)
        self.assertFalse(self.stage().exists())
        self.assertFalse(list(self.workspace.glob('.fti-panel-completion-stage-*')))
        self.assertFalse(m.dropin_path().exists())
        self.assertEqual(self.restart_count, 0)
        self.assertEqual((self.root / 'web/late-public.js').read_bytes(), b'concurrent public file')
        self.assert_original()

    def test_unsafe_public_hardlink_and_oversized_file_stop_before_install_writes(self):
        file = self.root / 'web/public-extra.js'
        file.write_bytes(b'public fixture')
        hardlink = self.workspace / 'linked-public.js'
        os.link(file, hardlink)
        with self.assertRaisesRegex(RuntimeError, 'UNSAFE_FILE'):
            m.install_completion(self.release, apply=True)
        self.assert_no_install_writes()
        hardlink.unlink()
        with file.open('wb') as stream:
            stream.truncate(m.LIMIT + 1)
        with self.assertRaisesRegex(RuntimeError, 'UNSAFE_FILE'):
            m.install_completion(self.release, apply=True)
        self.assert_no_install_writes()

    def test_atomic_stage_publish_preserves_foreign_empty_directory(self):
        temporary = self.workspace / 'temporary-stage'
        temporary.mkdir()
        (temporary / 'owned.txt').write_bytes(b'owned candidate')
        foreign = self.workspace / 'foreign-stage'
        foreign.mkdir()
        with self.assertRaisesRegex(RuntimeError, 'STAGE_PUBLISH_COLLISION_PRESERVED'):
            m.publish_stage(temporary, foreign)
        self.assertEqual(list(foreign.iterdir()), [])
        self.assertEqual((temporary / 'owned.txt').read_bytes(), b'owned candidate')

    def test_stage_reused_after_successful_rollback(self):
        m.install_completion(self.release, apply=True)
        m.restore_completion(self.backup())
        stage_files = m.stage_inventory(self.stage())
        m.install_completion(self.release, apply=True)
        self.assertEqual(m.stage_inventory(self.stage()), stage_files)
        self.assertEqual(self.restart_count, 3)

    def test_stage_inventory_detects_foreign_edits_before_retry(self):
        m.install_completion(self.release, apply=True)
        m.restore_completion(self.backup())
        (self.overlay() / 'server.mjs').write_bytes(b'foreign overlay server')
        with self.assertRaisesRegex(RuntimeError, 'STAGED_RELEASE_CHANGED'):
            m.install_completion(self.release, apply=True)
        self.assertEqual(self.restart_count, 2)

    def test_changed_protected_rpc_reader_rejected(self):
        self.write('scripts/site-routing.mjs', b'operator change')
        with self.assertRaisesRegex(RuntimeError, 'PROTECTED_RUNTIME_PIN_MISMATCH'):
            m.install_completion(self.release, apply=True)
        self.assertEqual(self.restart_count, 0)

    def test_changed_boot_or_overlay_rejected(self):
        for name in ('web' + self.baselines['panel-reliability']['boot'], 'web' + m.OFFICIAL_OVERLAY):
            with self.subTest(name=name):
                old = (self.root / name).read_bytes()
                self.write(name, b'foreign content')
                with self.assertRaisesRegex(RuntimeError, 'PIN_MISMATCH'):
                    m.install_completion(self.release, apply=True)
                self.write(name, old)

    def test_private_data_dir_symlink_rejected(self):
        m.SUPPORT_ROOT.symlink_to(self.root / 'data', target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'SYMLINK_REJECTED'):
            m.install_completion(self.release, apply=True)
        self.assertEqual(self.restart_count, 0)

    def test_public_tree_symlink_rejected_without_switch(self):
        (self.root / 'web/foreign.js').symlink_to(self.root / '.env')
        with self.assertRaisesRegex(RuntimeError, 'SYMLINK_REJECTED'):
            m.install_completion(self.release, apply=True)
        self.assert_no_install_writes()

    def test_private_file_in_public_tree_rejected_without_switch(self):
        self.write('web/.env', b'private fixture')
        with self.assertRaisesRegex(RuntimeError, 'PRIVATE_OR_UNKNOWN_PUBLIC_FILE_REJECTED'):
            m.install_completion(self.release, apply=True)
        self.assert_no_install_writes()

    def test_sdk_rewritten_to_new_immutable_url(self):
        _, _, assets = m.completion_destinations(APP, SDK, b'legal', PRO[1], PRO[2])
        app = next(data for url, (data, kind) in assets.items() if url.endswith('/app.js'))
        self.assertNotIn(b'./vendor/', app)
        self.assertIn(('/' + m.BASE + '/vendor/ethers.js').encode(), app)
        sdk_url = next(url for url in assets if url.endswith('/walletconnect.js'))
        self.assertIn(sdk_url.encode(), app)
        self.assertNotEqual(sdk_url, '/' + m.BASE + '/vendor/walletconnect.js')

    def test_payload_hash_and_manifest_reject_corruption(self):
        for key in ('app', 'sdk', 'sdkLegal', 'css', 'image'):
            with self.subTest(key=key):
                bad = copy.deepcopy(self.release)
                bad[key]['sha256'] = '0' * 64
                with self.assertRaisesRegex(RuntimeError, 'HASH_MISMATCH'):
                    m.completion_payload(bad)
        bad = copy.deepcopy(self.release)
        bad['runtime']['../unsafe'] = m.compressed(b'unsafe')
        with self.assertRaisesRegex(RuntimeError, 'UNEXPECTED_RUNTIME_MANIFEST'):
            m.completion_payload(bad)

    def test_ambiguous_or_unknown_html_rejected(self):
        for html in (b'<html><head></head><body><div id="root"></div></body></html>',
                self.before_html.replace(b'</body>', m.script_tag('/foreign.js') + b'</body>')):
            self.write('web/index.html', html)
            with self.assertRaisesRegex(RuntimeError, 'UNRECOGNIZED_INSTALLED_ENTRY'):
                m.install_completion(self.release, apply=True)
        self.assertEqual(self.restart_count, 0)

    def test_config_change_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'DEPLOYMENT_CONFIGURATION_CHANGED'):
            m.same_public_config(self.cfg, dict(self.cfg, token='0x' + 'f' * 40))

    def test_backup_hash_tamper_rejected(self):
        m.install_completion(self.release, apply=True)
        (self.backup() / 'before.html').write_bytes(b'tampered backup')
        with self.assertRaisesRegex(RuntimeError, 'BACKUP_HTML_HASH_MISMATCH'):
            m.restore_completion(self.backup())
        self.assertEqual(self.restart_count, 1)

    def market_release(self):
        release = copy.deepcopy(self.release)
        release['app'] = m.compressed(APP + b"const market='opening quote and dated observations';")
        release['globalCSS'] = m.compressed(GLOBAL)
        return release

    def reviewed_predecessor(self):
        prior_release = copy.deepcopy(self.release)
        entry, css, assets = m.completion_destinations(APP, SDK, b'reviewed legal notice', PRO[1], PRO[2])
        folder, content = m.overlay_files(RUNTIME)
        pins = {'release': m.release_name(prior_release), 'entry': entry, 'css': css,
            'assets': {url: {'sha256': m.sha(data), 'kind': kind} for url, (data, kind) in assets.items()},
            'overlay': folder, 'runtime': {name: m.sha(data) for name, data in content.items()}}
        with patch.object(m, 'DROP_NAME', m.PREVIOUS_DROP_NAME):
            m.install_completion(prior_release, apply=True)
        reviewed = patch.object(m, 'REVIEWED_COMPLETION', pins)
        reviewed.start(); self.addCleanup(reviewed.stop)
        return Path(self.saved['WorkingDirectory']), dict(self.saved)

    def test_market_shared_css_is_immutable_and_rollback_preserves_original(self):
        release = self.market_release()
        original = (self.root / ('web' + m.BASE_GLOBAL_CSS)).read_bytes()
        m.install_completion(release, apply=True)
        stage = Path(self.saved['WorkingDirectory'])
        html = (stage / 'web/index.html').read_bytes()
        _, _, assets = m.completion_destinations(APP + b"const market='opening quote and dated observations';", SDK,
            b'reviewed legal notice', PRO[1], PRO[2], GLOBAL)
        url = next(url for url in assets if url.endswith('/global-interface.css'))
        self.assertIn(m.css_link(url), html)
        self.assertNotIn(m.css_link(m.BASE_GLOBAL_CSS), html)
        self.assertEqual((stage / ('web' + url)).read_bytes(), GLOBAL)
        self.assertEqual((self.root / ('web' + m.BASE_GLOBAL_CSS)).read_bytes(), original)
        m.install_completion(release)
        m.restore_completion(self.backup())
        self.assert_original()

    def test_unreviewed_shared_css_stops_before_staging(self):
        self.write('web' + m.BASE_GLOBAL_CSS, b'foreign shared css')
        with self.assertRaisesRegex(RuntimeError, 'UNREVIEWED_SHARED_STYLESHEET'):
            m.install_completion(self.market_release(), apply=True)
        self.assertFalse(m.BACKUPS.exists())
        self.assertEqual(self.restart_count, 0)

    def test_missing_or_ambiguous_shared_css_link_stops_before_writes(self):
        old = m.css_link(m.BASE_GLOBAL_CSS)
        for replacement in (b'', old + old):
            self.write('web/index.html', self.before_html.replace(old, replacement))
            with self.assertRaisesRegex(RuntimeError, 'UNRECOGNIZED_SHARED_STYLESHEET'):
                m.install_completion(self.market_release(), apply=True)
        self.assertEqual(self.restart_count, 0)
        self.assertFalse(m.BACKUPS.exists())

    def test_reviewed_completion_upgrade_reuses_physical_dependencies_and_rolls_back(self):
        prior, previous = self.reviewed_predecessor()
        before = m.stage_inventory(prior)
        original_backups = set(m.BACKUPS.glob('install-*'))
        release = self.market_release()
        m.install_completion(release)
        self.assertEqual(self.restart_count, 1)
        self.assertEqual(set(m.BACKUPS.glob('install-*')), original_backups)
        m.install_completion(release, apply=True)
        self.assertEqual(self.restart_count, 2)
        current = Path(self.saved['WorkingDirectory'])
        self.assertNotEqual(current, prior)
        self.assertEqual(os.readlink(current / 'node_modules'), str(self.root / 'node_modules'))
        marker = json.loads((current / '.fti-panel-completion.json').read_text())
        self.assertEqual(marker['originalRoot'], str(self.root))
        self.assertEqual(m.stage_inventory(prior), before)
        self.assertTrue((m.DROP_FOLDER / m.PREVIOUS_DROP_NAME).exists())
        m.install_completion(release, apply=True)
        self.assertEqual(self.restart_count, 2)
        new_backup = next(iter(set(m.BACKUPS.glob('install-*')) - original_backups))
        m.restore_completion(new_backup)
        self.assertEqual(self.restart_count, 3)
        for name in ('WorkingDirectory', 'ExecStart', 'DropInPaths'):
            self.assertEqual(self.saved[name], previous[name])
        self.assertFalse(m.dropin_path().exists())
        self.assertEqual(m.stage_inventory(prior), before)

    def test_modified_completion_runtime_is_not_an_upgrade_predecessor(self):
        prior, _ = self.reviewed_predecessor()
        name = m.REVIEWED_COMPLETION['overlay'] + '/market-reader.mjs'
        file = prior / name
        file.write_bytes(b'foreign runtime')
        # Even a refreshed operator inventory cannot turn unknown content into
        # the reviewed predecessor accepted by this installer.
        marker = prior / '.fti-panel-completion.json'
        value = json.loads(marker.read_text()); value['files'] = m.stage_inventory(prior)
        marker.write_text(json.dumps(value))
        with self.assertRaisesRegex(RuntimeError, 'UNREVIEWED_COMPLETION_CONTENT'):
            m.install_completion(self.market_release(), apply=True)
        self.assertEqual(self.restart_count, 1)
        self.assertFalse(m.dropin_path().exists())

    def test_modified_completion_service_override_is_preserved(self):
        self.reviewed_predecessor()
        old = m.DROP_FOLDER / m.PREVIOUS_DROP_NAME
        old.write_bytes(old.read_bytes() + b'Environment=UNREVIEWED=1\n')
        with self.assertRaisesRegex(RuntimeError, 'UNREVIEWED_COMPLETION_SERVICE'):
            m.install_completion(self.market_release(), apply=True)
        self.assertEqual(self.restart_count, 1)
        self.assertFalse(m.dropin_path().exists())

    def test_failed_market_upgrade_restores_reviewed_completion_service(self):
        prior, previous = self.reviewed_predecessor()
        old_drop = m.DROP_FOLDER / m.PREVIOUS_DROP_NAME
        old_bytes = old_drop.read_bytes()
        before = m.stage_inventory(prior)
        self.fail_new_web = True
        with self.assertRaisesRegex(RuntimeError, 'new web API'):
            m.install_completion(self.market_release(), apply=True)
        self.assertEqual(self.restart_count, 3)
        self.assertEqual(Path(self.saved['WorkingDirectory']), prior)
        self.assertEqual(self.saved['ExecStart'], previous['ExecStart'])
        self.assertEqual(self.saved['DropInPaths'], previous['DropInPaths'])
        self.assertEqual(old_drop.read_bytes(), old_bytes)
        self.assertFalse(m.dropin_path().exists())
        self.assertEqual(m.stage_inventory(prior), before)

    def test_unreviewed_completion_stage_name_is_rejected(self):
        prior, _ = self.reviewed_predecessor()
        pins = copy.deepcopy(m.REVIEWED_COMPLETION)
        pins['release'] = 'panel-completion-unreviewed'
        with patch.object(m, 'REVIEWED_COMPLETION', pins):
            with self.assertRaisesRegex(RuntimeError, 'UNREVIEWED_COMPLETION_RELEASE'):
                m.install_completion(self.market_release(), apply=True)
        self.assertEqual(self.restart_count, 1)
        self.assertEqual(Path(self.saved['WorkingDirectory']), prior)
        self.assertFalse(m.dropin_path().exists())


class OriginProbeTests(unittest.TestCase):
    def test_member_probes_are_read_only_without_wallet_or_auth(self):
        with patch.object(m, 'api_probe') as call:
            m.probe_member_apis('http://127.0.0.1:3110')
        self.assertEqual(call.call_count, 3)
        first, second, third = call.call_args_list
        self.assertEqual(first.args, ('http://127.0.0.1:3110/api/support/tickets', 401))
        self.assertEqual(first.kwargs['headers'], {'Host': 'ftiprotocol.com', 'Origin': 'https://ftiprotocol.com'})
        self.assertEqual(second.args, ('http://127.0.0.1:3110/api/member-history?wallet=invalid', 400))
        self.assertEqual(third.kwargs['method'], 'POST')
        self.assertEqual(third.kwargs['headers']['Origin'], 'https://invalid.example')
        for entry in call.call_args_list:
            self.assertNotIn('Authorization', entry.kwargs.get('headers', {}))
            self.assertNotIn('signature', repr(entry))

    def test_exec_start_ignores_only_live_status(self):
        prefix = '{ path=/opt/fti/runtime/node-v22/bin/node ; argv[]=/opt/fti/runtime/node-v22/bin/node /opt/fti/releases/old/scripts/server.mjs ; ignore_errors=no'
        first = prefix + ' ; start_time=[today] ; stop_time=[n/a] ; pid=123 ; code=(null) ; status=0/0 }'
        second = prefix + ' ; start_time=[tomorrow] ; stop_time=[later] ; pid=456 ; code=exited ; status=1/FAILURE }'
        self.assertEqual(m.normalize_exec_start(first), m.normalize_exec_start(second))
        changed = first.replace('/old/scripts/server.mjs', '/foreign/scripts/server.mjs')
        self.assertNotEqual(m.normalize_exec_start(first), m.normalize_exec_start(changed))
        with self.assertRaisesRegex(RuntimeError, 'UNSUPPORTED_EXEC_START'):
            m.normalize_exec_start(first + ' unexpected config field')

    def test_reviewed_read_timeout_is_only_allowed_config_addition(self):
        cfg = dict(m.CONFIG, stateReaderVersion=1, eventHistoryVersion=1)
        m.same_public_config(cfg, dict(cfg, eventHistoryTimeoutMs=18000,
                                      supportTicketVersion=1, memberHistoryVersion=1))
        with self.assertRaisesRegex(RuntimeError, 'UNREVIEWED_HISTORY_READ_TIMEOUT'):
            m.same_public_config(cfg, dict(cfg, eventHistoryTimeoutMs=60000))


if __name__ == '__main__':
    unittest.main()
