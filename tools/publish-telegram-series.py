#!/usr/bin/env python3
"""Preview or publish the approved 20-photo English series, with durable no-retry receipts."""
import argparse
from contextlib import contextmanager
import fcntl
import getpass
import html
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
import unicodedata
import warnings

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('fti_series_setup', ROOT / 'tools/configure-telegram-channel.py')
base = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(base)
Error, CHANNEL_ID, BOT_ID = base.SetupError, base.CHANNEL_ID, base.BOT_ID
BUTTONS = base.BUTTONS
CONFIG = 'config/telegram-series-20261024.en.json'
RECEIPT = 'marketing/telegram/live-series-20261024.json'


def fingerprint(value):
    return base.digest(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())


def units(text):
    return len(text.encode('utf-16-le')) // 2


def load_plan(root=None):
    root = root or ROOT
    try:
        source = json.loads((root / CONFIG).read_text())
        if (source['version'] != 1 or source['language'] != 'en' or type(source['channel_id']) is not int
                or source['channel_id'] != CHANNEL_ID or type(source['bot_id']) is not int or source['bot_id'] != BOT_ID
                or not isinstance(source['posts'], list) or len(source['posts']) != 20):
            raise ValueError()
        custom_id = source.get('brand_custom_emoji_id')
        if custom_id is not None and (not isinstance(custom_id, str) or not re.fullmatch(r'[1-9][0-9]{0,24}', custom_id)):
            raise ValueError()
        ids, texts, images, result = set(), set(), set(), []
        for number, item in enumerate(source['posts'], 1):
            ident, title, text = item['id'], item['title'], item['text']
            expected = f'marketing/telegram/series-20261024/{number:02}.png'
            if (not isinstance(ident, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', ident) or ident in ids
                    or not isinstance(title, str) or not title.strip() or '\n' in title
                    or not isinstance(text, str) or text.split('\n', 1)[0] != title or text.casefold() in texts
                    or any(c.isalpha() and 'LATIN' not in unicodedata.name(c, '') for c in text)
                    or item['asset'] != expected):
                raise ValueError()
            hashtags = re.findall(r'#[A-Za-z][A-Za-z0-9_]*', text)
            if len(hashtags) != 3 or len(set(hashtags)) != 3 or '#FTIProtocol' not in hashtags:
                raise ValueError()
            emoji = item.get('emoji', '🟢')
            if (not isinstance(emoji, str) or not 1 <= units(emoji) <= 16 or not any(ord(c) > 127 for c in emoji)
                    or any(c.isspace() or c.isalnum() or c in '<>&#' for c in emoji)):
                raise ValueError()
            prefix = '🟢' if custom_id else emoji
            rich_prefix = f'<tg-emoji emoji-id="{custom_id}">🟢</tg-emoji>' if custom_id else html.escape(emoji)
            caption = rich_prefix + ' <b>' + html.escape(title) + '</b>' + html.escape(text[len(title):])
            parsed = prefix + ' ' + text
            if units(parsed) > 1024:
                raise ValueError()
            image = base.read_png(root / expected)
            asset_hash = base.digest(image)
            if asset_hash in images:
                raise ValueError()
            params = {'chat_id': CHANNEL_ID, 'caption': caption, 'parse_mode': 'HTML',
                      'reply_markup': BUTTONS, 'disable_notification': True}
            post = {'id': ident, 'params': params, 'text': parsed, 'bold_offset': units(prefix) + 1,
                    'title_length': units(title), 'custom_emoji_id': custom_id,
                    'caption_sha256': base.digest(caption.encode()), 'asset_sha256': asset_hash, 'photo': image}
            post['fingerprint'] = fingerprint({k: v for k, v in post.items() if k != 'photo'})
            result.append(post)
            ids.add(ident)
            texts.add(text.casefold())
            images.add(asset_hash)
        return {'posts': result, 'fingerprint': fingerprint([p['fingerprint'] for p in result])}
    except Exception:
        raise Error('INVALID_OR_MISSING_ENGLISH_SERIES_OR_PNG') from None


@contextmanager
def locked_state(path, plan):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(path) + '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Error('TELEGRAM_SERIES_BUSY') from None
        try:
            if path.is_symlink() or (path.exists() and not stat.S_ISREG(path.lstat().st_mode)):
                raise ValueError()
            if path.exists():
                state = json.loads(path.read_text())
                if (state['schema_version'] != 1 or state['workflow'] != 'english-series-20261024'
                        or type(state['channel_id']) is not int or state['channel_id'] != CHANNEL_ID
                        or type(state['bot_id']) is not int or state['bot_id'] != BOT_ID
                        or state['plan_sha256'] != plan['fingerprint'] or not isinstance(state['posts'], dict)
                        or set(state['posts']) - {p['id'] for p in plan['posts']}):
                    raise ValueError()
            else:
                state = {'schema_version': 1, 'workflow': 'english-series-20261024',
                         'channel_id': CHANNEL_ID, 'bot_id': BOT_ID, 'plan_sha256': plan['fingerprint'], 'posts': {}}
        except Exception:
            raise Error('CONFLICTING_SERIES_RECEIPT') from None
        yield state


def safe_file_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,1000}', value):
        raise Error('INVALID_PHOTO_CONFIRMATION')
    return value


