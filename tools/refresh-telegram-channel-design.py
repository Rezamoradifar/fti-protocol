#!/usr/bin/env python3
"""Preview or refresh the two existing official channel posts; never send new posts."""
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
import urllib.error
import urllib.request
import warnings

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('fti_channel_setup', ROOT / 'tools/configure-telegram-channel.py')
base = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(base)
Error, CHANNEL_ID, BOT_ID = base.SetupError, base.CHANNEL_ID, base.BOT_ID
BUTTONS = {'inline_keyboard': [
    [{'text': 'Launch App', 'url': 'https://ftiprotocol.com/app/', 'style': 'success'}],
    [{'text': 'Token Market', 'url': 'https://ftiprotocol.com/token/', 'style': 'primary'},
     {'text': 'Whitepaper', 'url': 'https://ftiprotocol.com/whitepaper/'}],
    [{'text': 'Website', 'url': 'https://ftiprotocol.com/'},
     {'text': 'Official Channel', 'url': 'https://t.me/FTIProtocol_Official'}]]}
TARGETS = [('fti-launch-01', 4, 'animation', 'welcome-glass.mp4'),
           ('fti-launch-03', 6, 'photo', 'first-steps-glass.png')]


def fingerprint(value):
    return base.digest(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())


class TelegramAPI(base.TelegramAPI):
    def call(self, method, params, attachment=None):
        if method in {'getMe', 'getChat', 'getChatMember', 'setChatPhoto', 'pinChatMessage'}:
            if attachment is not None and method != 'setChatPhoto':
                raise Error('ATTACHMENT_NOT_ALLOWED')
            return super().call(method, params, attachment)
        if method != 'editMessageMedia' or not isinstance(attachment, bytes):
            raise Error('METHOD_NOT_ALLOWED')
        kind = params.get('media', {}).get('type')
        if (type(params.get('chat_id')) is not int or params['chat_id'] != CHANNEL_ID
                or type(params.get('message_id')) is not int
                or (params['message_id'], kind) not in {(4, 'animation'), (6, 'photo')}
                or params['media'].get('media') != 'attach://asset'):
            raise Error('INVALID_MEDIA_UPLOAD')
        boundary = 'FTI' + os.urandom(16).hex()
        chunks = []
        for key, value in params.items():
            value = json.dumps(value) if isinstance(value, (dict, list, bool)) else str(value)
            chunks.append((f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"'
                           f'\r\n\r\n{value}\r\n').encode())
        filename, mime = ('animation.mp4', 'video/mp4') if kind == 'animation' else ('image.png', 'image/png')
        chunks.extend([(f'--{boundary}\r\nContent-Disposition: form-data; name="asset"; '
                        f'filename="{filename}"\r\nContent-Type: {mime}\r\n\r\n').encode(),
                       attachment, f'\r\n--{boundary}--\r\n'.encode()])
        request = urllib.request.Request('https://api.telegram.org/bot' + self._token + '/editMessageMedia',
            data=b''.join(chunks), headers={'Content-Type': 'multipart/form-data; boundary=' + boundary}, method='POST')
        try:
            with self._opener.open(request, timeout=60) as response:
                status, raw = response.status, response.read(1_000_001)
        except urllib.error.HTTPError as error:
            try:
                status, raw = error.code, error.read(1_000_001)
            except Exception:
                raise Error('TELEGRAM_RESPONSE_UNKNOWN') from None
        except Exception:
            raise Error('TELEGRAM_RESPONSE_UNKNOWN') from None
        try:
            if status >= 500 or len(raw) > 1_000_000:
                raise ValueError()
            body = json.loads(raw)
            if status in {400, 401, 403, 404, 409, 429} and body.get('ok') is False:
                raise base.Rejected('TELEGRAM_REQUEST_REJECTED')
            if status != 200 or body.get('ok') is not True or not isinstance(body.get('result'), dict):
                raise ValueError()
            return body['result']
        except base.Rejected:
            raise
        except Exception:
            raise Error('TELEGRAM_RESPONSE_UNKNOWN') from None


