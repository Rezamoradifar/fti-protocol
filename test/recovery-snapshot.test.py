import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('backup',Path(__file__).resolve().parents[1]/'tools/backup-users-state.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
zero='0x'+'0'*40
wallet='0x'+'1'*40

def fixture():
 return {'schema':'FTI_COMPLETE_EXPORT_V1','migrationReady':False,
  'block':{'number':100,'hash':'0x'+'a'*64},
  'users':[{'wallet':wallet,'member':{'exists':True,'parent':zero,'left':zero,'right':zero},'depth':'0',
            'pendingAuto':'5','creditL':'4','creditR':'6'}],
  'global':{'binary':{'totalAuto':'5','assignedPointCredit':'10','assignedBuilderCredit':'3','totalPending':'7'},'token':{'totalSupply':'12'}},
  'ledger':{'holders':[{'wallet':wallet,'balance':'12'}],'cashQueue':[{'wallet':wallet,'amount':'7'}],
            'months':[{'credits':[{'amounts':['3','0','0','0']}]}]},
  'accounting':{'binary':['25','25'],'token':['40','40']}}

class Tests(unittest.TestCase):
 def test_valid_snapshot(self):self.assertEqual(m.validate_snapshot(fixture())['members'],1)
 def test_no_float_or_rounded_money(self):
  for n in [1,1.2,'1.5','01','-1',True,None]:
   with self.assertRaises(RuntimeError):m.unsigned(n)
 def test_missing_members(self):
  f=fixture();f['users']=[]
  with self.assertRaises(RuntimeError):m.validate_snapshot(f)
 def test_duplicate_members(self):
  f=fixture();f['users']*=2
  with self.assertRaises(RuntimeError):m.validate_snapshot(f)
 def test_invalid_parent(self):
  f=fixture();f['users'][0]['member']['parent']='0x'+'2'*40
  with self.assertRaises(RuntimeError):m.validate_snapshot(f)
 def test_every_accounting_mismatch_stops(self):
  for target,key in [('binary','totalAuto'),('binary','totalPending'),('binary','assignedPointCredit'),('binary','assignedBuilderCredit'),('token','totalSupply')]:
   with self.subTest(key=key):
    f=fixture();f['global'][target][key]='999'
    with self.assertRaises(RuntimeError):m.validate_snapshot(f)
 def test_partial_not_success(self):
  f=fixture();f['schema']='FTI_READONLY_INVENTORY_V1'
  with self.assertRaises(RuntimeError):m.validate_snapshot(f)
 def test_archive_roundtrip_permissions_and_manifest(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);d=p/'data';d.mkdir();m.dump(d/'port-3110/snapshot.json',fixture());m.save(d/'notes.txt',b'private test')
   digest=m.make_archive(d,p/'snapshot.tar.gz')
   self.assertEqual(len(digest),64);self.assertEqual((p/'snapshot.tar.gz').stat().st_mode&0o777,0o600)
   self.assertTrue((p/'snapshot.tar.gz.sha256').is_file())
 def test_existing_files_not_overwritten(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'a';m.save(p,b'1')
   with self.assertRaises(FileExistsError):m.save(p,b'2')
 def test_symlink_source_rejected(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);m.save(p/'a',b'1');(p/'b').symlink_to(p/'a')
   with self.assertRaises(OSError):m.regular(p/'b')

if __name__=='__main__':unittest.main(verbosity=2)
