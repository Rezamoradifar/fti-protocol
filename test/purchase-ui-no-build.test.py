import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('no_build', ROOT / 'tools/install-purchase-ui-no-build.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ResumeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.source, self.live = root / 'source', root / 'live'
        self.source.mkdir()
        (self.live / 'web/fti-mainnet-ui-1234567890abcdef').mkdir(parents=True)
        (self.live / 'web/index.html').write_text('<script src="/fti-mainnet-ui-1234567890abcdef/app.js"></script>')
        (self.source / 'frontend').mkdir()
        (self.source / 'frontend/controller.js').write_bytes(b'fixed purchase')
        (self.live / 'web/fti-mainnet-ui-1234567890abcdef/font.woff2').write_bytes(b'font')
        self.files = {'frontend/controller.js': m.digest(b'fixed purchase'), 'web/font.woff2': m.digest(b'font')}

    def test_verified_assets_are_prepared_without_modifying_live_or_source(self):
        plan = m.prepare_assets(self.source, self.live, self.files)
        self.assertEqual(plan, [(self.source / 'web/font.woff2', b'font')])
        self.assertFalse((self.source / 'web').exists())
        self.assertEqual((self.live / 'web/fti-mainnet-ui-1234567890abcdef/font.woff2').read_bytes(), b'font')

    def test_missing_or_changed_asset_stops_before_returning_a_plan(self):
        self.files['web/font.woff2'] = m.digest(b'different build')
        with self.assertRaisesRegex(RuntimeError, 'differs'):
            m.prepare_assets(self.source, self.live, self.files)
        self.assertFalse((self.source / 'web').exists())

    def test_changed_purchase_source_cannot_be_replaced_from_old_live_code(self):
        (self.source / 'frontend/controller.js').write_bytes(b'old purchase')
        with self.assertRaisesRegex(RuntimeError, 'source mismatch'):
            m.prepare_assets(self.source, self.live, self.files)

    def test_symlink_and_traversal_are_rejected(self):
        (self.source / 'web').symlink_to(self.live / 'web', target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'Symlink'):
            m.prepare_assets(self.source, self.live, self.files)
        with self.assertRaisesRegex(RuntimeError, 'Unsafe asset'):
            m.child(self.source, '../live/web/index.html')

    def test_cleanup_cannot_target_live_release_or_arbitrary_directory(self):
        with patch.object(m.shutil, 'rmtree') as delete:
            for source in [self.source, Path('/opt/fti/releases/mainnet'), Path('/opt/fti/ui-collateral-fix.123')]:
                with self.assertRaises(RuntimeError):
                    m.remove_failed_dependencies(source, source)
            delete.assert_not_called()

    def test_active_unhealthy_service_is_not_blindly_restarted(self):
        opener = Mock()
        opener.open.side_effect = OSError('not reachable')
        with patch.object(m, 'service_properties', return_value={'ActiveState': 'active', 'SubState': 'running'}), \
             patch.object(m.urllib.request, 'build_opener', return_value=opener), \
             patch.object(m.subprocess, 'run') as run, patch.object(m.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, 'No UI switch performed'):
                m.ensure_web()
            run.assert_not_called()

    def test_failed_web_service_is_started_and_checked_on_expected_chain(self):
        opener = Mock()
        opener.open.return_value = io.BytesIO(b'{"ok":true,"chainId":56}')
        with patch.object(m, 'service_properties', return_value={'ActiveState': 'failed'}), \
             patch.object(m.urllib.request, 'build_opener', return_value=opener), \
             patch.object(m.subprocess, 'run') as run:
            m.ensure_web()
            self.assertEqual([call.args[0] for call in run.call_args_list], [
                ['systemctl', 'reset-failed', 'fti-continuity-web.service'],
                ['systemctl', 'start', 'fti-continuity-web.service']])


if __name__ == '__main__':
    unittest.main()