def read_asset(path, kind):
    if kind == 'photo':
        return base.read_png(path)
    if not stat.S_ISREG(path.lstat().st_mode) or not 24 <= path.stat().st_size <= 50_000_000:
        raise ValueError()
    data = path.read_bytes()
    if data[4:8] != b'ftyp':
        raise ValueError()
    return data


def load_plan(root=None):
    root = root or ROOT
    try:
        config = json.loads((root / 'config/telegram-launch-posts.en.json').read_text())
        original = json.loads((root / 'marketing/telegram/live-channel-setup.json').read_text())
        if (config['version'] != 1 or config['language'] != 'en'
                or type(config['channel_id']) is not int or config['channel_id'] != CHANNEL_ID
                or config['bot_username'] != 'FTIProtocol_OfficialBot'
                or config['suggested_channel_username'] != 'FTIProtocol_Official'
                or type(original['channel_id']) is not int or original['channel_id'] != CHANNEL_ID
                or type(original['bot_id']) is not int or original['bot_id'] != BOT_ID):
            raise ValueError()
        posts = config['posts']
        if (len({p['id'] for p in posts}) != len(posts)
                or any(not re.fullmatch(r'fti-launch-(0[1-9]|10)', p['id']) for p in posts)):
            raise ValueError()
        assets = root / 'marketing/telegram/assets'
        profile = read_asset(assets / 'site-logo-profile.png', 'photo')
        steps = [{'id': 'profile', 'method': 'setChatPhoto', 'params': {'chat_id': CHANNEL_ID},
                  'asset_sha256': base.digest(profile), 'attachment': profile}]
        for ident, mid, kind, filename in TARGETS:
            source = next(p for p in posts if p['id'] == ident)
            text = source['text']
            first, rest = text.split('\n', 1)
            caption = '<b>' + html.escape(first) + '</b>\n' + html.escape(rest)
            old = original['posts'][ident]
            if (old['status'] != 'sent' or type(old['message_id']) is not int or old['message_id'] != mid
                    or old['caption_sha256'] != base.digest(caption.encode()) or first != source['title']
                    or not text.isascii() or len(caption.encode('utf-16-le')) // 2 > 900):
                raise ValueError()
            asset = read_asset(assets / filename, kind)
            params = {'chat_id': CHANNEL_ID, 'message_id': mid, 'reply_markup': BUTTONS,
                      'media': {'type': kind, 'media': 'attach://asset', 'caption': caption, 'parse_mode': 'HTML'}}
            steps.append({'id': 'message-' + str(mid), 'post_id': ident, 'method': 'editMessageMedia',
                          'params': params, 'text': text, 'heading_length': len(first.encode('utf-16-le')) // 2,
                          'caption_sha256': base.digest(caption.encode()), 'asset_sha256': base.digest(asset),
                          'attachment': asset})
        for step in steps:
            step['fingerprint'] = fingerprint({k: v for k, v in step.items() if k != 'attachment'})
        return {'steps': steps, 'fingerprint': fingerprint([s['fingerprint'] for s in steps])}
    except Exception:
        raise Error('INVALID_OR_MISSING_REFRESH_ASSETS_OR_CANONICAL_RECEIPT') from None


@contextmanager
def locked_state(path, plan):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(path) + '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Error('CHANNEL_REFRESH_BUSY') from None
        try:
            if path.is_symlink() or (path.exists() and not stat.S_ISREG(path.lstat().st_mode)):
                raise ValueError()
            if path.exists():
                state = json.loads(path.read_text())
                if (state['schema_version'] != 1 or state['workflow'] != 'glass-design-v1'
                        or type(state['channel_id']) is not int or state['channel_id'] != CHANNEL_ID
                        or type(state['bot_id']) is not int or state['bot_id'] != BOT_ID
                        or state['plan_sha256'] != plan['fingerprint'] or not isinstance(state['steps'], dict)
                        or set(state['steps']) - {s['id'] for s in plan['steps']} - {'pin-4'}):
                    raise ValueError()
            else:
                state = {'schema_version': 1, 'workflow': 'glass-design-v1', 'channel_id': CHANNEL_ID,
                         'bot_id': BOT_ID, 'plan_sha256': plan['fingerprint'], 'steps': {}}
        except Exception:
            raise Error('CONFLICTING_REFRESH_RECEIPT') from None
        yield state


def safe_file_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,1000}', value):
        raise Error('INVALID_MEDIA_CONFIRMATION')
    return value


