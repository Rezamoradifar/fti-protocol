import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

SPEC = importlib.util.spec_from_file_location('fti_glass_refresh',
    Path(__file__).resolve().parents[1] / 'tools/refresh-telegram-channel-design.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)
TOKEN = str(m.BOT_ID) + ':' + 'a' * 35
PNG = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR' + b'\x00' * 8
MP4 = b'\x00\x00\x00\x18ftypisom' + b'\x00' * 12


class FakeAPI:
    def __init__(self, receipt, plan):
        self.receipt, self.plan, self.calls, self.fail, self.corrupt = receipt, plan, [], None, None
        self.chat = {'id': m.CHANNEL_ID, 'type': 'channel', 'username': 'FTIProtocol_Official',
                     'pinned_message': {'message_id': 4}}
        self.member = {'status': 'administrator', 'user': {'id': m.BOT_ID},
                       'can_change_info': True, 'can_edit_messages': True, 'can_post_messages': True}
        self.messages = {}

    def call(self, method, params, attachment=None):
        self.calls.append((method, copy.deepcopy(params), attachment))
        if method == 'getMe':
            return {'id': m.BOT_ID, 'is_bot': True, 'username': 'FTIProtocol_OfficialBot'}
        if method == 'getChat':
            return copy.deepcopy(self.chat)
        if method == 'getChatMember':
            return self.member
        key = 'profile' if method == 'setChatPhoto' else 'message-' + str(params['message_id'])
        if method == 'pinChatMessage':
            key = 'pin-4'
        state = json.loads(self.receipt.read_text())
        assert state['steps'][key]['status'] == 'sending'
        if self.fail == method:
            raise OSError(TOKEN)
        if method == 'setChatPhoto':
            return self.corrupt if self.corrupt is not None else True
        if method == 'pinChatMessage':
            self.chat['pinned_message'] = self.messages[4]
            return True
        assert method == 'editMessageMedia'
        step = next(s for s in self.plan['steps'] if s['id'] == key)
        assert state['steps'][key]['asset_sha256'] == m.base.digest(attachment)
        assert state['steps'][key]['caption_sha256'] == m.base.digest(params['media']['caption'].encode())
        message = {'message_id': params['message_id'], 'chat': {'id': m.CHANNEL_ID},
                   'caption': step['text'], 'caption_entities': [
                       {'type': 'bold', 'offset': 0, 'length': step['heading_length']}],
                   'reply_markup': copy.deepcopy(params['reply_markup'])}
        if params['media']['type'] == 'animation':
            message['animation'] = {'file_id': 'ANIMATION_4', 'mime_type': 'video/mp4'}
        else:
            message['photo'] = [{'file_id': 'PHOTO_6_SMALL'}, {'file_id': 'PHOTO_6_LARGE'}]
        if callable(self.corrupt):
            self.corrupt(message)
        self.messages[params['message_id']] = message
        if params['message_id'] == self.chat.get('pinned_message', {}).get('message_id'):
            self.chat['pinned_message'] = message
        return message


class DesignRefreshTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'config').mkdir()
        assets = self.root / 'marketing/telegram/assets'
        assets.mkdir(parents=True)
        (self.root / 'config/telegram-launch-posts.en.json').write_bytes(
            (m.ROOT / 'config/telegram-launch-posts.en.json').read_bytes())
        (assets.parent / 'live-channel-setup.json').write_bytes(
            (m.ROOT / 'marketing/telegram/live-channel-setup.json').read_bytes())
        (assets / 'site-logo-profile.png').write_bytes(PNG)
        (assets / 'first-steps-glass.png').write_bytes(PNG + b'first-steps')
        (assets / 'welcome-glass.mp4').write_bytes(MP4)
        self.plan = m.load_plan(self.root)
        self.receipt = self.root / 'marketing/telegram/live-channel-glass-edit.json'
        self.api = FakeAPI(self.receipt, self.plan)

    def tearDown(self):
        self.temp.cleanup()

    def test_default_preview_has_no_prompt_network_or_receipt(self):
        with patch.object(m, 'ROOT', self.root), patch.object(m, 'TelegramAPI') as api, \
                patch.object(m.getpass, 'getpass') as prompt, contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(m.main([]), 0)
        preview = json.loads(output.getvalue())
        self.assertEqual(preview['status'], 'PREVIEW')
        self.assertEqual([s['id'] for s in preview['steps']], ['profile', 'message-4', 'message-6'])
        self.assertNotIn('attachment', preview['steps'][0])
        api.assert_not_called()
        prompt.assert_not_called()
        self.assertFalse(self.receipt.exists())

    def test_apply_requires_tty_and_refuses_getpass_echo_fallback(self):
        with patch.object(m, 'ROOT', self.root), patch.object(m.sys.stdin, 'isatty', return_value=False), \
                patch.object(m.getpass, 'getpass') as prompt, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(m.main(['--apply']), 1)
            prompt.assert_not_called()
        with patch.object(m, 'ROOT', self.root), patch.object(m.sys.stdin, 'isatty', return_value=True), \
                patch.object(m.getpass, 'getpass', side_effect=m.getpass.GetPassWarning('fallback')), \
                contextlib.redirect_stderr(io.StringIO()) as output:
            self.assertEqual(m.main(['--apply']), 1)
            self.assertNotIn('fallback', output.getvalue())
        self.assertFalse(self.receipt.exists())

    def test_success_edits_only_existing_messages_and_repeats_skip_success(self):
        original = (self.receipt.parent / 'live-channel-setup.json').read_bytes()
        result = m.apply(self.api, self.plan, self.receipt)
        self.assertEqual(result['status'], 'VERIFIED')
        self.assertEqual(result['pinned_message_id'], 4)
        self.assertTrue(result['profile_api_confirmed'])
        self.assertEqual(set(result['messages']), {'4', '6'})
        edits = [params for method, params, _ in self.api.calls if method == 'editMessageMedia']
        self.assertEqual([p['message_id'] for p in edits], [4, 6])
        self.assertEqual([p['media']['type'] for p in edits], ['animation', 'photo'])
        self.assertEqual(edits[0]['reply_markup'], m.BUTTONS)
        self.assertEqual([len(row) for row in m.BUTTONS['inline_keyboard']], [1, 2, 2])
        self.assertEqual(m.BUTTONS['inline_keyboard'][0][0]['style'], 'success')
        self.assertEqual(m.BUTTONS['inline_keyboard'][1][0]['style'], 'primary')
        self.assertTrue(all(not method.startswith('send') for method, _, _ in self.api.calls))
        self.assertNotIn(TOKEN, self.receipt.read_text())
        self.assertEqual(self.receipt.stat().st_mode & 0o777, 0o600)
        count = len([c for c in self.api.calls if not c[0].startswith('get')])
        m.apply(self.api, self.plan, self.receipt)
        self.assertEqual(len([c for c in self.api.calls if not c[0].startswith('get')]), count)
        self.assertEqual((self.receipt.parent / 'live-channel-setup.json').read_bytes(), original)

    def test_unknown_edit_blocks_retry_and_next_mutation(self):
        self.api.fail = 'editMessageMedia'
        with self.assertRaisesRegex(m.Error, 'OUTCOME_UNKNOWN') as caught:
            m.apply(self.api, self.plan, self.receipt)
        self.assertNotIn(TOKEN, str(caught.exception))
        state = json.loads(self.receipt.read_text())
        self.assertEqual(state['steps']['profile']['status'], 'success')
        self.assertEqual(state['steps']['message-4']['status'], 'unknown')
        self.assertNotIn('message-6', state['steps'])
        self.api.fail = None
        self.api.calls = []
        with self.assertRaisesRegex(m.Error, 'MANUAL_REVIEW'):
            m.apply(self.api, self.plan, self.receipt)
        self.assertTrue(all(c[0].startswith('get') for c in self.api.calls))

    def test_interrupted_intent_conflicts_and_exclusive_lock(self):
        with m.locked_state(self.receipt, self.plan):
            with self.assertRaisesRegex(m.Error, 'BUSY'):
                m.apply(self.api, self.plan, self.receipt)
        state = {'schema_version': 1, 'workflow': 'glass-design-v1', 'channel_id': m.CHANNEL_ID,
                 'bot_id': m.BOT_ID, 'plan_sha256': self.plan['fingerprint'],
                 'steps': {'profile': {'status': 'sending'}}}
        m.base.save_receipt(self.receipt, state)
        with self.assertRaisesRegex(m.Error, 'MANUAL_REVIEW'):
            m.apply(self.api, self.plan, self.receipt)
        self.assertEqual(json.loads(self.receipt.read_text())['steps']['profile']['status'], 'unknown')
        state['plan_sha256'] = 'changed'
        m.base.save_receipt(self.receipt, state)
        with self.assertRaisesRegex(m.Error, 'CONFLICTING'):
            m.apply(self.api, self.plan, self.receipt)

    def test_permissions_and_unconfirmed_profile_do_not_claim_success(self):
        for right in ['can_change_info', 'can_edit_messages']:
            api = FakeAPI(self.receipt, self.plan)
            api.member[right] = False
            with self.assertRaisesRegex(m.Error, 'PERMISSIONS'):
                m.apply(api, self.plan, self.receipt)
            self.assertTrue(all(c[0].startswith('get') for c in api.calls))
        self.api.corrupt = False
        with self.assertRaisesRegex(m.Error, 'OUTCOME_UNKNOWN'):
            m.apply(self.api, self.plan, self.receipt)
        profile = json.loads(self.receipt.read_text())['steps']['profile']
        self.assertEqual(profile['status'], 'unknown')
        self.assertNotIn('api_confirmed', profile)

    def test_malformed_or_incomplete_success_receipts_block_every_mutation(self):
        for bad_steps in [{'profile': {}}, {'profile': {'status': 'success',
                'fingerprint': self.plan['steps'][0]['fingerprint']}}, {'pin-4': {'status': 'bogus'}}]:
            state = {'schema_version': 1, 'workflow': 'glass-design-v1', 'channel_id': m.CHANNEL_ID,
                     'bot_id': m.BOT_ID, 'plan_sha256': self.plan['fingerprint'], 'steps': bad_steps}
            m.base.save_receipt(self.receipt, state)
            api = FakeAPI(self.receipt, self.plan)
            with self.assertRaises(m.Error):
                m.apply(api, self.plan, self.receipt)
            self.assertTrue(all(c[0].startswith('get') for c in api.calls))

    def test_edit_response_verifies_ids_captions_buttons_and_media(self):
        corruptions = [lambda msg: msg.update(message_id='4'),
                       lambda msg: msg['chat'].update(id=-999),
                       lambda msg: msg.update(caption='changed'),
                       lambda msg: msg.update(caption_entities=[]),
                       lambda msg: msg.update(reply_markup={}),
                       lambda msg: msg.update(animation={'file_id': TOKEN})]
        for corrupt in corruptions:
            with self.subTest(corrupt=corrupt):
                self.receipt.unlink(missing_ok=True)
                api = FakeAPI(self.receipt, self.plan)
                api.corrupt = corrupt
                # Profile must still return True; corrupt only a media response.
                original_call = api.call
                def call(method, params, attachment=None):
                    saved = api.corrupt
                    if method == 'setChatPhoto':
                        api.corrupt = None
                    try:
                        return original_call(method, params, attachment)
                    finally:
                        api.corrupt = saved
                with patch.object(api, 'call', side_effect=call):
                    with self.assertRaisesRegex(m.Error, 'OUTCOME_UNKNOWN'):
                        m.apply(api, self.plan, self.receipt)
                self.assertEqual(json.loads(self.receipt.read_text())['steps']['message-4']['status'], 'unknown')

    def test_missing_pin_is_silent_durable_and_final_getchat_verified(self):
        self.api.chat['pinned_message'] = {'message_id': 9}
        m.apply(self.api, self.plan, self.receipt)
        pin = [p for method, p, _ in self.api.calls if method == 'pinChatMessage']
        self.assertEqual(pin, [{'chat_id': m.CHANNEL_ID, 'message_id': 4, 'disable_notification': True}])
        self.api.chat['pinned_message']['animation']['file_id'] = 'DIFFERENT_ANIMATION'
        with self.assertRaisesRegex(m.Error, 'PINNED_MEDIA'):
            m.apply(self.api, self.plan, self.receipt)

    def test_original_receipt_is_required_to_anchor_canonical_ids_and_captions(self):
        path = self.receipt.parent / 'live-channel-setup.json'
        original = json.loads(path.read_text())
        for change in [('message_id', 999), ('caption_sha256', 'f' * 64)]:
            state = copy.deepcopy(original)
            state['posts']['fti-launch-01'][change[0]] = change[1]
            path.write_text(json.dumps(state))
            with self.assertRaisesRegex(m.Error, 'CANONICAL_RECEIPT'):
                m.load_plan(self.root)

    def test_transport_uploads_animation_photo_only_to_official_endpoint(self):
        api = m.TelegramAPI(TOKEN)
        for step, mime in zip(self.plan['steps'][1:], [b'video/mp4', b'image/png']):
            response = io.BytesIO(b'{"ok":true,"result":{"message_id":4}}')
            response.status = 200
            with patch.object(api._opener, 'open', return_value=response) as opener:
                api.call('editMessageMedia', step['params'], step['attachment'])
                request = opener.call_args.args[0]
                self.assertEqual(request.full_url, 'https://api.telegram.org/bot' + TOKEN + '/editMessageMedia')
                self.assertEqual(request.get_method(), 'POST')
                self.assertIn(b'name="asset";', request.data)
                self.assertIn(b'Content-Type: ' + mime, request.data)
                self.assertIn(b'attach://asset', request.data)
        for method in ['sendPhoto', 'sendMessage', 'sendAnimation', '../editMessageMedia']:
            with self.assertRaisesRegex(m.Error, 'METHOD_NOT_ALLOWED'):
                api.call(method, {}, b'data')
        with patch.object(api._opener, 'open', side_effect=OSError(TOKEN)):
            with self.assertRaises(m.Error) as caught:
                api.call('editMessageMedia', self.plan['steps'][1]['params'], MP4)
            self.assertNotIn(TOKEN, str(caught.exception))
        self.assertIsNone(m.base.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.invalid'))


if __name__ == '__main__':
    unittest.main()
