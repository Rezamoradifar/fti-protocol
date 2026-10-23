#!/usr/bin/env python3
"""Preview or apply the approved English launch. Tokens exist only in memory."""
import argparse
from contextlib import contextmanager
import datetime as dt
import fcntl
import getpass
import hashlib
import html
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
CHANNEL_ID, BOT_ID = -1003941034086, 8961425436
TITLE = 'FTI Protocol | Official'
DESCRIPTION = ('Official FTI Protocol announcements, platform updates and user guidance. '
               'Explore the platform and applications at https://ftiprotocol.com/')
POST_ASSETS = {'fti-launch-01': 'welcome.png', 'fti-launch-03': 'first-steps.png'}
BUTTONS = {'inline_keyboard': [
    [{'text': 'Launch App', 'url': 'https://ftiprotocol.com/app/', 'style': 'success'}],
    [{'text': 'Token Market', 'url': 'https://ftiprotocol.com/token/', 'style': 'primary'},
     {'text': 'Whitepaper', 'url': 'https://ftiprotocol.com/whitepaper/'}],
    [{'text': 'Website', 'url': 'https://ftiprotocol.com/'},
     {'text': 'Official Channel', 'url': 'https://t.me/FTIProtocol_Official'}]]}
METHODS = {'getMe', 'getChat', 'getChatMember', 'setMyName', 'setMyDescription',
           'setMyShortDescription', 'setChatTitle', 'setChatDescription', 'setChatPhoto',
           'sendPhoto', 'pinChatMessage'}


class SetupError(Exception):
    """Display only fixed identifiers; never Telegram responses or request URLs."""


