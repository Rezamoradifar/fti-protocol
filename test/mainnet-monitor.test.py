import importlib.util,unittest
from pathlib import Path
from unittest.mock import patch
import subprocess
spec=importlib.util.spec_from_file_location('monitor',Path(__file__).parents[1]/'tools/mainnet-monitor.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class MonitorTests(unittest.TestCase):
 def setUp(self):self.s={'timestamp':1000,'epoch':'4','epochEnd':1100,'phase':'0','monthPhase':'0','rewardQueue':'0','jobCursor':'0','jobCount':'0','cursor':'0'}
 def test_service_query_classifies_only_verified_states(self):
  for code,state,expected in [(0,'active',True),(0,'inactive',False),(0,'failed',False),(1,'inactive',None),(0,'',None),(0,'activating',None),(0,'deactivating',None)]:
   with self.subTest(code=code,state=state),patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],code,state,'Transport endpoint is not connected')):
    self.assertIs(m.keeper_status(),expected)
 def test_transport_failure_is_unknown_not_inactive(self):
  with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],1,'','Transport endpoint is not connected')):
   result,_=m.evaluate(self.s,1000,10**16,m.keeper_status(),{},1000)
  self.assertEqual(result['alerts'],['KEEPER_SERVICE_STATUS_UNKNOWN'])
  self.assertEqual(result['keeperServiceStatus'],'unknown')
  self.assertEqual(result['transactionsSent'],0)
 def test_query_timeout_and_missing_binary_are_unknown(self):
  for error in [subprocess.TimeoutExpired('systemctl',10),FileNotFoundError('systemctl')]:
   with patch.object(m.subprocess,'run',side_effect=error):self.assertIsNone(m.keeper_status())
 def test_healthy_empty_queue_is_not_stalled(self):
  result,prior=m.evaluate(self.s,1000,10**16,True,{},1000)
  result,_=m.evaluate(self.s,1000,10**16,True,prior,2000);self.assertEqual(result['alerts'],[])
 def test_low_gas_inactive_stale_and_overdue(self):
  result,_=m.evaluate(self.s,1500,0,False,{},1500)
  self.assertEqual(set(result['alerts']),{'API_STALE','KEEPER_SERVICE_INACTIVE','KEEPER_GAS_LOW','SETTLEMENT_OVERDUE'})
 def test_progress_resets_stall_timer(self):
  self.s['phase']='1';_,p=m.evaluate(self.s,1000,10**16,True,{},1000)
  result,_=m.evaluate(self.s,1000,10**16,True,p,1601);self.assertIn('SETTLEMENT_NO_PROGRESS',result['alerts'])
  self.s['cursor']='1';result,_=m.evaluate(self.s,1000,10**16,True,p,1601);self.assertNotIn('SETTLEMENT_NO_PROGRESS',result['alerts'])
if __name__=='__main__':unittest.main()
