import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('fti_telegram', Path(__file__).resolve().parents[1] / 'tools/telegram-publisher.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)
TOKEN = '123456:' + 'a' * 35
CONFIG = {'bot_token': TOKEN, 'channel_id': -1001234567890,
          'expected_bot_id': 123456, 'expected_channel_id': -1001234567890}
NOW = dt.datetime(2026, 10, 24, 19, 15, tzinfo=m.TEHRAN)


class FakeAPI:
    def __init__(self, send=None, chat=None, member=None, me=None):
        self.calls = []
        self.send = send
        self.chat = chat or {'id': CONFIG['channel_id'], 'type': 'channel', 'username': 'FTIProtocol'}
        self.member = member or {'status': 'administrator', 'can_post_messages': True, 'user': {'id': 123456}}
        self.me = me or {'id': 123456, 'is_bot': True, 'username': 'FTIPublisherBot'}

    def call(self, method, params):
        self.calls.append((method, params))
        if method == 'getMe':
            return self.me
        if method == 'getChat':
            return self.chat
        if method == 'getChatMember':
            return self.member
        if isinstance(self.send, BaseException):
            raise self.send
        return self.send or {'message_id': 77, 'chat': {'id': CONFIG['channel_id']}}


class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.config = self.root / 'config.json'
        self.config.write_text(json.dumps(CONFIG))
        self.config.chmod(0o600)
        self.queue = self.root / 'queue.json'
        self.raw = {'version': 1, 'timezone': 'Asia/Tehran', 'posts': [
            {'id': 'fti-001', 'scheduled_at': '2026-10-24T19:00:00+03:30', 'text': 'آشنایی با FTI'}]}
        self.queue.write_text(json.dumps(self.raw))
        self.posts = m.load_queue(self.queue)
        self.db, self.lock = m.open_state(self.root / 'state.sqlite3')
        self.api = FakeAPI()

    def tearDown(self):
        self.db.close()
        self.lock.close()
        self.temp.cleanup()

    def arm(self):
        self.assertEqual(m.publish(CONFIG, self.posts, self.db, self.api, NOW)['status'], 'ARMED_NO_SEND')
        self.assertEqual(self.api.calls, [])

    def test_config_private_and_numeric(self):
        self.assertEqual(m.load_config(self.config), CONFIG)
        self.config.chmod(0o644)
        with self.assertRaisesRegex(m.PublisherError, 'PRIVATE_CONFIG_REQUIRED'):
            m.load_config(self.config)

    def test_config_symlink_rejected(self):
        link = self.root / 'link'
        link.symlink_to(self.config)
        with self.assertRaises(m.PublisherError):
            m.load_config(link)

    def test_token_bot_mismatch_and_endpoint_injection(self):
        bad = dict(CONFIG, expected_bot_id=555555)
        self.config.write_text(json.dumps(bad))
        with self.assertRaises(m.PublisherError):
            m.load_config(self.config)
        with self.assertRaises(m.PublisherError):
            m.TelegramAPI(TOKEN + '/sendMessage?secret=')

    def test_identity_and_permission_fail_closed(self):
        for api in [FakeAPI(chat={'id': -999, 'type': 'channel'}),
                    FakeAPI(me={'id': 999, 'is_bot': True}),
                    FakeAPI(member={'user': {'id': 123456}, 'status': 'member'}),
                    FakeAPI(member={'user': {'id': 123456}, 'status': 'administrator', 'can_post_messages': False})]:
            with self.assertRaises(m.PublisherError):
                m.validate_identity(CONFIG, api)
            self.assertNotIn('sendMessage', [c[0] for c in api.calls])

    def test_queue_requires_timezone_and_one_post_per_day(self):
        for change in [dict(self.raw['posts'][0], scheduled_at='2026-10-24T19:00:00'),
                       dict(self.raw['posts'][0], text='🙂' * 2049)]:
            self.raw['posts'] = [change]
            self.queue.write_text(json.dumps(self.raw))
            with self.assertRaises(m.PublisherError):
                m.load_queue(self.queue)

    def test_duplicate_day_rejected(self):
        self.raw['posts'].append(dict(self.raw['posts'][0], id='fti-002'))
        self.queue.write_text(json.dumps(self.raw))
        with self.assertRaises(m.PublisherError):
            m.load_queue(self.queue)

    def test_success_and_repeat_no_duplicate(self):
        self.arm()
        self.assertEqual(m.publish(CONFIG, self.posts, self.db, self.api, NOW)['status'], 'POST_SENT')
        self.assertEqual(m.publish(CONFIG, self.posts, self.db, self.api, NOW)['status'], 'NO_POST_DUE')
        sent = [p for method, p in self.api.calls if method == 'sendMessage']
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]['chat_id'], CONFIG['expected_channel_id'])
        self.assertEqual(sent[0]['parse_mode'], 'HTML')
        self.assertTrue(sent[0]['text'].startswith('<b>'))

    def test_editorial_format_escapes_copy_and_uses_official_buttons(self):
        data = m.message_payload(CONFIG['expected_channel_id'], 'FTI <Guide>\n\nReserve & supply')
        self.assertEqual(data['text'], '<b>FTI &lt;Guide&gt;</b>\n\nReserve &amp; supply')
        self.assertEqual(data['reply_markup']['inline_keyboard'], [
            [{'text': 'Launch App', 'url': 'https://ftiprotocol.com/app/', 'style': 'success'}],
            [{'text': 'Token Market', 'url': 'https://ftiprotocol.com/token/', 'style': 'primary'},
             {'text': 'Whitepaper', 'url': 'https://ftiprotocol.com/whitepaper/'}],
            [{'text': 'Website', 'url': 'https://ftiprotocol.com/'},
             {'text': 'Official Channel', 'url': 'https://t.me/FTIProtocol_Official'}]])

    def test_future_and_expired_not_sent(self):
        self.arm()
        early = NOW - dt.timedelta(hours=1)
        self.assertEqual(m.publish(CONFIG, self.posts, self.db, self.api, early)['status'], 'NO_POST_DUE')
        late = NOW + dt.timedelta(hours=3)
        self.assertEqual(m.publish(CONFIG, self.posts, self.db, self.api, late)['status'], 'NO_POST_DUE')
        self.assertEqual(self.db.execute('SELECT state FROM posts').fetchone()[0], 'review_expired')
        self.assertEqual(self.api.calls, [])

    def test_timeout_is_not_retried(self):
        self.arm()
        self.api.send = m.DeliveryUnknown('TELEGRAM_RESPONSE_UNKNOWN')
        self.assertEqual(m.publish(CONFIG, self.posts, self.db, self.api, NOW)['status'], 'REVIEW_DELIVERY_UNKNOWN')
        m.publish(CONFIG, self.posts, self.db, self.api, NOW)
        self.assertEqual(sum(c[0] == 'sendMessage' for c in self.api.calls), 1)

    def test_crash_intent_not_retried(self):
        self.arm()
        self.db.execute("UPDATE posts SET state='sending'")
        self.db.commit()
        self.assertEqual(m.publish(CONFIG, self.posts, self.db, self.api, NOW)['status'], 'NO_POST_DUE')
        self.assertEqual(self.db.execute('SELECT state FROM posts').fetchone()[0], 'review_unknown')
        self.assertEqual(self.api.calls, [])

    def test_429_backoff_only_after_explicit_rejection(self):
        self.arm()
        self.api.send = m.APIRejected(429, 120)
        self.assertEqual(m.publish(CONFIG, self.posts, self.db, self.api, NOW)['status'], 'RATE_LIMITED_NOT_SENT')
        self.api.send = None
        self.assertEqual(m.publish(CONFIG, self.posts, self.db, self.api, NOW)['status'], 'NO_POST_DUE')
        self.assertEqual(m.publish(CONFIG, self.posts, self.db, self.api, NOW + dt.timedelta(seconds=121))['status'], 'POST_SENT')

    def test_permanent_rejection_no_retries(self):
        self.arm()
        self.api.send = m.APIRejected(403)
        self.assertEqual(m.publish(CONFIG, self.posts, self.db, self.api, NOW)['status'], 'REJECTED_NOT_SENT')
        m.publish(CONFIG, self.posts, self.db, self.api, NOW)
        self.assertEqual(sum(c[0] == 'sendMessage' for c in self.api.calls), 1)

    def test_queue_edit_does_not_republish(self):
        self.arm()
        self.posts[0]['digest'] = 'different'
        with self.assertRaisesRegex(m.PublisherError, 'REQUIRES_REVIEW'):
            m.publish(CONFIG, self.posts, self.db, self.api, NOW)

    def test_replacing_post_id_cannot_bypass_daily_limit(self):
        self.arm()
        m.publish(CONFIG, self.posts, self.db, self.api, NOW)
        replacement = dict(self.posts[0], id='fti-new-id', digest='new-id-digest')
        self.assertEqual(m.publish(CONFIG, [replacement], self.db, self.api, NOW)['status'], 'DAILY_LIMIT')
        self.assertEqual(sum(c[0] == 'sendMessage' for c in self.api.calls), 1)

    def test_cross_midnight_send_caps_actual_send_date(self):
        self.raw['posts'] = [
            {'id': 'late-evening', 'scheduled_at': '2026-10-24T23:59:00+03:30', 'text': 'first'},
            {'id': 'next-day', 'scheduled_at': '2026-10-25T19:00:00+03:30', 'text': 'second'}]
        self.queue.write_text(json.dumps(self.raw))
        posts = m.load_queue(self.queue)
        morning = dt.datetime(2026, 10, 25, 0, 30, tzinfo=m.TEHRAN)
        evening = morning.replace(hour=19, minute=1)
        self.assertEqual(m.publish(CONFIG, posts, self.db, self.api, morning)['status'], 'ARMED_NO_SEND')
        self.assertEqual(m.publish(CONFIG, posts, self.db, self.api, morning)['status'], 'POST_SENT')
        self.assertEqual(m.publish(CONFIG, posts, self.db, self.api, evening)['status'], 'DAILY_LIMIT')
        self.assertEqual(sum(c[0] == 'sendMessage' for c in self.api.calls), 1)

    def test_ledger_is_bound_to_bot_and_channel(self):
        self.arm()
        for config in [dict(CONFIG, expected_bot_id=999), dict(CONFIG, expected_channel_id=-999, channel_id=-999)]:
            with self.assertRaisesRegex(m.PublisherError, 'LEDGER_IDENTITY_MISMATCH'):
                m.publish(config, self.posts, self.db, self.api, NOW)
        self.assertEqual(self.api.calls, [])

    def test_unbound_armed_legacy_ledger_requires_review(self):
        self.db.execute("INSERT INTO metadata VALUES('armed','0')")
        self.db.commit()
        with self.assertRaisesRegex(m.PublisherError, 'UNBOUND_LEDGER_REQUIRES_REVIEW'):
            m.publish(CONFIG, self.posts, self.db, self.api, NOW)

    def test_invalid_success_response_never_retried(self):
        self.arm()
        self.api.send = {'message_id': 22, 'chat': {'id': -999}}
        self.assertEqual(m.publish(CONFIG, self.posts, self.db, self.api, NOW)['status'], 'REVIEW_DELIVERY_UNKNOWN')
        m.publish(CONFIG, self.posts, self.db, self.api, NOW)
        self.assertEqual(sum(c[0] == 'sendMessage' for c in self.api.calls), 1)

    def test_http_500_not_treated_as_safe_retry_even_with_json(self):
        import io
        import urllib.error
        api = m.TelegramAPI(TOKEN)
        response = urllib.error.HTTPError('https://api.telegram.org/bot' + TOKEN, 500, 'secret:' + TOKEN, {},
                                          io.BytesIO(b'{"ok":false,"error_code":500}'))
        with patch.object(api._opener, 'open', side_effect=response):
            with self.assertRaises(m.DeliveryUnknown) as caught:
                api.call('sendMessage', {})
            self.assertNotIn(TOKEN, str(caught.exception))

    def test_http_429_requires_well_formed_explicit_rejection(self):
        import io
        import urllib.error
        api = m.TelegramAPI(TOKEN)
        good = urllib.error.HTTPError('https://api.telegram.org/', 429, 'rate limit', {},
                                      io.BytesIO(b'{"ok":false,"error_code":429,"parameters":{"retry_after":123}}'))
        with patch.object(api._opener, 'open', side_effect=good):
            with self.assertRaises(m.APIRejected) as caught:
                api.call('sendMessage', {})
            self.assertEqual((caught.exception.code, caught.exception.retry_after), (429, 123))
        bad = urllib.error.HTTPError('https://api.telegram.org/', 429, TOKEN, {}, io.BytesIO(b'<html>proxy error</html>'))
        with patch.object(api._opener, 'open', side_effect=bad):
            with self.assertRaises(m.DeliveryUnknown):
                api.call('sendMessage', {})

    def test_redirect_handler_never_forwards_credentials(self):
        self.assertIsNone(m.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://elsewhere.invalid/'))

    def test_concurrent_runner_lock(self):
        with self.assertRaisesRegex(m.PublisherError, 'PUBLISHER_BUSY'):
            m.open_state(self.root / 'state.sqlite3')

    def test_ambiguous_response_and_transport_redaction(self):
        api = m.TelegramAPI(TOKEN)
        with patch.object(api._opener, 'open', side_effect=RuntimeError('secret=' + TOKEN)):
            with self.assertRaises(m.DeliveryUnknown) as caught:
                api.call('sendMessage', {})
            self.assertNotIn(TOKEN, str(caught.exception))
            self.assertEqual(str(caught.exception), 'TELEGRAM_RESPONSE_UNKNOWN')

    def test_default_cli_is_dry_run(self):
        import contextlib
        import io
        output = io.StringIO()
        with patch.object(m.TelegramAPI, 'call', side_effect=AssertionError('No network in status')), contextlib.redirect_stdout(output):
            self.assertEqual(m.main(['--config', str(self.config), '--queue', str(self.queue), '--state', str(self.root / 'other.sqlite3')]), 0)
        self.assertEqual(json.loads(output.getvalue())['status'], 'DRY_RUN_NO_SEND')
        self.assertNotIn(TOKEN, output.getvalue())


if __name__ == '__main__':
    unittest.main()
