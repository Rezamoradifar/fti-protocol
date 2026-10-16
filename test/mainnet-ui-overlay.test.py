import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('overlay', ROOT / 'tools/apply-mainnet-ui.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class OverlayTests(unittest.TestCase):
    def test_versioned_styles_fonts_and_safe_upgrade(self):
        before = (ROOT / 'web/index.html').read_bytes()
        prefix = 'fti-mainnet-ui-1234567890abcdef'
        after = m.render(before, prefix)
        for name in ('app.js', 'style.css', 'member-landing-theme.css', 'global-interface.css', 'panel-identity.css'):
            self.assertIn(('/' + prefix + '/' + name).encode(), after)
        upgraded = m.render(after, 'fti-mainnet-ui-abcdef0123456789')
        self.assertNotIn(prefix.encode(), upgraded)
        self.assertEqual(upgraded.count(b'panel-identity.css'), 1)
        with self.assertRaises(RuntimeError):
            m.render(before.replace(b'./app.js', b'/custom-app.js'), prefix)

    def test_rollback_refuses_concurrent_edit(self):
        with tempfile.TemporaryDirectory() as tmp:
            backup = Path(tmp)
            record = {'root': '/opt/fti/releases/test', 'after': m.sha(b'installed')}
            (backup / 'record.json').write_text(json.dumps(record))
            original = m.g.regular
            def regular(file):
                if file == backup / 'record.json':
                    return original(file)
                return b'operator change', None
            with patch.object(m.g, 'regular', side_effect=regular), patch.object(m.g, 'replace') as replace:
                with self.assertRaisesRegex(RuntimeError, 'concurrent'):
                    m.restore(backup)
                replace.assert_not_called()


if __name__ == '__main__':
    unittest.main()
