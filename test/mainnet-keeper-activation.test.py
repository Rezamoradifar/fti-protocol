import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('activation',Path(__file__).resolve().parents[1]/'tools/activate-mainnet-keeper.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
class Activation(unittest.TestCase):
 def test_diagnostics_do_not_echo_untrusted_errors(self):
  self.assertEqual(a.safe_failure(Exception('secret-private-key https://rpc.invalid/token')), 'UNEXPECTED_LOCAL_ERROR')
  self.assertEqual(a.safe_failure(KeyError('secret')), 'REQUIRED_CONFIGURATION_FIELD_MISSING')
  self.assertEqual(a.safe_failure(PermissionError('secret')), 'LOCAL_PERMISSION_DENIED')
 def test_rpc_override_requires_https(self):
  self.assertEqual(a.validate_rpc('https://bsc-dataseed.bnbchain.org'),'https://bsc-dataseed.bnbchain.org')
  for url in ['http://rpc.example','https://u:p@rpc.example','https://rpc.example/#secret','https://rpc.example/\n']:
   with self.assertRaises(a.h.CutoverError): a.validate_rpc(url)
 def test_deposit_boundary(self):
  self.assertFalse(a.deposit_window_open({'phase':0,'epochEnd':100,'timestamp':100}))
  self.assertFalse(a.deposit_window_open({'phase':1,'epochEnd':101,'timestamp':100}))
  self.assertTrue(a.deposit_window_open({'phase':0,'epochEnd':101,'timestamp':100}))
 def probe(self,ready,enabled):
  saved={'env':{'DEPLOYMENT_FILE':'/tmp/deployment.json','RPC_URL':'https://rpc.invalid','FTI_SOURCE_REVISION':'test','PATH':'/bin','KEEPER_PRIVATE_KEY':'test'},'properties':{'WorkingDirectory':'/opt/fti/releases/test'},'node':Path('/usr/bin/node')}
  with patch.object(a.h,'capture',return_value=saved),patch.object(a.h,'load',return_value={}),patch.object(a.w,'check_target'),patch.object(a.w,'check_web'),patch.object(Path,'resolve',lambda p:p),patch.object(a.pwd,'getpwnam') as account,patch.object(a.h,'run',return_value=json.dumps({'ready':ready})),patch.object(a.h,'write') as write:
   account.return_value.pw_uid=123;account.return_value.pw_gid=123
   if not ready:
    with self.assertRaises(a.h.CutoverError):a.activate(enabled)
   else:a.activate(enabled)
   write.assert_not_called()
 def test_zero_gas_cannot_activate(self):self.probe(False,True)
 def test_readonly_never_writes(self):self.probe(True,False)
if __name__=='__main__':unittest.main()