class Rejected(SetupError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class TelegramAPI:
    def __init__(self, token):
        if (not isinstance(token, str) or not re.fullmatch(r'[0-9]{5,20}:[A-Za-z0-9_-]{20,200}', token)
                or int(token.split(':')[0]) != BOT_ID):
            raise SetupError('INVALID_BOT_TOKEN')
        self._token = token
        self._opener = urllib.request.build_opener(NoRedirect())

    def call(self, method, params, photo=None):
        if method not in METHODS or (photo is not None and method not in {'sendPhoto', 'setChatPhoto'}):
            raise SetupError('METHOD_NOT_ALLOWED')
        headers = {'Content-Type': 'application/json'}
        data = json.dumps(params).encode()
        if photo is not None:
            boundary = 'FTI' + os.urandom(16).hex()
            chunks = []
            for key, value in params.items():
                value = json.dumps(value) if isinstance(value, (dict, list, bool)) else str(value)
                chunks.append((f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"'
                               f'\r\n\r\n{value}\r\n').encode())
            chunks.extend([(f'--{boundary}\r\nContent-Disposition: form-data; name="photo"; '
                            'filename="image.png"\r\nContent-Type: image/png\r\n\r\n').encode(),
                           photo, f'\r\n--{boundary}--\r\n'.encode()])
            data = b''.join(chunks)
            headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary
        request = urllib.request.Request('https://api.telegram.org/bot' + self._token + '/' + method,
                                         data=data, headers=headers, method='POST')
        try:
            with self._opener.open(request, timeout=35) as response:
                status, raw = response.status, response.read(1_000_001)
        except urllib.error.HTTPError as error:
            status, raw = error.code, error.read(1_000_001)
        except Exception:
            raise SetupError('TELEGRAM_RESPONSE_UNKNOWN') from None
        try:
            if status >= 500 or len(raw) > 1_000_000:
                raise ValueError()
            body = json.loads(raw)
            unchanged = {'setChatTitle': 'Bad Request: chat title is not modified',
                         'setChatDescription': 'Bad Request: chat description is not modified'}
            if (status == 400 and body.get('ok') is False and body.get('error_code') == 400
                    and method in unchanged and body.get('description') == unchanged[method]):
                return True
            if status in {400, 401, 403, 404, 409, 429} and body.get('ok') is False:
                raise Rejected('TELEGRAM_REQUEST_REJECTED')
            if status != 200 or body.get('ok') is not True or 'result' not in body:
                raise ValueError()
            return body['result']
        except Rejected:
            raise
        except Exception:
            raise SetupError('TELEGRAM_RESPONSE_UNKNOWN') from None


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def load_plan(root=None):
    root = root or ROOT
    try:
        config = json.loads((root / 'config/telegram-launch-posts.en.json').read_text())
        if (config['version'] != 1 or config['language'] != 'en' or config['channel_id'] != CHANNEL_ID
                or config['suggested_channel_username'] != 'FTIProtocol_Official'
                or config['bot_username'] != 'FTIProtocol_OfficialBot'):
            raise ValueError()
        sources = config['posts']
        ids = [p['id'] for p in sources]
        if len(ids) != len(set(ids)) or any(not re.fullmatch(r'fti-launch-(0[1-9]|10)', i) for i in ids):
            raise ValueError()
        assets = root / 'marketing/telegram/assets'
        result = []
        for ident, filename in POST_ASSETS.items():
            source = next(p for p in sources if p['id'] == ident)
            text = source['text']
            first, rest = text.split('\n', 1)
            caption = '<b>' + html.escape(first) + '</b>\n' + html.escape(rest)
            if (first != source['title'] or not text.isascii() or not 1 <= len(caption.encode('utf-16-le')) // 2 <= 900
                    or len(re.findall(r'#[A-Za-z][A-Za-z0-9_]*', text)) != 3):
                raise ValueError()
            image = read_png(assets / filename)
            result.append({'id': ident, 'caption': caption, 'caption_sha256': digest(caption.encode()),
                           'asset_sha256': digest(image), 'photo': image})
        return {'posts': result, 'profile': read_png(assets / 'profile.png')}
    except Exception:
        raise SetupError('INVALID_LAUNCH_CONFIG_OR_PNG') from None


def read_png(path):
    if not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError()
    data = path.read_bytes()
    if not 24 <= len(data) <= 10_000_000 or data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
        raise ValueError()
    return data


@contextmanager
def locked_receipt(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(path) + '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SetupError('CHANNEL_SETUP_BUSY') from None
        if path.is_symlink() or (path.exists() and not stat.S_ISREG(path.lstat().st_mode)):
            raise SetupError('INVALID_RECEIPT')
        if path.exists():
            try:
                state = json.loads(path.read_text())
                if (state['schema_version'] != 1 or type(state['channel_id']) is not int
                        or state['channel_id'] != CHANNEL_ID or type(state['bot_id']) is not int
                        or state['bot_id'] != BOT_ID or not isinstance(state['posts'], dict)
                        or set(state['posts']) - set(POST_ASSETS)):
                    raise ValueError()
            except Exception:
                raise SetupError('INVALID_RECEIPT') from None
        else:
            state = {'schema_version': 1, 'channel_id': CHANNEL_ID, 'bot_id': BOT_ID, 'posts': {}}
        yield state


def save_receipt(path, state):
    state['updated_at'] = now()
    temporary = path.with_name(path.name + '.' + os.urandom(8).hex() + '.tmp')
    fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(state, stream, indent=2, sort_keys=True)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def identity(api):
    me = api.call('getMe', {})
    chat = api.call('getChat', {'chat_id': CHANNEL_ID})
    if (type(me.get('id')) is not int or me['id'] != BOT_ID or me.get('is_bot') is not True
            or me.get('username') != 'FTIProtocol_OfficialBot'):
        raise SetupError('BOT_IDENTITY_MISMATCH')
    if (type(chat.get('id')) is not int or chat['id'] != CHANNEL_ID or chat.get('type') != 'channel'
            or chat.get('username') != 'FTIProtocol_Official'):
        raise SetupError('CHANNEL_IDENTITY_MISMATCH')
    member = api.call('getChatMember', {'chat_id': CHANNEL_ID, 'user_id': BOT_ID})
    if (type(member.get('user', {}).get('id')) is not int or member['user']['id'] != BOT_ID
            or member.get('status') != 'administrator'
            or any(member.get(right) is not True for right in
                   ['can_post_messages', 'can_change_info', 'can_edit_messages'])):
        raise SetupError('BOT_ADMIN_PERMISSIONS_REQUIRED')


def message_id(value):
    if type(value) is not int or value <= 0:
        raise SetupError('INVALID_MESSAGE_RECEIPT')
    return value


def apply(api, plan, path, bot_profile=False):
    with locked_receipt(path) as state:
        identity(api)
        for post in plan['posts']:
            record = state['posts'].get(post['id'])
            if record:
                if record.get('status') == 'sending':
                    record['status'] = 'unknown'
                    save_receipt(path, state)
                if (record.get('status') != 'sent' or record.get('caption_sha256') != post['caption_sha256']
                        or record.get('asset_sha256') != post['asset_sha256']):
                    raise SetupError('POST_REQUIRES_MANUAL_REVIEW')
                message_id(record.get('message_id'))
        save_receipt(path, state)
        for method, params, photo in [
                ('setChatTitle', {'chat_id': CHANNEL_ID, 'title': TITLE}, None),
                ('setChatDescription', {'chat_id': CHANNEL_ID, 'description': DESCRIPTION}, None),
                ('setChatPhoto', {'chat_id': CHANNEL_ID}, plan['profile'])]:
            if api.call(method, params, photo) is not True:
                raise SetupError('CHANNEL_UPDATE_UNVERIFIED')
        if bot_profile:
            for method, params in [('setMyName', {'name': 'FTI Protocol | Official Bot'}),
                    ('setMyDescription', {'description': 'Official publishing bot for FTI Protocol announcements and platform guidance.'}),
                    ('setMyShortDescription', {'short_description': 'Official FTI Protocol publishing bot. https://ftiprotocol.com/'})]:
                if api.call(method, params) is not True:
                    raise SetupError('BOT_UPDATE_UNVERIFIED')
        state['actions'] = {'channel_title': TITLE, 'channel_description': DESCRIPTION,
                            'profile_sha256': digest(plan['profile']), 'applied_at': now()}
        save_receipt(path, state)
        for post in plan['posts']:
            if post['id'] not in state['posts']:
                record = {key: post[key] for key in ['caption_sha256', 'asset_sha256']}
                record.update(status='sending', intent_at=now())
                state['posts'][post['id']] = record
                save_receipt(path, state)  # Durable intent always precedes a send; never retry it.
                try:
                    sent = api.call('sendPhoto', {'chat_id': CHANNEL_ID, 'caption': post['caption'],
                                    'parse_mode': 'HTML', 'reply_markup': BUTTONS}, post['photo'])
                    mid = message_id(sent.get('message_id'))
                    photos = sent.get('photo')
                    if (type(sent.get('chat', {}).get('id')) is not int or sent['chat']['id'] != CHANNEL_ID
                            or not isinstance(photos, list) or not photos
                            or any(not isinstance(p.get('file_id'), str)
                                   or not re.fullmatch(r'[A-Za-z0-9_-]{1,1000}', p['file_id']) for p in photos)):
                        raise SetupError('INVALID_MESSAGE_RECEIPT')
                    record.update(status='sent', message_id=mid, photo_file_ids=[p['file_id'] for p in photos], sent_at=now())
                except Exception:
                    record.update(status='unknown', review_required=True)
                    save_receipt(path, state)
                    raise SetupError('POST_DELIVERY_REQUIRES_MANUAL_REVIEW') from None
                save_receipt(path, state)
            if post['id'] == 'fti-launch-01':
                mid = message_id(state['posts'][post['id']]['message_id'])
                if api.call('pinChatMessage', {'chat_id': CHANNEL_ID, 'message_id': mid,
                                             'disable_notification': True}) is not True:
                    raise SetupError('PIN_UNVERIFIED')
        chat = api.call('getChat', {'chat_id': CHANNEL_ID})
        pinned = state['posts']['fti-launch-01']['message_id']
        if (type(chat.get('id')) is not int or chat['id'] != CHANNEL_ID or chat.get('title') != TITLE
                or chat.get('description') != DESCRIPTION
                or type(chat.get('pinned_message', {}).get('message_id')) is not int
                or chat['pinned_message']['message_id'] != pinned):
            raise SetupError('FINAL_CHANNEL_VERIFICATION_FAILED')
        state['verified_at'] = now()
        save_receipt(path, state)
        return {'status': 'VERIFIED', 'channel_id': CHANNEL_ID,
                'message_ids': {key: value['message_id'] for key, value in state['posts'].items()}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--preview', action='store_true', help='Validate and print the plan (default; no API calls).')
    mode.add_argument('--apply', action='store_true', help='Apply using a hidden interactive token prompt.')
    parser.add_argument('--bot-profile', action='store_true', help='Also update the bot display name and descriptions.')
    args = parser.parse_args(argv)
    try:
        plan = load_plan()
        if not args.apply:
            print(json.dumps({'status': 'PREVIEW', 'channel_id': CHANNEL_ID, 'bot_id': BOT_ID,
                              'title': TITLE, 'description': DESCRIPTION, 'posts': [
                                  {k: p[k] for k in ['id', 'caption', 'caption_sha256', 'asset_sha256']}
                                  for p in plan['posts']], 'buttons': BUTTONS}, indent=2))
            return 0
        if not sys.stdin.isatty():
            raise SetupError('INTERACTIVE_TTY_REQUIRED')
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            token = getpass.getpass('Telegram bot token (hidden): ')
        result = apply(TelegramAPI(token), plan, ROOT / 'marketing/telegram/live-channel-setup.json', args.bot_profile)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (SetupError, getpass.GetPassWarning) as error:
        print(str(error) if isinstance(error, SetupError) else 'HIDDEN_TOKEN_PROMPT_UNAVAILABLE', file=sys.stderr)
    except (Exception, KeyboardInterrupt):
        print('CHANNEL_SETUP_STOPPED_REVIEW_RECEIPT', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
