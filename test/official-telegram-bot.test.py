import copy
import datetime as dt
import importlib.util
import io
import os
import socket
import contextlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('fti_official_bot', Path(__file__).resolve().parents[1] / 'tools/fti-official-bot.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)
ROOT_DIRECTORY = m.root_directory
NOW = 1792933200
HASH = '0x' + 'a' * 64
SNAPSHOT = {'chain': 56, 'token': m.TOKEN_ADDRESS, 'block': 129711000, 'hash': HASH, 'time': NOW,
            'price': '106000000000000000', 'supply': str(1000 * 10 ** 18),
            'reserve': str(106 * 10 ** 18), 'cycle': '1', 'opening': str(10 ** 17)}
TOKEN = str(m.BOT_ID) + ':' + 'a' * 35


class FakeChain:
    def __init__(self):
        self.calls = []
        self.values = dict(SNAPSHOT)
        self.hash = HASH
        self.network = '0x38'
        self.time = NOW
        self.reorg = False

    def __call__(self, method, params):
        self.calls.append((method, params))
        if method == 'eth_chainId':
            return self.network
        if method == 'eth_getBlockByNumber':
            return {'number': hex(SNAPSHOT['block']), 'timestamp': hex(self.time),
                    'hash': ('0x' + 'b' * 64) if self.reorg and params[0] != 'latest' else self.hash}
        assert method == 'eth_call'
        assert params[0]['to'] == m.TOKEN_ADDRESS
        assert params[1] == hex(SNAPSHOT['block'])
        key = next(key for key, value in m.SELECTORS.items() if value == params[0]['data'])
        return '0x' + format(int(self.values[key]), '064x')


class FakeAPI:
    def __init__(self):
        self.calls = []
        self.me = {'id': m.BOT_ID, 'is_bot': True, 'username': m.BOT_USERNAME}
        self.chat = {'id': m.CHANNEL_ID, 'type': 'channel', 'username': m.CHANNEL_USERNAME}
        self.member = {'status': 'administrator', 'user': {'id': m.BOT_ID}, 'can_post_messages': True}
        self.webhook = ''
        self.fail = None
        self.updates = []
        self.db = None

    def call(self, method, params):
        self.calls.append((method, copy.deepcopy(params)))
        if method == 'getMe':
            return self.me
        if method == 'getChat':
            return self.chat
        if method == 'getChatMember':
            return self.member
        if method == 'getWebhookInfo':
            return {'url': self.webhook}
        if method == 'getUpdates':
            return self.updates
        if method == 'sendMessage':
            if self.db and params['chat_id'] == m.CHANNEL_ID:
                assert self.db.execute("SELECT COUNT(*) FROM channel_posts WHERE state='sending'").fetchone()[0] == 1
            if self.fail:
                raise self.fail
            return {'message_id': 55, 'chat': {'id': params['chat_id']}}
        return True


class BotTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.root.chmod(0o700)
        self.db, self.lock = m.open_state(self.root / 'state.sqlite3')
        self.api = FakeAPI()
        self.api.db = self.db

    def tearDown(self):
        self.db.close()
        self.lock.close()
        self.tmp.cleanup()

    def update(self, ident=1, text='/start', language='fa'):
        return {'update_id': ident, 'message': {'message_id': ident, 'from': {'id': 999, 'language_code': language},
                 'chat': {'id': 999, 'type': 'private'}, 'text': text}}

    def sent(self):
        return [params for method, params in self.api.calls if method == 'sendMessage']

    def test_default_preview_needs_no_secret_network_or_local_state(self):
        with patch.object(m, 'TelegramAPI') as api, patch.object(m, 'chain_snapshot') as chain, \
             patch.object(m, 'open_state') as state, contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(m.main([]), 0)
            result = json.loads(out.getvalue())
            self.assertEqual(result['status'], 'PREVIEW_NO_NETWORK_NO_SEND')
            self.assertEqual(result['channel_language'], 'en')
            self.assertFalse(result['channel_schedule_created'])
            api.assert_not_called()
            chain.assert_not_called()
            state.assert_not_called()

    def test_price_preview_never_calls_telegram_or_writes_state(self):
        with patch.object(m, 'TelegramAPI') as api, patch.object(m, 'chain_snapshot', return_value=SNAPSHOT), \
             patch.object(m, 'open_state') as state, contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(m.main(['--price-preview']), 0)
            self.assertEqual(json.loads(out.getvalue())['status'], 'PRICE_TABLE_PREVIEW_NO_SEND')
            api.assert_not_called()
            state.assert_not_called()

    def test_every_language_has_complete_copy_and_private_commands(self):
        self.assertEqual(set(m.COPY), set(m.LANGUAGES))
        for language, text in m.COPY.items():
            self.assertEqual(set(text), set(m.COPY['en']))
            self.assertTrue(all(value for value in text.values()))
            self.assertEqual(len(text['commands']), 4)
            self.assertLessEqual(len(text['intro']), 512)
            self.assertLessEqual(len(text['welcome']), 120)
        plan = list(m.menu_plan())
        self.assertEqual(len(plan), 21)
        for method, params in plan:
            if method == 'setMyCommands':
                self.assertEqual(params['scope'], {'type': 'all_private_chats'})
                self.assertEqual([row['command'] for row in params['commands']], ['start', 'price', 'language', 'help'])

    def test_telegram_detected_language_and_saved_selection(self):
        self.assertEqual(m.reply_update(self.db, self.api, self.update(), now=NOW)['language'], 'fa')
        self.assertIn('به FTI Protocol', self.sent()[-1]['text'])
        callback = {'update_id': 2, 'callback_query': {'id': 'QUERY', 'from': {'id': 999}, 'data': 'lang:tr',
                    'message': {'message_id': 55, 'chat': {'id': 999, 'type': 'private'}}}}
        self.assertEqual(m.reply_update(self.db, self.api, callback, now=NOW + 2)['language'], 'tr')
        self.assertIn('hoş geldiniz', self.sent()[-1]['text'])
        self.assertEqual(m.reply_update(self.db, self.api, self.update(3, '/help', 'fa'), now=NOW + 4)['language'], 'tr')
        self.assertIn('Gözlemlenen', self.sent()[-1]['text'])

    def test_all_seven_languages_can_reply_with_real_price(self):
        for i, language in enumerate(m.COPY):
            message = self.update(i + 1, '/price', language)
            message['message']['chat']['id'] = message['message']['from']['id'] = 1000 + i
            result = m.reply_update(self.db, self.api, message, price_reader=lambda: SNAPSHOT, now=NOW + i * 2)
            self.assertEqual(result['language'], language)
            self.assertIn('0.106 USDT', self.sent()[-1]['text'])
            self.assertIn('0.1 USDT', self.sent()[-1]['text'])
            self.assertIn('+6.0000%', self.sent()[-1]['text'])
            self.assertIn(m.COPY[language]['price'], self.sent()[-1]['text'])

    def test_groups_channels_other_identity_and_bots_never_receive_replies(self):
        for i, changes in enumerate([{'type': 'group'}, {'type': 'supergroup'}, {'type': 'channel'}, {'id': 123}]):
            update = self.update(i + 1)
            update['message']['chat'].update(changes)
            self.assertEqual(m.reply_update(self.db, self.api, update, now=NOW + 2 * i)['status'], 'NON_PRIVATE_UPDATE_IGNORED')
        update = self.update(6)
        update['message']['from']['is_bot'] = True
        m.reply_update(self.db, self.api, update, now=NOW + 12)
        self.assertEqual(self.sent(), [])

    def test_unknown_callback_cannot_control_destination_or_reflect_text(self):
        update = {'update_id': 1, 'callback_query': {'id': 'Q', 'from': {'id': 999}, 'data': 'lang:<evil>',
                  'message': {'chat': {'id': 999, 'type': 'private'}}}}
        self.assertEqual(m.reply_update(self.db, self.api, update, now=NOW)['status'], 'UNKNOWN_CALLBACK_IGNORED')
        self.assertEqual(self.sent(), [])

    def test_language_keyboard_has_only_fixed_callback_codes(self):
        actual = [item['callback_data'] for row in m.language_keyboard()['inline_keyboard'] for item in row]
        self.assertEqual(actual, ['lang:' + language for language in m.COPY])
        self.assertEqual(m.language_for('zh-CN'), 'zh')
        self.assertEqual(m.language_for('pt-BR'), 'en')

    def test_replayed_stale_and_rate_limited_updates_do_not_send_twice(self):
        update = self.update(2)
        m.reply_update(self.db, self.api, update, now=NOW)
        self.assertEqual(m.reply_update(self.db, self.api, update, now=NOW)['status'], 'UPDATE_ALREADY_HANDLED')
        self.assertEqual(m.reply_update(self.db, self.api, self.update(1), now=NOW + 2)['status'], 'STALE_UPDATE_IGNORED')
        self.assertEqual(m.reply_update(self.db, self.api, self.update(3), now=NOW + .5)['status'], 'PRIVATE_RATE_LIMIT')
        self.assertEqual(len(self.sent()), 1)

    def test_ignored_update_retention_is_bounded_too(self):
        self.db.execute("INSERT INTO updates VALUES(1,'ignored')")
        self.db.commit()
        update = self.update(6002)
        update['message']['chat']['type'] = 'group'
        m.reply_update(self.db, self.api, update, now=NOW)
        self.assertEqual(self.db.execute('SELECT id FROM updates').fetchall(), [(6002,)])
        self.assertEqual(self.sent(), [])

    def test_rate_limited_private_callback_is_acknowledged_with_localized_hint(self):
        m.reply_update(self.db, self.api, self.update(), now=NOW)
        callback = {'update_id': 2, 'callback_query': {'id': 'FAST', 'from': {'id': 999}, 'data': 'language',
                    'message': {'chat': {'id': 999, 'type': 'private'}}}}
        self.assertEqual(m.reply_update(self.db, self.api, callback, now=NOW + .1)['status'], 'PRIVATE_RATE_LIMIT')
        ack = [params for method, params in self.api.calls if method == 'answerCallbackQuery']
        self.assertEqual(ack[-1], {'callback_query_id': 'FAST', 'text': m.COPY['fa']['wait']})
        self.assertEqual(len(self.sent()), 1)

    def test_ready_is_only_sent_after_state_identity_offset_and_first_valid_poll(self):
        class ReadyReached(Exception):
            pass
        def ready():
            self.assertIsNotNone(self.db.execute("SELECT value FROM metadata WHERE key='identity'").fetchone())
            self.assertEqual(self.db.execute("SELECT value FROM metadata WHERE key='offset'").fetchone()[0], '0')
            methods = [method for method, _ in self.api.calls]
            self.assertIn('getMe', methods)
            self.assertIn('getWebhookInfo', methods)
            self.assertEqual(methods.count('getUpdates'), 2)
            raise ReadyReached()
        with self.assertRaises(ReadyReached):
            m.poll(self.db, self.api, ready=ready)
        self.assertEqual(self.sent(), [])

    def test_invalid_initial_poll_cannot_signal_service_readiness(self):
        self.api.updates = {'invalid': 'updates'}
        with patch.object(m, 'notify_ready') as ready:
            with self.assertRaisesRegex(m.BotError, 'INVALID_UPDATES'):
                m.poll(self.db, self.api, ready=ready)
            ready.assert_not_called()

    def test_unknown_private_delivery_is_never_retried(self):
        self.api.fail = m.UnknownDelivery('REMOTE_RESPONSE_UNKNOWN')
        self.assertEqual(m.reply_update(self.db, self.api, self.update(), now=NOW)['status'], 'PRIVATE_REPLY_DELIVERY_UNKNOWN')
        self.api.fail = None
        self.assertEqual(m.reply_update(self.db, self.api, self.update(), now=NOW + 2)['status'], 'UPDATE_ALREADY_HANDLED')
        self.assertEqual(len(self.sent()), 1)

    def test_failed_price_read_reports_unavailable_not_fake_zero(self):
        def fail():
            raise m.BotError('PRICE_RPC_UNAVAILABLE')
        m.reply_update(self.db, self.api, self.update(text='/price'), price_reader=fail, now=NOW)
        self.assertEqual(self.sent()[0]['text'], m.COPY['fa']['unavailable'])
        self.assertNotIn('0 USDT', self.sent()[0]['text'])

    def test_price_text_zero_supply_has_no_growth(self):
        snapshot = dict(SNAPSHOT, supply='0', price='0', reserve='0')
        text = m.price_text(snapshot)
        self.assertIn(m.COPY['en']['empty'], text)
        self.assertNotIn('-100', text)

    def test_price_table_uses_actual_rows_and_separate_opening_reference(self):
        low = dict(SNAPSHOT, block=SNAPSHOT['block'] - 1, price=str(9 * 10 ** 16), time=NOW - 100)
        stale_cycle = dict(SNAPSHOT, cycle='0', block=1, price='1000000000000')
        payload = m.channel_table(SNAPSHOT, [low, SNAPSHOT, stale_cycle])
        text = payload['text']
        self.assertIn('opening quote (reference)', text)
        self.assertIn('0.1 USDT', text)
        self.assertIn('0.09  -10.0000%', text)
        self.assertIn('0.106  +6.0000%', text)
        self.assertIn('2026-10-25 13:00', text)
        self.assertNotIn('0.000001', text)
        self.assertEqual(payload['chat_id'], m.CHANNEL_ID)
        self.assertEqual(len(payload['reply_markup']['inline_keyboard']), 2)
        self.assertTrue(text.isascii())

    def test_history_deduplicates_observed_blocks_and_does_not_invent_opening(self):
        m.remember(self.db, SNAPSHOT)
        m.remember(self.db, SNAPSHOT)
        rows = m.observed_rows(self.db, '1')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['price'], SNAPSHOT['price'])
        self.assertNotEqual(rows[0]['price'], SNAPSHOT['opening'])
        with self.assertRaisesRegex(m.BotError, 'OBSERVATION_BLOCK_CHANGED'):
            m.remember(self.db, dict(SNAPSHOT, hash='0x' + 'b' * 64))

    def test_table_history_drops_orphans_and_rejects_current_reorg(self):
        old = dict(SNAPSHOT, block=SNAPSHOT['block'] - 1, time=NOW - 100)
        m.remember(self.db, old)
        m.remember(self.db, SNAPSHOT)
        def read(method, params):
            return {'hash': HASH if params[0] == hex(SNAPSHOT['block']) else '0x' + 'b' * 64, 'timestamp': hex(NOW)}
        rows = m.verified_history(self.db, SNAPSHOT, read)
        self.assertEqual([row['block'] for row in rows], [SNAPSHOT['block']])
        with self.assertRaisesRegex(m.BotError, 'PRICE_BLOCK_CHANGED'):
            m.verified_history(self.db, SNAPSHOT, lambda method, params: {'hash': '0x' + 'b' * 64, 'timestamp': hex(NOW)})

    def test_channel_post_durable_intent_and_repeat_does_not_repost(self):
        payload = m.channel_table(SNAPSHOT, [SNAPSHOT])
        first = m.publish_price(self.db, self.api, payload, 'price-20261025', now=NOW)
        second = m.publish_price(self.db, self.api, payload, 'price-20261025', now=NOW + 1)
        self.assertEqual(first['status'], 'PRICE_TABLE_PUBLISHED')
        self.assertEqual(second['status'], 'ALREADY_PUBLISHED')
        self.assertEqual(len(self.sent()), 1)
        self.assertNotIn(TOKEN, self.db.execute('SELECT payload_sha256 FROM channel_posts').fetchone()[0])

    def test_unknown_channel_post_or_crash_intent_cannot_be_retried(self):
        self.api.fail = m.UnknownDelivery('REMOTE_RESPONSE_UNKNOWN')
        payload = m.channel_table(SNAPSHOT, [SNAPSHOT])
        with self.assertRaisesRegex(m.BotError, 'MANUAL_REVIEW'):
            m.publish_price(self.db, self.api, payload, 'unknown', now=NOW)
        self.api.fail = None
        with self.assertRaisesRegex(m.BotError, 'MANUAL_REVIEW'):
            m.publish_price(self.db, self.api, payload, 'unknown', now=NOW + 1)
        self.assertEqual(len(self.sent()), 1)
        self.db.execute("INSERT INTO channel_posts VALUES('crashed','sending','digest',NULL,0)")
        self.db.commit()
        with self.assertRaisesRegex(m.BotError, 'MANUAL_REVIEW'):
            m.publish_price(self.db, self.api, payload, 'crashed', now=NOW + 1)
        self.assertEqual(len(self.sent()), 1)

    def test_rejected_channel_post_requires_review(self):
        self.api.fail = m.Rejected(429)
        with self.assertRaises(m.Rejected):
            m.publish_price(self.db, self.api, m.channel_table(SNAPSHOT, [SNAPSHOT]), 'rejected', now=NOW)
        with self.assertRaisesRegex(m.BotError, 'MANUAL_REVIEW'):
            m.publish_price(self.db, self.api, m.channel_table(SNAPSHOT, [SNAPSHOT]), 'rejected', now=NOW + 10)
        self.assertEqual(len(self.sent()), 1)

    def test_wrong_bot_channel_or_permission_never_publishes(self):
        for obj, key, value in [('me', 'id', 1), ('chat', 'id', -2), ('chat', 'username', 'Other'), ('member', 'can_post_messages', False)]:
            api = FakeAPI()
            getattr(api, obj)[key] = value
            with self.assertRaises(m.BotError):
                m.publish_price(self.db, api, m.channel_table(SNAPSHOT, [SNAPSHOT]), 'identity', now=NOW)
            self.assertNotIn('sendMessage', [method for method, _ in api.calls])

    def test_initial_poll_arms_without_replaying_old_private_commands(self):
        self.api.updates = [self.update(10)]
        result = m.poll(self.db, self.api, once=True)
        self.assertEqual(result['status'], 'BOT_INITIALIZED_NO_OLD_REPLIES')
        self.assertEqual(self.sent(), [])
        self.assertEqual(self.db.execute("SELECT value FROM metadata WHERE key='offset'").fetchone()[0], '11')

    def test_active_webhook_is_preserved_and_polling_refused(self):
        self.api.webhook = 'https://example.invalid/active'
        with self.assertRaisesRegex(m.BotError, 'ACTIVE_WEBHOOK_REQUIRES_REVIEW'):
            m.poll(self.db, self.api, once=True)
        self.assertNotIn('getUpdates', [method for method, _ in self.api.calls])
        self.assertNotIn('deleteWebhook', m.TelegramAPI.METHODS)

    def test_poll_processes_new_updates_in_order_and_retains_offset(self):
        self.db.execute("INSERT INTO metadata VALUES('offset','11')")
        self.db.commit()
        self.api.updates = [self.update(11), self.update(12)]
        self.assertEqual(m.poll(self.db, self.api, once=True)['updates'], 2)
        self.assertEqual(self.db.execute("SELECT value FROM metadata WHERE key='offset'").fetchone()[0], '13')
        self.assertEqual(len(self.sent()), 1)  # two immediate commands are rate limited

    def test_channel_private_config_identity_and_permissions(self):
        config = self.root / 'config.json'
        value = {'bot_token': TOKEN, 'expected_bot_id': m.BOT_ID, 'channel_id': m.CHANNEL_ID, 'expected_channel_id': m.CHANNEL_ID}
        config.write_text(json.dumps(value))
        config.chmod(0o600)
        self.assertEqual(m.config_file(config), value)
        config.chmod(0o644)
        with self.assertRaisesRegex(m.BotError, 'PRIVATE_CONFIG_REQUIRED'):
            m.config_file(config)
        config.chmod(0o600)
        link = self.root / 'config-link'
        link.symlink_to(config)
        with self.assertRaises(m.BotError):
            m.config_file(link)
        value['expected_bot_id'] = 1
        config.write_text(json.dumps(value))
        with self.assertRaisesRegex(m.BotError, 'OFFICIAL_IDENTITY_REQUIRED'):
            m.config_file(config)

    def test_method_allowlist_and_token_validation(self):
        for token in [TOKEN + '/sendMessage', '123456:' + 'a' * 35]:
            with self.assertRaises(m.BotError):
                m.TelegramAPI(token)
        api = m.TelegramAPI(TOKEN)
        with self.assertRaisesRegex(m.BotError, 'METHOD_NOT_ALLOWED'):
            api.call('deleteWebhook', {})
        with self.assertRaisesRegex(m.BotError, 'RPC_METHOD_NOT_ALLOWED'):
            m.rpc('eth_sendRawTransaction', [])

    def test_separate_private_service_does_not_schedule_channel_posts(self):
        unit = m.unit_text('/opt/fti-telegram/official-bot/abc/bot.py')
        self.assertIn('Type=notify', unit)
        self.assertIn('NotifyAccess=main', unit)
        self.assertIn('DynamicUser=yes', unit)
        self.assertIn('LoadCredential=botconfig:/etc/fti-telegram/config.json', unit)
        self.assertIn('--poll', unit)
        self.assertIn('StateDirectoryMode=0700', unit)
        self.assertIn('ProtectSystem=strict', unit)
        self.assertNotIn('--publish-price', unit)
        self.assertNotIn('OnCalendar', unit)
        self.assertNotIn(TOKEN, unit)


class SystemdStateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.root.chmod(0o700)
        self.public = self.root / 'var-lib'
        self.public.mkdir(mode=0o755)
        self.private = self.public / 'private'
        self.private.mkdir(mode=0o700)
        self.directory = self.private / 'fti-official-bot'
        self.directory.mkdir(mode=0o700)
        self.alias = self.public / 'fti-official-bot'
        self.alias.symlink_to(self.directory)
        self.state = self.alias / 'state.sqlite3'
        # Real directories, symlinks, SQLite, locks and fsync are exercised.
        # Fixture ownership maps to root so these checks also run on non-root CI.
        original = Path.lstat
        owned = {self.public, self.private, self.directory, self.alias}
        def lstat(path):
            info = original(path)
            if path in owned:
                return type('Info', (), {'st_mode': info.st_mode, 'st_uid': 0})()
            return info
        self.patches = [patch.object(m, 'STATE', self.state), patch.object(m, 'SYSTEMD_PRIVATE_STATE', self.directory),
                        patch.object(Path, 'lstat', lstat)]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.tmp.cleanup()

    def test_exact_systemd_alias_opens_private_database_and_reopens_durable_state(self):
        db, lock = m.open_state(self.state)
        db.execute("INSERT INTO chats VALUES(77,'fa',0)")
        db.commit()
        db.close()
        lock.close()
        self.assertEqual((self.directory / 'state.sqlite3').stat().st_mode & 0o777, 0o600)
        again, second = m.open_state(self.state)
        try:
            self.assertEqual(again.execute('SELECT language FROM chats WHERE id=77').fetchone()[0], 'fa')
        finally:
            again.close()
            second.close()

    def test_systemd_relative_private_alias_opens_the_exact_private_database(self):
        self.alias.unlink()
        self.alias.symlink_to('private/fti-official-bot')
        db, lock = m.open_state(self.state)
        try:
            self.assertEqual(m.state_path(self.state), self.directory / 'state.sqlite3')
            self.assertIsNotNone(db.execute("SELECT value FROM metadata WHERE key='identity'").fetchone())
        finally:
            db.close()
            lock.close()
        self.assertTrue((self.directory / 'state.sqlite3').is_file())

    def test_arbitrary_alias_does_not_gain_permission_to_follow_links(self):
        other = self.public / 'other-bot'
        other.symlink_to(self.directory)
        with self.assertRaisesRegex(m.BotError, 'PRIVATE_STATE_DIRECTORY_REQUIRED'):
            m.open_state(other / 'state.sqlite3')
        self.assertFalse((self.directory / 'state.sqlite3').exists())

    def test_expected_alias_with_other_destination_is_rejected_without_writing(self):
        outside = self.root / 'outside'
        outside.mkdir(mode=0o700)
        self.alias.unlink()
        self.alias.symlink_to(outside)
        with self.assertRaisesRegex(m.BotError, 'PRIVATE_STATE_DIRECTORY_REQUIRED'):
            m.open_state(self.state)
        self.assertEqual(list(outside.iterdir()), [])

    def test_private_destination_link_or_public_permissions_are_rejected(self):
        self.directory.chmod(0o755)
        with self.assertRaisesRegex(m.BotError, 'PRIVATE_STATE_DIRECTORY_REQUIRED'):
            m.open_state(self.state)
        self.directory.chmod(0o700)
        self.directory.rmdir()
        outside = self.root / 'outside'
        outside.mkdir(mode=0o700)
        self.directory.symlink_to(outside)
        with self.assertRaisesRegex(m.BotError, 'PRIVATE_STATE_DIRECTORY_REQUIRED'):
            m.open_state(self.state)
        self.assertEqual(list(outside.iterdir()), [])

    def test_unrelated_state_parent_symlink_is_rejected(self):
        elsewhere = self.root / 'unrelated'
        elsewhere.symlink_to(self.directory)
        with self.assertRaisesRegex(m.BotError, 'PRIVATE_STATE_DIRECTORY_REQUIRED'):
            m.open_state(elsewhere / 'ledger.sqlite3')

    def test_arbitrary_ancestor_alias_is_rejected_before_database_creation(self):
        real = self.root / 'real-parent'
        real.mkdir(mode=0o700)
        child = real / 'child'
        child.mkdir(mode=0o700)
        link = self.root / 'ancestor'
        link.symlink_to(real)
        with self.assertRaisesRegex(m.BotError, 'PRIVATE_STATE_DIRECTORY_REQUIRED'):
            m.open_state(link / 'child' / 'state.sqlite3')
        self.assertEqual(list(child.iterdir()), [])


