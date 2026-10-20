import importlib.util,unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('installer',Path(__file__).parents[1]/'tools/install-mainnet-monitor.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class InstallerTests(unittest.TestCase):
 def test_service_is_separate_and_unprivileged(self):
  u=m.units(Path('/opt/fti-monitor/test/mainnet-monitor.py'));s=u[m.NAMES[0]]
  self.assertIn('User=fti-health-check',s);self.assertIn('DynamicUser=yes',s);self.assertIn('ProtectSystem=strict',s);self.assertIn('NoNewPrivileges=yes',s)
  self.assertNotIn('KEEPER_PRIVATE_KEY',s);self.assertNotIn('systemctl restart',s);self.assertIn('OnUnitActiveSec=60',u[m.NAMES[1]])
 def test_query_preflight_uses_only_unprivileged_read(self):
  account=SimpleNamespace(pw_uid=999,pw_gid=999,pw_shell='/usr/sbin/nologin',pw_dir='/nonexistent',pw_gecos=m.MONITOR_COMMENT)
  with patch.object(m.pwd,'getpwnam',return_value=account),patch.object(m,'run',return_value='active') as run:
   m.ensure_monitor_user()
   run.assert_called_once_with('runuser','-u',m.MONITOR_USER,'--','systemctl','--system','show','fti-continuity-keeper.service','--property=ActiveState','--value')
 def test_refuses_conflicting_privileged_account(self):
  account=SimpleNamespace(pw_uid=0,pw_gid=0)
  with patch.object(m.pwd,'getpwnam',return_value=account),patch.object(m,'run') as run:
   with self.assertRaises(RuntimeError):m.ensure_monitor_user()
   run.assert_not_called()
 def test_transport_failure_stops_preflight(self):
  account=SimpleNamespace(pw_uid=999,pw_gid=999,pw_shell='/usr/sbin/nologin',pw_dir='/nonexistent',pw_gecos=m.MONITOR_COMMENT)
  with patch.object(m.pwd,'getpwnam',return_value=account),patch.object(m,'run',side_effect=RuntimeError('unavailable')):
   with self.assertRaises(RuntimeError):m.ensure_monitor_user()
if __name__=='__main__':unittest.main()