def verify_message(message, step):
    params = step['params']
    if (not isinstance(message, dict) or type(message.get('message_id')) is not int
            or message['message_id'] != params['message_id']
            or type(message.get('chat', {}).get('id')) is not int or message['chat']['id'] != CHANNEL_ID
            or message.get('caption') != step['text'] or message.get('reply_markup') != BUTTONS
            or not any(e.get('type') == 'bold' and e.get('offset') == 0 and e.get('length') == step['heading_length']
                       for e in message.get('caption_entities', []))):
        raise Error('EDIT_CONFIRMATION_MISMATCH')
    kind = params['media']['type']
    files = message.get('photo') if kind == 'photo' else [message.get('animation')]
    if not isinstance(files, list) or not files or any(not isinstance(f, dict) for f in files):
        raise Error('INVALID_MEDIA_CONFIRMATION')
    return {'message_id': message['message_id'], 'media_type': kind,
            'file_ids': [safe_file_id(f.get('file_id')) for f in files],
            'caption_verified': True, 'buttons_verified': True}


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
            or member.get('status') != 'administrator' or member.get('can_change_info') is not True
            or member.get('can_edit_messages') is not True):
        raise Error('BOT_ADMIN_PERMISSIONS_REQUIRED')


def apply(api, plan, path):
    with locked_state(path, plan) as state:
        identity(api)
        for step in plan['steps']:
            if step['id'] in state['steps']:
                record = state['steps'][step['id']]
                if not isinstance(record, dict):
                    raise Error('CONFLICTING_REFRESH_RECEIPT')
                if record.get('status') == 'sending':
                    record['status'] = 'unknown'
                    base.save_receipt(path, state)
                if record.get('status') != 'success' or record.get('fingerprint') != step['fingerprint']:
                    raise Error('REFRESH_REQUIRES_MANUAL_REVIEW')
                if step['method'] == 'setChatPhoto':
                    if record.get('api_confirmed') is not True:
                        raise Error('CONFLICTING_REFRESH_RECEIPT')
                elif (type(record.get('message_id')) is not int or record['message_id'] != step['params']['message_id']
                        or record.get('media_type') != step['params']['media']['type']
                        or record.get('caption_verified') is not True or record.get('buttons_verified') is not True
                        or not isinstance(record.get('file_ids'), list) or not record['file_ids']
                        or any(safe_file_id(v) != v for v in record['file_ids'])):
                    raise Error('CONFLICTING_REFRESH_RECEIPT')
        if 'pin-4' in state['steps']:
            pin = state['steps']['pin-4']
            if not isinstance(pin, dict):
                raise Error('CONFLICTING_REFRESH_RECEIPT')
            if pin.get('status') in {'sending', 'unknown'}:
                pin['status'] = 'unknown'
                base.save_receipt(path, state)
                raise Error('REFRESH_REQUIRES_MANUAL_REVIEW')
            if pin.get('status') != 'success' or type(pin.get('message_id')) is not int or pin['message_id'] != 4:
                raise Error('CONFLICTING_REFRESH_RECEIPT')
        for step in plan['steps']:
            if step['id'] in state['steps']:
                continue
            record = {'status': 'sending', 'fingerprint': step['fingerprint'],
                      'asset_sha256': step['asset_sha256'], 'intent_at': base.now()}
            if 'caption_sha256' in step:
                record['caption_sha256'] = step['caption_sha256']
            state['steps'][step['id']] = record
            base.save_receipt(path, state)
            try:
                result = api.call(step['method'], step['params'], step['attachment'])
                if step['method'] == 'setChatPhoto':
                    if result is not True:
                        raise Error('PROFILE_UPDATE_UNCONFIRMED')
                    confirmation = {'api_confirmed': True}
                else:
                    confirmation = verify_message(result, step)
                record.update(status='success', confirmed_at=base.now(), **confirmation)
            except Exception:
                record.update(status='unknown', review_required=True)
                base.save_receipt(path, state)
                raise Error('REFRESH_OUTCOME_UNKNOWN_REVIEW_RECEIPT') from None
            base.save_receipt(path, state)
        chat = api.call('getChat', {'chat_id': CHANNEL_ID})
        if chat.get('pinned_message', {}).get('message_id') != 4:
            if 'pin-4' in state['steps']:
                raise Error('PIN_STATE_CHANGED_REQUIRES_MANUAL_REVIEW')
            record = {'status': 'sending', 'message_id': 4, 'intent_at': base.now()}
            state['steps']['pin-4'] = record
            base.save_receipt(path, state)
            try:
                if api.call('pinChatMessage', {'chat_id': CHANNEL_ID, 'message_id': 4,
                                             'disable_notification': True}) is not True:
                    raise Error('PIN_UNCONFIRMED')
                record.update(status='success', confirmed_at=base.now())
            except Exception:
                record.update(status='unknown', review_required=True)
                base.save_receipt(path, state)
                raise Error('REFRESH_OUTCOME_UNKNOWN_REVIEW_RECEIPT') from None
            base.save_receipt(path, state)
            chat = api.call('getChat', {'chat_id': CHANNEL_ID})
        if (type(chat.get('id')) is not int or chat['id'] != CHANNEL_ID or chat.get('type') != 'channel'
                or chat.get('username') != 'FTIProtocol_Official'):
            raise Error('FINAL_CHANNEL_IDENTITY_MISMATCH')
        welcome = verify_message(chat.get('pinned_message'), plan['steps'][1])
        if welcome['file_ids'] != state['steps']['message-4']['file_ids']:
            raise Error('PINNED_MEDIA_CONFIRMATION_MISMATCH')
        state.update(verified_at=base.now(), pinned_message_id=4)
        base.save_receipt(path, state)
        return {'status': 'VERIFIED', 'channel_id': CHANNEL_ID, 'pinned_message_id': 4,
                'profile_api_confirmed': state['steps']['profile']['api_confirmed'],
                'messages': {str(mid): state['steps']['message-' + str(mid)] for mid in [4, 6]}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--preview', action='store_true', help='Validate and show the plan (default; no API calls).')
    mode.add_argument('--apply', action='store_true', help='Apply with a hidden interactive token prompt.')
    args = parser.parse_args(argv)
    try:
        plan = load_plan()
        if not args.apply:
            print(json.dumps({'status': 'PREVIEW', 'channel_id': CHANNEL_ID, 'bot_id': BOT_ID,
                'plan_sha256': plan['fingerprint'], 'steps': [
                    {k: v for k, v in step.items() if k != 'attachment'} for step in plan['steps']]}, indent=2))
            return 0
        if not sys.stdin.isatty():
            raise Error('INTERACTIVE_TTY_REQUIRED')
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            token = getpass.getpass('Telegram bot token (hidden): ')
        result = apply(TelegramAPI(token), plan, ROOT / 'marketing/telegram/live-channel-glass-edit.json')
        print(json.dumps(result, sort_keys=True))
        return 0
    except (Error, getpass.GetPassWarning) as error:
        print(str(error) if isinstance(error, Error) else 'HIDDEN_TOKEN_PROMPT_UNAVAILABLE', file=sys.stderr)
    except (Exception, KeyboardInterrupt):
        print('CHANNEL_REFRESH_STOPPED_REVIEW_RECEIPT', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