def verify_message(message, post):
    if (not isinstance(message, dict) or type(message.get('message_id')) is not int or message['message_id'] <= 0
            or type(message.get('chat', {}).get('id')) is not int or message['chat']['id'] != CHANNEL_ID
            or message.get('caption') != post['text'] or message.get('reply_markup') != BUTTONS):
        raise Error('POST_CONFIRMATION_MISMATCH')
    entities = message.get('caption_entities', [])
    def entity(kind, offset, length):
        return [e for e in entities if isinstance(e, dict) and e.get('type') == kind
                and type(e.get('offset')) is int and e['offset'] == offset
                and type(e.get('length')) is int and e['length'] == length]
    if not entity('bold', post['bold_offset'], post['title_length']):
        raise Error('CAPTION_FORMAT_CONFIRMATION_MISMATCH')
    if post['custom_emoji_id'] and not any(e.get('custom_emoji_id') == post['custom_emoji_id']
                                        for e in entity('custom_emoji', 0, units('🟢'))):
        raise Error('CUSTOM_EMOJI_CONFIRMATION_MISMATCH')
    photos = message.get('photo')
    if not isinstance(photos, list) or not 1 <= len(photos) <= 20 or any(not isinstance(p, dict) for p in photos):
        raise Error('INVALID_PHOTO_CONFIRMATION')
    return {'message_id': message['message_id'], 'photo_file_ids': [safe_file_id(p.get('file_id')) for p in photos],
            'caption_verified': True, 'buttons_verified': True, 'custom_emoji_verified': bool(post['custom_emoji_id'])}


def identity(api):
    me = api.call('getMe', {})
    chat = api.call('getChat', {'chat_id': CHANNEL_ID})
    if (type(me.get('id')) is not int or me['id'] != BOT_ID or me.get('is_bot') is not True
            or me.get('username') != 'FTIProtocol_OfficialBot'):
        raise Error('BOT_IDENTITY_MISMATCH')
    if (type(chat.get('id')) is not int or chat['id'] != CHANNEL_ID or chat.get('type') != 'channel'
            or chat.get('username') != 'FTIProtocol_Official'):
        raise Error('CHANNEL_IDENTITY_MISMATCH')
    member = api.call('getChatMember', {'chat_id': CHANNEL_ID, 'user_id': BOT_ID})
    if (type(member.get('user', {}).get('id')) is not int or member['user']['id'] != BOT_ID
            or member.get('status') != 'administrator' or member.get('can_post_messages') is not True):
        raise Error('BOT_POST_PERMISSION_REQUIRED')
    return pin_id(chat)


def pin_id(chat):
    message = chat.get('pinned_message')
    if message is None:
        return None
    if not isinstance(message, dict) or type(message.get('message_id')) is not int or message['message_id'] <= 0:
        raise Error('INVALID_CHANNEL_PIN_RESPONSE')
    return message['message_id']


