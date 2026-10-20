import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('recovery_rpc', ROOT / 'tools/fti-verify-recovery-rpc.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
HASH = '0x' + 'a' * 64


class RecoveryRpcTests(unittest.TestCase):
    def test_pins_exact_actual_mainnet_identity_and_runtime_hashes(self):
        cfg = json.loads((ROOT / 'deployments/mainnet-20261016.json').read_text())
        self.assertTrue(all(cfg.get(k) == v for k, v in m.IDENTITY.items()))

    def test_saved_environment_canonical_parser_preserves_private_literal_characters(self):
        original = {'RPC_URL': 'https://rpc.test/private$token?x="a"&b=\\literal', 'PORT': '3110'}
        self.assertEqual(m.parse_saved_env(m.env_text(original)), original)
        for bad in ['RPC_URL="a"\nRPC_URL="b"\n', 'RPC_URL=https://rpc.test\n', 'RPC_URL="x" #comment\n']:
            with self.assertRaises((RuntimeError, ValueError)):
                m.parse_saved_env(bad)

    def test_rpc_source_rejects_credentials_ambiguity_and_symlinks(self):
        for env in [{'RPC_URL': 'http://rpc.test'}, {'RPC_URL': 'https://user:password@rpc.test'},
                    {'RPC_URL': 'https://rpc.test/#private'}, {'FTI_MAINNET_RPC_URL': 'https://a.test', 'FTI_MAINNET_RPC_FILE': '/private.rpc'}]:
            with self.assertRaises(RuntimeError):
                m.rpc_url(env)
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'secret';file.write_text('https://rpc.test/private');file.chmod(0o600)
            alias = Path(directory) / 'alias';alias.symlink_to(file)
            with self.assertRaises(RuntimeError):m.rpc_url({'FTI_MAINNET_RPC_FILE': str(alias)})
            self.assertEqual(m.rpc_url({'FTI_MAINNET_RPC_FILE': str(file)}), 'https://rpc.test/private')

    def test_concurrent_deployment_after_probe_blocks_public_hint_write(self):
        snapshot = {'MainPID': '123', 'WorkingDirectory': '/opt/fti/releases/mainnet-web-example'}
        captured = (Path('/opt/fti/runtime/node-v22.test/bin/node'),
                    Path('/opt/fti/releases/mainnet-web-example'), {},
                    [{'label': 'current', 'url': 'https://rpc.test/private-secret'}], snapshot)
        report = {'endpoint': 'current', 'status': 'IDENTITY_VERIFIED',
                  'transactions': [{'nonce': 2, 'status': 'CANONICAL_CONFIRMED', 'hash': HASH}]}
        result = Mock(returncode=0, stdout='FTI_RECOVERY_REPORT=' + json.dumps(report))
        with patch.object(m.os, 'geteuid', return_value=0), patch.object(m, 'capture', return_value=captured), \
             patch.object(m.subprocess, 'run', return_value=result), \
             patch.object(m, 'properties', return_value=dict(snapshot, MainPID='456')), \
             patch.object(m, 'publish_hints') as publish, patch('sys.stdout', new_callable=io.StringIO):
            with self.assertRaisesRegex(RuntimeError, 'service changed'):
                m.main(['--publish'])
            publish.assert_not_called()

    def test_url_contains_only_canonical_proofs_and_never_the_private_rpc(self):
        report = {'status': 'IDENTITY_VERIFIED', 'endpoint': 'original', 'private': 'secret',
                  'transactions': [{'status': 'CANONICAL_CONFIRMED', 'hash': HASH}, {'status': 'NOT_RECOVERED', 'hash': '0x' + 'b' * 64}]}
        self.assertEqual(m.recovery_url([report]), 'https://ftiprotocol.com/token/?lang=fa&recover=' + HASH + '#trade')
        report['status'] = 'CODE_MISMATCH';self.assertIsNone(m.recovery_url([report]))
        report['status'] = 'IDENTITY_VERIFIED';report['transactions'][0]['hash'] = '0x123';self.assertIsNone(m.recovery_url([report]))

    def run_probe(self, mode='valid'):
        data = {'identity': m.IDENTITY, 'wallet': m.DEFAULT_WALLET, 'nonces': [2],
                'candidates': [{'label': 'original', 'url': 'https://rpc.test/private-secret'}]}
        stub = r'''
const mode=MODE;
class FetchRequest{constructor(url){this.url=url;}}
const id=JSON.parse(process.env.FTI_RECOVERY_DIAGNOSTIC).identity;
const codes=new Map([...Object.entries(id.codeHashes).map(([k,v])=>[id[k].toLowerCase(),v]),...Object.entries(id.implementationCodeHashes).map(([k,v])=>[id[k+'Implementation'].toLowerCase(),v])]);
const keccak256=code=>code;
const blockHash='0x'+'c'.repeat(64);
const txHash='0x'+'a'.repeat(64),wallet='0xd6492377c2c33047afe61768930b2aedff2b2704';
class JsonRpcProvider{
 async getNetwork(){return {chainId:mode==='chain'?97n:56n};}
 async getCode(address){return mode==='code'?'0xwrong':codes.get(address.toLowerCase());}
 async getStorage(address){const key=address.toLowerCase()===id.binary.toLowerCase()?'binaryImplementation':'tokenImplementation';return '0x'+'0'.repeat(24)+id[key].slice(2);}
 async getBlockNumber(){return 100000;}
 async getTransactionCount(address,block){if(mode==='history'&&typeof block==='number'&&block<99988)throw Error('missing trie node');return typeof block==='string'?3:block<99900?2:3;}
 async getBlock(number,full){return {number:(mode==='block-number'&&full)||(mode==='canonical-number'&&!full)?number+1:number,hash:mode==='block-hash'&&full?'invalid':mode==='reorg'&&!full?'0x'+'d'.repeat(64):blockHash,prefetchedTransactions:[{hash:txHash,from:mode==='sender'?id.binary:wallet,nonce:2,to:id.usd,data:'0x095ea7b3',value:0n,chainId:mode==='tx-chain'?97n:56n,blockNumber:mode==='tx-block-number'?99901:99900,blockHash:mode==='tx-block-hash'?'0x'+'d'.repeat(64):blockHash}]};}
 async getTransactionReceipt(){return {hash:mode==='receipt'?'0x'+'b'.repeat(64):txHash,blockHash:mode==='receipt-block-hash'?'invalid':blockHash,blockNumber:99900,status:1};}
 destroy(){}
}
'''.replace('MODE', json.dumps(mode))
        code = stub + '\n' + m.PROBE.replace("import {FetchRequest,JsonRpcProvider,keccak256} from 'ethers';", '')
        env = dict(os.environ, FTI_RECOVERY_DIAGNOSTIC=json.dumps(data))
        result = subprocess.run(['node', '--input-type=module'], input=code, text=True, capture_output=True, env=env, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('private-secret', result.stdout)
        return json.loads(result.stdout.split('FTI_RECOVERY_REPORT=', 1)[1])

    def test_probe_recovers_only_canonical_sender_nonce_receipt(self):
        row = self.run_probe()
        self.assertEqual(row['status'], 'IDENTITY_VERIFIED')
        self.assertEqual(row['latestNonce'], 3)
        self.assertEqual(row['transactions'][0]['status'], 'CANONICAL_CONFIRMED')
        self.assertEqual(row['transactions'][0]['hash'], HASH)
        self.assertEqual(row['transactions'][0]['kind'], 'USDT_APPROVAL')
        self.assertLessEqual(row['reads'], 160)

    def test_wrong_chain_or_runtime_code_produces_no_recovery_url(self):
        for mode, status in [('chain', 'WRONG_CHAIN'), ('code', 'CODE_MISMATCH')]:
            row = self.run_probe(mode);self.assertEqual(row['status'], status);self.assertIsNone(m.recovery_url([row]))

    def test_wrong_sender_receipt_reorg_or_pruned_state_never_produce_a_hash(self):
        for mode in ['sender', 'receipt', 'reorg', 'history', 'block-number', 'canonical-number',
                     'block-hash', 'tx-chain', 'tx-block-number', 'tx-block-hash', 'receipt-block-hash']:
            row = self.run_probe(mode)
            self.assertNotEqual(row['transactions'][0]['status'], 'CANONICAL_CONFIRMED')
            self.assertIsNone(m.recovery_url([row]))


class PublicHintTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.web = self.base / 'web';self.web.mkdir(mode=0o755)
        self.lock = self.base / 'hint.lock'
        self.wallet = m.DEFAULT_WALLET
        self.target = self.web / 'recovery' / '56' / (self.wallet + '.json')

    def publish(self, hashes):
        return m.write_public_hints(self.web, self.wallet, hashes, self.lock)

    def test_atomic_root_owned_public_manifest_contains_no_endpoint(self):
        self.assertEqual(self.publish([HASH]), self.target)
        data = json.loads(self.target.read_bytes())
        self.assertEqual(data, {'schema': 'FTI_RECOVERY_HINTS_V1', 'chainId': 56,
                               'address': self.wallet, 'hashes': [HASH]})
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o644)
        self.assertEqual(self.target.stat().st_uid, 0)
        self.assertEqual(list(self.target.parent.glob('*.tmp')), [])

    def test_valid_prior_hints_are_merged_and_bounded_to_sixteen(self):
        old = ['0x' + format(i, '064x') for i in range(16)]
        self.publish(old);self.publish([HASH])
        hashes = json.loads(self.target.read_bytes())['hashes']
        self.assertEqual(hashes, [HASH, *old[:15]])
        self.assertEqual(len(hashes), 16)

    def test_invalid_existing_manifest_is_never_overwritten(self):
        self.publish([HASH]);self.target.write_bytes(b'{"operator":"preserve"}')
        before = self.target.read_bytes()
        with self.assertRaises(RuntimeError):self.publish([HASH])
        self.assertEqual(self.target.read_bytes(), before)

    def test_symlink_targets_and_writable_directories_are_rejected(self):
        self.publish([HASH]);self.target.unlink()
        other = self.base / 'other';other.write_bytes(b'preserve')
        self.target.symlink_to(other)
        with self.assertRaises(RuntimeError):self.publish([HASH])
        self.assertEqual(other.read_bytes(), b'preserve')
        self.target.unlink();self.target.parent.chmod(0o777)
        with self.assertRaises(RuntimeError):self.publish([HASH])
        self.assertFalse(self.target.exists())

    def test_invalid_or_missing_verified_hashes_do_not_create_a_manifest(self):
        for hashes in [[], ['0x123'], [HASH] * 17]:
            with self.assertRaises(RuntimeError):self.publish(hashes)
        self.assertFalse((self.web / 'recovery').exists())

    def test_published_status_requires_exact_local_and_public_response_bytes(self):
        self.publish([HASH]);expected = self.target.read_bytes()
        def response(data):
            stream = io.BytesIO(data);stream.status = 200;return stream
        opener = Mock();opener.open.side_effect = [response(expected), response(expected)]
        with patch.object(m.urllib.request, 'build_opener', return_value=opener):
            self.assertTrue(m.verify_published_hints(self.target, self.wallet))
        urls = [call.args[0] for call in opener.open.call_args_list]
        self.assertTrue(urls[0].startswith('http://127.0.0.1:3110/recovery/56/' + self.wallet + '.json?'))
        self.assertTrue(urls[1].startswith('https://ftiprotocol.com/token/recovery/56/' + self.wallet + '.json?'))
        for replies in [[response(expected), response(b'landing page')], [response(expected), OSError('unavailable')]]:
            opener = Mock();opener.open.side_effect = replies
            with patch.object(m.urllib.request, 'build_opener', return_value=opener):
                self.assertFalse(m.verify_published_hints(self.target, self.wallet))
            self.assertEqual(self.target.read_bytes(), expected)

    def test_concurrent_operator_change_is_preserved_and_temp_removed(self):
        self.publish([HASH]);original = m.tempfile.mkstemp
        changed = b'{"operator":"changed while preparing"}'
        def concurrent(*args, **kwargs):
            result = original(*args, **kwargs)
            self.target.write_bytes(changed)
            return result
        with patch.object(m.tempfile, 'mkstemp', side_effect=concurrent):
            with self.assertRaisesRegex(RuntimeError, 'changed concurrently'):
                self.publish(['0x' + 'b' * 64])
        self.assertEqual(self.target.read_bytes(), changed)
        self.assertEqual(list(self.target.parent.glob('*.tmp')), [])


if __name__ == '__main__':
    unittest.main()
