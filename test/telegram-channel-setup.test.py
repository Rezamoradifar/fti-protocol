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

SPEC = importlib.util.spec_from_file_location('fti_channel_setup',
    Path(__file__).resolve().parents[1] / 'tools/configure-telegram-channel.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)
TOKEN = str(m.BOT_ID) + ':' + 'a' * 35


class FakeAPI:
    def __init__(self, receipt):
        self.receipt, self.calls, self.sent, self.fail = receipt, [], 0, None
        self.chat = {'id': m.CHANNEL_ID, 'type': 'channel', 'username': 'FTIProtocol_Official'}
        self.me = {'id': m.BOT_ID, 'is_bot': True, 'username': 'FTIProtocol_OfficialBot'}
        self.member = {'user': {'id': m.BOT_ID}, 'status': 'administrator',
                       'can_post_messages': True, 'can_edit_messages': True, 'can_change_info': True}

    def call(self, method, params, photo=None):
        self.calls.append((method, copy.deepcopy(params), photo))
        if method == 'getMe':
            return self.me
        if method == 'getChat':
            return copy.deepcopy(self.chat)
        if method == 'getChatMember':
            return self.member
        if method == 'sendPhoto':
            # The actual send sees an fsynced intent, including the exact bytes' hashes.
            state = json.loads(self.receipt.read_text())
            intents = [v for v in state['posts'].values() if v['status'] == 'sending']
            assert len(intents) == 1
            assert intents[0]['caption_sha256'] == m.digest(params['caption'].encode())
            assert intents[0]['asset_sha256'] == m.digest(photo)
            self.sent += 1
            if self.fail:
                raise self.fail
            return {'message_id': 100 + self.sent, 'chat': {'id': m.CHANNEL_ID},
                    'photo': [{'file_id': 'PHOTO_SMALL_' + str(self.sent)},
                              {'file_id': 'PHOTO_LARGE_' + str(self.sent)}]}
        if method == 'setChatTitle':
            self.chat['title'] = params['title']
        if method == 'setChatDescription':
            self.chat['description'] = params['description']
        if method == 'pinChatMessage':
            assert type(params['message_id']) is int and params['message_id'] > 0
            assert params['disable_notification'] is True
            self.chat['pinned_message'] = {'message_id': params['message_id']}
        return True


class ChannelSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.receipt = self.root / 'live-channel-setup.json'
        self.plan = m.load_plan()
        self.api = FakeAPI(self.receipt)

    def tearDown(self):
        self.temp.cleanup()

    def test_preview_is_default_without_network_prompt_or_receipt(self):
        with patch.object(m, 'ROOT', self.root), patch.object(m, 'load_plan', return_value=self.plan), \
                patch.object(m, 'TelegramAPI') as network, patch.object(m.getpass, 'getpass') as prompt, \
                contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(m.main([]), 0)
            preview = json.loads(output.getvalue())
            self.assertEqual(preview['status'], 'PREVIEW')
            self.assertEqual([p['id'] for p in preview['posts']], ['fti-launch-01', 'fti-launch-03'])
            network.assert_not_called()
            prompt.assert_not_called()
        self.assertEqual(list(self.root.iterdir()), [])

    def test_apply_refuses_non_tty_and_any_echo_fallback(self):
        with patch.object(m, 'load_plan', return_value=self.plan), \
                patch.object(m.sys.stdin, 'isatty', return_value=False), \
                patch.object(m.getpass, 'getpass') as prompt, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(m.main(['--apply']), 1)
            prompt.assert_not_called()
        with patch.object(m, 'load_plan', return_value=self.plan), \
                patch.object(m.sys.stdin, 'isatty', return_value=True), \
                patch.object(m.getpass, 'getpass', side_effect=m.getpass.GetPassWarning('fallback')), \
                contextlib.redirect_stderr(io.StringIO()) as output:
            self.assertEqual(m.main(['--apply']), 1)
            self.assertEqual(output.getvalue().strip(), 'HIDDEN_TOKEN_PROMPT_UNAVAILABLE')

    def test_success_receipts_and_second_run_never_reposts(self):
        self.assertEqual(m.apply(self.api, self.plan, self.receipt, True)['status'], 'VERIFIED')
        state = json.loads(self.receipt.read_text())
        self.assertNotIn(TOKEN, self.receipt.read_text())
        self.assertEqual(state['channel_id'], m.CHANNEL_ID)
        self.assertEqual(state['bot_id'], m.BOT_ID)
        self.assertEqual([r['status'] for r in state['posts'].values()], ['sent', 'sent'])
        self.assertTrue(all(len(r['photo_file_ids']) == 2 and r['sent_at'] and r['intent_at']
                            for r in state['posts'].values()))
        self.assertTrue(state['verified_at'])
        self.assertEqual(self.receipt.stat().st_mode & 0o777, 0o600)
        for method, params, _ in self.api.calls:
            if method == 'sendPhoto':
                self.assertTrue(params['caption'].startswith('<b>'))
                self.assertEqual(params['parse_mode'], 'HTML')
                self.assertEqual(len(m.re.findall(r'#[A-Za-z][A-Za-z0-9_]*', params['caption'])), 3)
                self.assertEqual(params['reply_markup']['inline_keyboard'], [
                    [{'text': 'Launch App', 'url': 'https://ftiprotocol.com/app/', 'style': 'success'}],
                    [{'text': 'Token Market', 'url': 'https://ftiprotocol.com/token/', 'style': 'primary'},
                     {'text': 'Whitepaper', 'url': 'https://ftiprotocol.com/whitepaper/'}],
                    [{'text': 'Website', 'url': 'https://ftiprotocol.com/'},
                     {'text': 'Official Channel', 'url': 'https://t.me/FTIProtocol_Official'}]])
        first_checks = sum(c[0] == 'getChatMember' for c in self.api.calls)
        self.assertEqual(m.apply(self.api, self.plan, self.receipt)['status'], 'VERIFIED')
        self.assertEqual(self.api.sent, 2)
        self.assertEqual(sum(c[0] == 'getChatMember' for c in self.api.calls), first_checks + 1)

    def test_timeout_stops_and_cannot_repost_or_send_next_post(self):
        self.api.fail = m.SetupError('TELEGRAM_RESPONSE_UNKNOWN')
        with self.assertRaisesRegex(m.SetupError, 'MANUAL_REVIEW'):
            m.apply(self.api, self.plan, self.receipt)
        state = json.loads(self.receipt.read_text())
        self.assertEqual(state['posts']['fti-launch-01']['status'], 'unknown')
        self.assertNotIn('fti-launch-03', state['posts'])
        self.api.fail = None
        with self.assertRaisesRegex(m.SetupError, 'MANUAL_REVIEW'):
            m.apply(self.api, self.plan, self.receipt)
        self.assertEqual(self.api.sent, 1)

    def test_interrupted_intent_is_unknown_and_blocks_all_mutations(self):
        state = {'schema_version': 1, 'channel_id': m.CHANNEL_ID, 'bot_id': m.BOT_ID,
                 'posts': {'fti-launch-01': {'status': 'sending'}}}
        m.save_receipt(self.receipt, state)
        with self.assertRaisesRegex(m.SetupError, 'MANUAL_REVIEW'):
            m.apply(self.api, self.plan, self.receipt)
        self.assertEqual(json.loads(self.receipt.read_text())['posts']['fti-launch-01']['status'], 'unknown')
        self.assertEqual([c[0] for c in self.api.calls], ['getMe', 'getChat', 'getChatMember'])

    def test_identity_permissions_and_numeric_pin_fail_closed(self):
        for group, key, value in [('chat', 'id', -999), ('me', 'id', 123),
                                  ('member', 'can_change_info', False),
                                  ('member', 'can_post_messages', False),
                                  ('member', 'can_edit_messages', False)]:
            api = FakeAPI(self.receipt)
            getattr(api, group)[key] = value
            with self.assertRaises(m.SetupError):
                m.apply(api, self.plan, self.receipt)
            self.assertTrue(all(c[0].startswith('get') for c in api.calls))
        m.apply(self.api, self.plan, self.receipt)
        state = json.loads(self.receipt.read_text())
        state['posts']['fti-launch-01']['message_id'] = '101'
        m.save_receipt(self.receipt, state)
        self.api.calls = []
        with self.assertRaisesRegex(m.SetupError, 'INVALID_MESSAGE_RECEIPT'):
            m.apply(self.api, self.plan, self.receipt)
        self.assertTrue(all(c[0].startswith('get') for c in self.api.calls))

    def test_edited_copy_or_assets_and_live_lock_require_review(self):
        with m.locked_receipt(self.receipt):
            with self.assertRaisesRegex(m.SetupError, 'BUSY'):
                m.apply(self.api, self.plan, self.receipt)
        m.apply(self.api, self.plan, self.receipt)
        for key in ['caption_sha256', 'asset_sha256']:
            edited = copy.deepcopy(self.plan)
            edited['posts'][0][key] = 'f' * 64
            with self.assertRaisesRegex(m.SetupError, 'MANUAL_REVIEW'):
                m.apply(self.api, edited, self.receipt)
        self.assertEqual(self.api.sent, 2)

    def test_strict_transport_endpoint_multipart_no_redirects_or_secret_errors(self):
        api = m.TelegramAPI(TOKEN)
        response = io.BytesIO(b'{"ok":true,"result":true}')
        response.status = 200
        with patch.object(api._opener, 'open', return_value=response) as opener:
            self.assertTrue(api.call('setChatPhoto', {'chat_id': m.CHANNEL_ID}, self.plan['profile']))
            request = opener.call_args.args[0]
            self.assertEqual(request.full_url, 'https://api.telegram.org/bot' + TOKEN + '/setChatPhoto')
            self.assertIn('multipart/form-data', request.get_header('Content-type'))
            self.assertIn(b'Content-Type: image/png', request.data)
            self.assertEqual(request.get_method(), 'POST')
        self.assertIsNone(m.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.invalid'))
        for method in ['sendMessage', '../sendPhoto', 'https://evil.invalid']:
            with self.assertRaisesRegex(m.SetupError, 'METHOD_NOT_ALLOWED'):
                api.call(method, {})
        for failure in [OSError(TOKEN), urllib.error.HTTPError('https://api.telegram.org/bot' + TOKEN,
                500, TOKEN, {}, io.BytesIO(b'{"ok":false,"description":"' + TOKEN.encode() + b'"}'))]:
            with patch.object(api._opener, 'open', side_effect=failure):
                with self.assertRaises(m.SetupError) as caught:
                    api.call('sendPhoto', {})
                self.assertNotIn(TOKEN, str(caught.exception))
        with self.assertRaisesRegex(m.SetupError, 'INVALID_BOT_TOKEN'):
            m.TelegramAPI(TOKEN + '/sendPhoto')

    def test_only_exact_metadata_not_modified_errors_are_idempotent(self):
        api = m.TelegramAPI(TOKEN)
        for method, description in [('setChatTitle', 'Bad Request: chat title is not modified'),
                                    ('setChatDescription', 'Bad Request: chat description is not modified')]:
            def rejected():
                return urllib.error.HTTPError('https://api.telegram.org/', 400, 'rejected', {},
                    io.BytesIO(json.dumps({'ok': False, 'error_code': 400, 'description': description}).encode()))
            with patch.object(api._opener, 'open', side_effect=rejected()):
                self.assertTrue(api.call(method, {}))
            with patch.object(api._opener, 'open', side_effect=rejected()):
                with self.assertRaises(m.Rejected):
                    api.call('sendPhoto', {})
        error = urllib.error.HTTPError('https://api.telegram.org/', 400, 'rejected', {},
            io.BytesIO(b'{"ok":false,"error_code":400,"description":"Bad Request: unknown"}'))
        with patch.object(api._opener, 'open', side_effect=error):
            with self.assertRaises(m.Rejected):
                api.call('setChatTitle', {})


if __name__ == '__main__':
    unittest.main()