def publish(api, plan, path):
    with locked_state(path, plan) as state:
        current_pin = identity(api)
        if 'pinned_message_id_baseline' in state:
            baseline = state['pinned_message_id_baseline']
            if (baseline is not None and (type(baseline) is not int or baseline <= 0)):
                raise Error('CONFLICTING_SERIES_RECEIPT')
            if baseline != current_pin:
                raise Error('CHANNEL_PIN_CHANGED_SINCE_SERIES_START')
        else:
            if state['posts']:
                raise Error('SERIES_PIN_BASELINE_REQUIRES_MANUAL_REVIEW')
            baseline = state['pinned_message_id_baseline'] = current_pin
        known_ids = set()
        for post in plan['posts']:
            if post['id'] not in state['posts']:
                continue
            record = state['posts'][post['id']]
            if not isinstance(record, dict):
                raise Error('CONFLICTING_SERIES_RECEIPT')
            if record.get('status') == 'sending':
                record['status'] = 'unknown'
                base.save_receipt(path, state)
            if record.get('status') != 'sent':
                raise Error('SERIES_REQUIRES_MANUAL_REVIEW')
            if (record.get('fingerprint') != post['fingerprint'] or type(record.get('message_id')) is not int
                    or record['message_id'] <= 0 or record['message_id'] in known_ids
                    or record.get('caption_verified') is not True or record.get('buttons_verified') is not True
                    or record.get('custom_emoji_verified') is not bool(post['custom_emoji_id'])
                    or not isinstance(record.get('photo_file_ids'), list) or not record['photo_file_ids']
                    or any(safe_file_id(v) != v for v in record['photo_file_ids'])):
                raise Error('CONFLICTING_SERIES_RECEIPT')
            known_ids.add(record['message_id'])
        pending = [p for p in plan['posts'] if p['id'] not in state['posts']]
        for index, post in enumerate(pending):
            record = {k: post[k] for k in ['fingerprint', 'caption_sha256', 'asset_sha256']}
            record.update(status='sending', intent_at=base.now())
            state['posts'][post['id']] = record
            base.save_receipt(path, state)
            try:
                confirmation = verify_message(api.call('sendPhoto', post['params'], post['photo']), post)
                if confirmation['message_id'] in known_ids:
                    raise Error('DUPLICATE_MESSAGE_CONFIRMATION')
            except base.Rejected:
                record.update(status='rejected', review_required=True)
                base.save_receipt(path, state)
                raise Error('SERIES_REJECTED_REQUIRES_MANUAL_REVIEW') from None
            except Exception:
                record.update(status='unknown', review_required=True)
                base.save_receipt(path, state)
                raise Error('SERIES_DELIVERY_UNKNOWN_REVIEW_RECEIPT') from None
            record.update(status='sent', confirmed_at=base.now(), **confirmation)
            base.save_receipt(path, state)
            known_ids.add(confirmation['message_id'])
            print(json.dumps({'status': 'POST_CONFIRMED', 'id': post['id'],
                              'message_id': confirmation['message_id'], 'confirmed_count': len(known_ids)}, sort_keys=True), flush=True)
            if index + 1 < len(pending):
                time.sleep(4)
        chat = api.call('getChat', {'chat_id': CHANNEL_ID})
        if (type(chat.get('id')) is not int or chat['id'] != CHANNEL_ID or chat.get('type') != 'channel'
                or chat.get('username') != 'FTIProtocol_Official'):
            raise Error('FINAL_CHANNEL_IDENTITY_MISMATCH')
        if pin_id(chat) != baseline:
            raise Error('CHANNEL_PIN_CHANGED_DURING_SERIES')
        state['verified_at'] = base.now()
        base.save_receipt(path, state)
        return {'status': 'VERIFIED', 'channel_id': CHANNEL_ID, 'confirmed_count': len(known_ids),
                'pinned_message_id': baseline, 'message_ids': {key: value['message_id'] for key, value in state['posts'].items()}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--preview', action='store_true')
    mode.add_argument('--apply', action='store_true')
    args = parser.parse_args(argv)
    try:
        plan = load_plan()
        if not args.apply:
            print(json.dumps({'status': 'PREVIEW', 'channel_id': CHANNEL_ID, 'bot_id': BOT_ID,
                'plan_sha256': plan['fingerprint'], 'posts': [
                    {k: v for k, v in post.items() if k != 'photo'} for post in plan['posts']]}, indent=2))
            return 0
        if not sys.stdin.isatty():
            raise Error('INTERACTIVE_TTY_REQUIRED')
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            token = getpass.getpass('Telegram bot token (hidden): ')
        result = publish(base.TelegramAPI(token), plan, ROOT / RECEIPT)
        print(json.dumps(result, sort_keys=True), flush=True)
        return 0
    except (Error, getpass.GetPassWarning) as error:
        print(str(error) if isinstance(error, Error) else 'HIDDEN_TOKEN_PROMPT_UNAVAILABLE', file=sys.stderr)
    except (Exception, KeyboardInterrupt):
        print('TELEGRAM_SERIES_STOPPED_REVIEW_RECEIPT', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