class ReadinessTests(unittest.TestCase):
    def test_real_notify_socket_receives_readiness_payload_without_secret(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = str(Path(temporary) / 'notify')
            try:
                listener = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
            except PermissionError:
                self.skipTest('Executor forbids Unix datagram sockets; real transport check runs on Linux CI')
            with listener:
                listener.bind(destination)
                listener.settimeout(1)
                with patch.dict(os.environ, {'NOTIFY_SOCKET': destination}):
                    self.assertTrue(m.notify_ready())
                self.assertEqual(listener.recv(1024), b'READY=1\nSTATUS=Verified Telegram polling is ready')

    def test_missing_notify_socket_allows_explicit_foreground_poll(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(m.notify_ready())

    def test_unreachable_notify_socket_never_reports_ready(self):
        with patch.dict(os.environ, {'NOTIFY_SOCKET': '/nonexistent/fti-notify-socket'}):
            with self.assertRaisesRegex(m.BotError, 'SERVICE_READINESS_NOT_DELIVERED'):
                m.notify_ready()

    def properties(self, **changes):
        values = dict(Type='notify', ActiveState='active', SubState='running', MainPID='123',
                      NRestarts='0', Result='success', StatusText='Verified Telegram polling is ready')
        values.update(changes)
        return type('Result', (), {'stdout': '\n'.join(key + '=' + value for key, value in values.items()).encode()})()

    def test_service_requires_two_stable_ready_checks(self):
        with patch.object(m, 'systemd', side_effect=[self.properties(), self.properties()]) as run, patch.object(m.time, 'sleep') as pause:
            m.service_ready()
            self.assertEqual(run.call_count, 2)
            pause.assert_called_once_with(1)

    def test_simple_brief_active_or_unready_service_is_not_accepted(self):
        for changes in [dict(Type='simple'), dict(ActiveState='activating'), dict(StatusText=''), dict(MainPID='0'), dict(SubState='auto-restart')]:
            with patch.object(m, 'systemd', return_value=self.properties(**changes)), patch.object(m.time, 'sleep'):
                with self.assertRaisesRegex(m.BotError, 'BOT_SERVICE_NOT_READY'):
                    m.service_ready()

    def test_changed_pid_or_restart_counter_is_not_stable(self):
        for changes in [dict(MainPID='124'), dict(NRestarts='1')]:
            with patch.object(m, 'systemd', side_effect=[self.properties(), self.properties(**changes)]), patch.object(m.time, 'sleep'):
                with self.assertRaisesRegex(m.BotError, 'BOT_SERVICE_NOT_STABLE'):
                    m.service_ready()


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.root.chmod(0o700)
        self.units = self.root / 'units'
        self.units.mkdir()
        self.config = self.root / 'private' / 'config.json'
        self.config.parent.mkdir(mode=0o700)
        self.config.write_text(json.dumps({'bot_token': TOKEN, 'expected_bot_id': m.BOT_ID,
                               'channel_id': m.CHANNEL_ID, 'expected_channel_id': m.CHANNEL_ID}))
        self.config.chmod(0o600)
        self.releases = self.root / 'releases'
        self.api = FakeAPI()
        self.commands = []
        self.fail_active = False
        self.concurrent_unit = None
        def directory(path, mode=0o755):
            path.mkdir(parents=True, mode=mode, exist_ok=True)
            return path
        def run(*args):
            self.commands.append(args)
            if args[:3] == ('systemctl', 'is-active', '--quiet') and self.fail_active:
                if self.concurrent_unit:
                    (self.units / m.SERVICE).write_bytes(self.concurrent_unit)
                raise RuntimeError('FAKE_START_FAILED')
            return type('Result', (), {'stdout': b''})()
        self.patches = [patch.object(m, 'UNITS', self.units), patch.object(m, 'CONFIG', self.config),
                        patch.object(m, 'RELEASES', self.releases), patch.object(m, 'TelegramAPI', return_value=self.api),
                        patch.object(m, 'root_directory', side_effect=directory), patch.object(m, 'systemd', side_effect=run),
                        patch.object(m, 'service_ready')]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.tmp.cleanup()

    def test_installs_isolated_service_and_preserves_existing_secret(self):
        before = self.config.read_bytes()
        result = m.install_locked()
        self.assertEqual(result['status'], 'OFFICIAL_MULTILINGUAL_BOT_ACTIVE')
        self.assertFalse(result['new_private_config'])
        self.assertFalse(result['channel_schedule_created'])
        self.assertEqual(self.config.read_bytes(), before)
        source = next(self.releases.glob('*/bot.py'))
        self.assertEqual(source.read_bytes(), Path(m.__file__).read_bytes())
        self.assertEqual((self.units / m.SERVICE).read_text(), m.unit_text(source))
        self.assertIn(('systemctl', 'enable', '--now', m.SERVICE), self.commands)
        self.assertEqual(len([method for method, _ in self.api.calls if method == 'setMyCommands']), 7)
        self.assertNotIn('sendMessage', [method for method, _ in self.api.calls])
        self.assertTrue(all('fti-telegram-publisher' not in str(cmd) for cmd in self.commands))

    def test_failed_start_removes_only_its_unit_source_and_preserves_existing_secret(self):
        before = self.config.read_bytes()
        self.fail_active = True
        with self.assertRaisesRegex(RuntimeError, 'FAKE_START_FAILED'):
            m.install_locked()
        self.assertFalse((self.units / m.SERVICE).exists())
        self.assertEqual(list(self.releases.glob('*/bot.py')), [])
        self.assertEqual(self.config.read_bytes(), before)
        self.assertIn(('systemctl', 'disable', '--now', m.SERVICE), self.commands)

    def test_failed_notified_readiness_rolls_back_instead_of_reporting_active(self):
        before = self.config.read_bytes()
        m.service_ready.side_effect = m.BotError('BOT_SERVICE_NOT_READY')
        with self.assertRaisesRegex(m.BotError, 'BOT_SERVICE_NOT_READY'):
            m.install_locked()
        self.assertFalse((self.units / m.SERVICE).exists())
        self.assertEqual(list(self.releases.glob('*/bot.py')), [])
        self.assertEqual(self.config.read_bytes(), before)
        self.assertIn(('systemctl', 'disable', '--now', m.SERVICE), self.commands)

    def test_failed_start_preserves_concurrent_foreign_unit(self):
        self.fail_active = True
        self.concurrent_unit = b'CONCURRENT_OPERATOR_EDIT'
        with self.assertRaises(RuntimeError):
            m.install_locked()
        self.assertEqual((self.units / m.SERVICE).read_bytes(), self.concurrent_unit)
        self.assertEqual(len(list(self.releases.glob('*/bot.py'))), 1)
        self.assertNotIn(('systemctl', 'disable', '--now', m.SERVICE), self.commands)

    def test_restrictive_operator_umask_still_creates_world_readable_bot_source(self):
        previous = os.umask(0o077)
        try:
            m.install_locked()
        finally:
            os.umask(previous)
        source = next(self.releases.glob('*/bot.py'))
        self.assertEqual(source.stat().st_mode & 0o777, 0o644)
        self.assertEqual((self.units / m.SERVICE).stat().st_mode & 0o777, 0o644)
        self.assertEqual(self.config.stat().st_mode & 0o777, 0o600)

    def test_real_public_directory_creation_ignores_restrictive_umask(self):
        actual = Path.lstat
        def info(path):
            real = actual(path)
            mode = real.st_mode
            if path in self.root.parents or path == self.root:
                mode = (mode & ~0o022) | 0o001
            return type('Info', (), {'st_mode': mode, 'st_uid': 0})()
        # setUp replaces root_directory for install isolation; use the saved real
        # implementation here to exercise its filesystem operations explicitly.
        original = ROOT_DIRECTORY
        previous = os.umask(0o077)
        try:
            with patch.object(Path, 'lstat', info):
                original(self.root / 'public-runtime' / 'release')
        finally:
            os.umask(previous)
        self.assertEqual((self.root / 'public-runtime').stat().st_mode & 0o777, 0o755)
        self.assertEqual((self.root / 'public-runtime' / 'release').stat().st_mode & 0o777, 0o755)

    def test_existing_world_writable_bot_source_is_rejected_without_menu_mutation(self):
        m.install_locked()
        source = next(self.releases.glob('*/bot.py'))
        source.chmod(0o666)
        self.api.calls.clear()
        # Remove only the fixture's unit so source-integrity validation is reached
        # on non-root CI without bypassing actual source mode checks.
        (self.units / m.SERVICE).unlink()
        with self.assertRaisesRegex(m.BotError, 'INSTALLED_SOURCE_MISMATCH'):
            m.install_locked()
        self.assertNotIn('setMyCommands', [method for method, _ in self.api.calls])
        self.assertEqual(source.stat().st_mode & 0o777, 0o666)

    def test_active_webhook_refuses_before_install_files_or_menu_changes(self):
        self.api.webhook = 'https://example.invalid/active'
        with self.assertRaisesRegex(m.BotError, 'ACTIVE_WEBHOOK_REQUIRES_REVIEW'):
            m.install_locked()
        self.assertFalse(self.releases.exists())
        self.assertFalse((self.units / m.SERVICE).exists())
        self.assertNotIn('setMyCommands', [method for method, _ in self.api.calls])

    def test_foreign_unit_is_preserved_before_token_or_menu_operations(self):
        target = self.units / m.SERVICE
        target.write_text('FOREIGN_SERVICE')
        with self.assertRaisesRegex(m.BotError, 'BOT_SERVICE_ALREADY_EXISTS_REQUIRES_REVIEW'):
            m.install_locked()
        self.assertEqual(target.read_text(), 'FOREIGN_SERVICE')
        self.assertEqual(self.api.calls, [])


class ChainTests(unittest.TestCase):
    def test_all_contract_reads_share_one_checked_block(self):
        chain = FakeChain()
        self.assertEqual(m.chain_snapshot(chain, now=NOW + 5), SNAPSHOT)
        self.assertEqual(len([method for method, _ in chain.calls if method == 'eth_call']), 5)
        self.assertTrue(all(method in {'eth_chainId', 'eth_call', 'eth_getBlockByNumber'} for method, _ in chain.calls))

    def test_network_staleness_and_reorg_fail_closed(self):
        for mutate, expected in [(lambda c: setattr(c, 'network', '0x61'), 'WRONG_PRICE_NETWORK'),
                                 (lambda c: setattr(c, 'time', NOW - 100), 'STALE_PRICE_BLOCK'),
                                 (lambda c: setattr(c, 'time', NOW + 20), 'STALE_PRICE_BLOCK'),
                                 (lambda c: setattr(c, 'reorg', True), 'PRICE_BLOCK_CHANGED')]:
            chain = FakeChain()
            mutate(chain)
            with self.assertRaisesRegex(m.BotError, expected):
                m.chain_snapshot(chain, now=NOW)

    def test_reserve_supply_mismatch_or_missing_opening_never_displays(self):
        for mutate, expected in [(lambda c: c.values.update(price='1'), 'PRICE_RESERVE_MISMATCH'),
                                 (lambda c: c.values.update(opening='0'), 'INVALID_CYCLE_QUOTE')]:
            chain = FakeChain()
            mutate(chain)
            with self.assertRaisesRegex(m.BotError, expected):
                m.chain_snapshot(chain, now=NOW)

    def test_zero_supply_does_not_invent_a_spot_quote(self):
        chain = FakeChain()
        chain.values.update(supply='0', price='0', reserve='0')
        result = m.chain_snapshot(chain, now=NOW)
        self.assertEqual(result['price'], '0')
        self.assertEqual(result['opening'], str(10 ** 17))
        self.assertIn('No spot price', m.channel_table(result, [result])['text'])

    def test_integer_formatting_and_negative_growth_without_float_error(self):
        self.assertEqual(m.decimal_text(str(10 ** 17)), '0.1')
        self.assertEqual(m.growth('95000000000000000', str(10 ** 17)), '-5.0000%')
        self.assertEqual(m.growth(str(10 ** 17), str(10 ** 17)), '0.0000%')
        self.assertEqual(m.growth(str(10 ** 17 + 1), str(10 ** 17)), '+0.0000%')
        self.assertEqual(m.decimal_text('1'), '0.000000000000000001')
        self.assertNotEqual(m.decimal_text('4999999999'), '0')


if __name__ == '__main__':
    unittest.main()
