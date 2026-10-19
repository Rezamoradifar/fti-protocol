import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('installer',Path(__file__).parents[1]/'tools/install-mainnet-monitor.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class InstallerTests(unittest.TestCase):
 def test_service_is_separate_and_unprivileged(self):
  u=m.units(Path('/opt/fti-monitor/test/mainnet-monitor.py'));s=u[m.NAMES[0]]
  self.assertIn('DynamicUser=yes',s);self.assertIn('ProtectSystem=strict',s);self.assertIn('NoNewPrivileges=yes',s)
  self.assertNotIn('KEEPER_PRIVATE_KEY',s);self.assertNotIn('systemctl restart',s);self.assertIn('OnUnitActiveSec=60',u[m.NAMES[1]])
if __name__=='__main__':unittest.main()
