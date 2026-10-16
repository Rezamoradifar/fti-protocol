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
    def test_changes_only_script_url_and_stale_metadata(self):
        before = b'<meta content="FTI Protocol testnet workspace."><script src="./app.js"></script><link href="./style.css">'
        after = m.render(before, 'fti-mainnet-ui-123')
        self.assertIn(b'src="/fti-mainnet-ui-123/app.js"', after)
        self.assertIn(b'./style.css', after)
        self.assertNotIn(b'testnet workspace', after)
        with self.assertRaises(RuntimeError):
            m.render(after, 'second')

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
