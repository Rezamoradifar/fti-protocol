import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('fti_telegram_series', ROOT / 'tools/publish-telegram-series.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)
TOKEN = str(m.BOT_ID) + ':' + 'a' * 35
PNG = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR' + b'\x00' * 8


class FakeAPI:
    def __init__(self, receipt, plan):
        self.receipt, self.plan, self.calls, self.sends, self.failure = receipt, plan, [], 0, None
        self.chat = {'id': m.CHANNEL_ID, 'type': 'channel', 'username': 'FTIProtocol_Official',
                     'pinned_message': {'message_id': 4}}
        self.member = {'status': 'administrator', 'user': {'id': m.BOT_ID}, 'can_post_messages': True}
        self.corrupt = None

    def call(self, method, params, photo=None):
        self.calls.append((method, params))
        if method == 'getMe':
            return {'id': m.BOT_ID, 'is_bot': True, 'username': 'FTIProtocol_OfficialBot'}
        if method == 'getChat':
            return self.chat
        if method == 'getChatMember':
            return self.member
        assert method == 'sendPhoto'
        post = next(p for p in self.plan['posts'] if p['params']['caption'] == params['caption'])
        receipt = json.loads(self.receipt.read_text())['posts'][post['id']]
        assert receipt['status'] == 'sending'
        assert receipt['caption_sha256'] == m.base.digest(params['caption'].encode())
        assert receipt['asset_sha256'] == m.base.digest(photo)
        assert params['disable_notification'] is True
        self.sends += 1
        if self.failure:
            raise self.failure
        entities = [{'type': 'bold', 'offset': post['bold_offset'], 'length': post['title_length']}]
        if post['custom_emoji_id']:
            entities.append({'type': 'custom_emoji', 'offset': 0, 'length': 2,
                             'custom_emoji_id': post['custom_emoji_id']})
        message = {'message_id': 100 + self.sends, 'chat': {'id': m.CHANNEL_ID},
                   'caption': post['text'], 'caption_entities': entities, 'reply_markup': m.BUTTONS,
                   'photo': [{'file_id': 'SMALL_' + str(self.sends)}, {'file_id': 'LARGE_' + str(self.sends)}]}
        if self.corrupt:
            self.corrupt(message)
        return message


class TelegramSeriesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'config').mkdir()
        assets = self.root / 'marketing/telegram/series-20261024'
        assets.mkdir(parents=True)
        self.source = {'version': 1, 'language': 'en', 'channel_id': m.CHANNEL_ID, 'bot_id': m.BOT_ID, 'posts': []}
        for number in range(1, 21):
            title = f'Platform Guidance {number}'
            self.source['posts'].append({'id': f'fti-series-{number:02}', 'title': title,
                'text': title + '\n\nRead the official application guidance.\n\n#FTIProtocol #PlatformGuide #OfficialUpdates',
                'asset': f'marketing/telegram/series-20261024/{number:02}.png', 'emoji': '🟢'})
            (assets / f'{number:02}.png').write_bytes(PNG + bytes([number]))
        self.config_path = self.root / m.CONFIG
        self.save_config()
        self.plan = m.load_plan(self.root)
        self.receipt = self.root / m.RECEIPT
        self.api = FakeAPI(self.receipt, self.plan)
        sleep = patch.object(m.time, 'sleep')
        self.sleep = sleep.start()
        self.addCleanup(sleep.stop)
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()
        self.addCleanup(self.output.__exit__, None, None, None)

    def save_config(self):
        self.config_path.write_text(json.dumps(self.source))

    def test_preview_default_has_no_network_prompt_or_receipt(self):
        with patch.object(m, 'ROOT', self.root), patch.object(m.base, 'TelegramAPI') as api, \
                patch.object(m.getpass, 'getpass') as prompt, contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(m.main([]), 0)
            result = json.loads(output.getvalue())
        self.assertEqual(result['status'], 'PREVIEW')
        self.assertEqual(len(result['posts']), 20)
        self.assertNotIn('photo', result['posts'][0])
        api.assert_not_called()
        prompt.assert_not_called()
        self.assertFalse(self.receipt.exists())

    def test_twenty_confirmed_silent_posts_paced_and_rerun_cannot_duplicate(self):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            result = m.publish(self.api, self.plan, self.receipt)
        lines = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(len(lines), 20)
        self.assertEqual(lines[-1]['confirmed_count'], 20)
        self.assertEqual(result['confirmed_count'], 20)
        self.assertEqual(result['pinned_message_id'], 4)
        self.assertEqual(self.api.sends, 20)
        self.assertEqual(len(self.sleep.call_args_list), 19)
        self.assertTrue(all(call.args == (4,) for call in self.sleep.call_args_list))
        self.assertTrue(all(method in {'getMe', 'getChat', 'getChatMember', 'sendPhoto'} for method, _ in self.api.calls))
        state = json.loads(self.receipt.read_text())
        self.assertTrue(all(p['status'] == 'sent' and p['caption_verified'] and p['buttons_verified']
                            and len(p['photo_file_ids']) == 2 for p in state['posts'].values()))
        self.assertNotIn(TOKEN, self.receipt.read_text())
        self.assertEqual(self.receipt.stat().st_mode & 0o777, 0o600)
        m.publish(self.api, self.plan, self.receipt)
        self.assertEqual(self.api.sends, 20)

    def test_unknown_rejected_and_interrupted_intent_hold_entire_batch(self):
        for failure, status in [(OSError(TOKEN), 'unknown'), (m.base.Rejected('TELEGRAM_REQUEST_REJECTED'), 'rejected')]:
            self.receipt.unlink(missing_ok=True)
            api = FakeAPI(self.receipt, self.plan)
            api.failure = failure
            with self.assertRaises(m.Error) as caught:
                m.publish(api, self.plan, self.receipt)
            self.assertNotIn(TOKEN, str(caught.exception))
            state = json.loads(self.receipt.read_text())
            first = self.plan['posts'][0]['id']
            self.assertEqual(state['posts'][first]['status'], status)
            self.assertEqual(len(state['posts']), 1)
            api.failure = None
            api.calls = []
            with self.assertRaisesRegex(m.Error, 'MANUAL_REVIEW'):
                m.publish(api, self.plan, self.receipt)
            self.assertTrue(all(method.startswith('get') for method, _ in api.calls))
        state['posts'][first]['status'] = 'sending'
        m.base.save_receipt(self.receipt, state)
        with self.assertRaises(m.Error):
            m.publish(self.api, self.plan, self.receipt)
        self.assertEqual(json.loads(self.receipt.read_text())['posts'][first]['status'], 'unknown')

    def test_identity_post_permission_pin_and_non_tty_fail_before_sending(self):
        self.api.member['can_post_messages'] = False
        with self.assertRaisesRegex(m.Error, 'PERMISSION'):
            m.publish(self.api, self.plan, self.receipt)
        self.api.member['can_post_messages'] = True
        self.api.chat['pinned_message']['message_id'] = '4'
        with self.assertRaisesRegex(m.Error, 'INVALID_CHANNEL_PIN'):
            m.publish(self.api, self.plan, self.receipt)
        self.assertEqual(self.api.sends, 0)
        with patch.object(m, 'ROOT', self.root), patch.object(m.sys.stdin, 'isatty', return_value=False), \
                patch.object(m.getpass, 'getpass') as prompt, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(m.main(['--apply']), 1)
            prompt.assert_not_called()

    def test_existing_pin_or_no_pin_is_preserved_and_bound_to_receipt(self):
        for pin in [42, None]:
            self.receipt.unlink(missing_ok=True)
            api = FakeAPI(self.receipt, self.plan)
            if pin is None:
                del api.chat['pinned_message']
            else:
                api.chat['pinned_message'] = {'message_id': pin}
            result = m.publish(api, self.plan, self.receipt)
            self.assertEqual(result['pinned_message_id'], pin)
            self.assertEqual(json.loads(self.receipt.read_text())['pinned_message_id_baseline'], pin)
            self.assertTrue(all(method != 'pinChatMessage' for method, _ in api.calls))
            api.chat['pinned_message'] = {'message_id': 99}
            before = api.sends
            with self.assertRaisesRegex(m.Error, 'PIN_CHANGED_SINCE_SERIES_START'):
                m.publish(api, self.plan, self.receipt)
            self.assertEqual(api.sends, before)

    def test_duplicate_text_images_unknown_path_hashtags_and_oversize_rejected(self):
        original = copy.deepcopy(self.source)
        changes = [lambda p: p.update(text=p['text'].replace('#FTIProtocol', '#Unknown')),
                   lambda p: p.update(text=p['text'] + ' ' + 'a' * 1100),
                   lambda p: p.update(asset='../private.png'),
                   lambda p: p.update(text=p['text'].replace('Read the official', 'راهنما'))]
        for change in changes:
            self.source = copy.deepcopy(original)
            change(self.source['posts'][0])
            self.save_config()
            with self.assertRaises(m.Error):
                m.load_plan(self.root)
        self.source = copy.deepcopy(original)
        self.source['posts'][1].update(text=self.source['posts'][0]['text'], title=self.source['posts'][0]['title'])
        self.save_config()
        with self.assertRaises(m.Error):
            m.load_plan(self.root)
        self.source = original
        self.save_config()
        (self.root / self.source['posts'][1]['asset']).write_bytes((self.root / self.source['posts'][0]['asset']).read_bytes())
        with self.assertRaises(m.Error):
            m.load_plan(self.root)

    def test_custom_emoji_and_bold_entity_are_verified(self):
        self.source['brand_custom_emoji_id'] = '5368324170671202286'
        self.save_config()
        plan = m.load_plan(self.root)
        self.assertTrue(plan['posts'][0]['params']['caption'].startswith('<tg-emoji emoji-id="5368324170671202286">🟢</tg-emoji> <b>'))
        api = FakeAPI(self.receipt, plan)
        m.publish(api, plan, self.receipt)
        self.assertTrue(all(p['custom_emoji_verified'] for p in json.loads(self.receipt.read_text())['posts'].values()))
        self.receipt.unlink()
        api = FakeAPI(self.receipt, plan)
        api.corrupt = lambda msg: msg.update(caption_entities=[msg['caption_entities'][0]])
        with self.assertRaisesRegex(m.Error, 'DELIVERY_UNKNOWN'):
            m.publish(api, plan, self.receipt)
        self.assertEqual(api.sends, 1)

    def test_invalid_response_and_changed_receipt_never_resend(self):
        self.api.corrupt = lambda msg: msg.update(message_id=True)
        with self.assertRaisesRegex(m.Error, 'DELIVERY_UNKNOWN'):
            m.publish(self.api, self.plan, self.receipt)
        state = json.loads(self.receipt.read_text())
        state['posts'][self.plan['posts'][0]['id']] = {}
        m.base.save_receipt(self.receipt, state)
        with self.assertRaisesRegex(m.Error, 'MANUAL_REVIEW'):
            m.publish(self.api, self.plan, self.receipt)
        self.assertEqual(self.api.sends, 1)
        state['plan_sha256'] = 'f' * 64
        m.base.save_receipt(self.receipt, state)
        with self.assertRaisesRegex(m.Error, 'CONFLICTING'):
            m.publish(self.api, self.plan, self.receipt)

    def test_lock_excludes_a_second_publisher(self):
        with m.locked_state(self.receipt, self.plan):
            with self.assertRaisesRegex(m.Error, 'BUSY'):
                m.publish(self.api, self.plan, self.receipt)
        self.assertEqual(self.api.calls, [])


if __name__ == '__main__':
    unittest.main()
