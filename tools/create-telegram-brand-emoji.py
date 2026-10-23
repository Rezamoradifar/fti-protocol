#!/usr/bin/env python3
"""Create the FTI emoji pack for the verified channel creator; no channel messages."""
import argparse
import fcntl
import getpass
import importlib.util
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request
import warnings

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('fti_emoji_base', ROOT / 'tools/configure-telegram-channel.py')
base = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(base)
NAME = 'FTIGlass20261024_by_FTIProtocol_OfficialBot'
FILES = ['01-core-emblem', '02-glass-check', '03-shield-emblem', '04-orbital-emblem',
         '05-network-emblem', '06-document-emblem']
EMOJI = ['🟢', '💎', '🛡️', '🔗', '🧭', '📖']
RECEIPT = ROOT / 'marketing/telegram/live-emoji-pack-20261024.json'


class Rejected(base.SetupError):
    pass


class API(base.TelegramAPI):
    def call(self, method, params, files=None):
        if method in {'getMe', 'getChat', 'getChatMember'}:
            return super().call(method, params)
        if method not in {'getChatAdministrators', 'getStickerSet', 'createNewStickerSet'}:
            raise base.SetupError('METHOD_NOT_ALLOWED')
        data, headers = json.dumps(params).encode(), {'Content-Type': 'application/json'}
        if files:
            boundary = 'FTI' + os.urandom(16).hex()
            chunks = []
            for key, value in params.items():
                value = json.dumps(value) if isinstance(value, (dict, list, bool)) else str(value)
                chunks.append((f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n').encode())
            for index, image in enumerate(files):
                chunks.extend([(f'--{boundary}\r\nContent-Disposition: form-data; name="emoji{index}"; '
                    f'filename="emoji{index}.png"\r\nContent-Type: image/png\r\n\r\n').encode(), image, b'\r\n'])
            chunks.append(f'--{boundary}--\r\n'.encode())
            data, headers = b''.join(chunks), {'Content-Type': 'multipart/form-data; boundary=' + boundary}
        request = urllib.request.Request('https://api.telegram.org/bot' + self._token + '/' + method,
                                         data=data, headers=headers, method='POST')
        try:
            with self._opener.open(request, timeout=45) as response:
                status, raw = response.status, response.read(1_000_001)
        except urllib.error.HTTPError as error:
            status, raw = error.code, error.read(1_000_001)
        except Exception:
            raise base.SetupError('TELEGRAM_RESPONSE_UNKNOWN') from None
        try:
            body = json.loads(raw)
            if status in {400, 401, 403, 404, 409, 429} and body.get('ok') is False:
                raise Rejected('TELEGRAM_EMOJI_REQUEST_REJECTED_' + str(status))
            if status != 200 or len(raw) > 1_000_000 or body.get('ok') is not True:
                raise ValueError()
            return body['result']
        except Rejected:
            raise
        except Exception:
            raise base.SetupError('TELEGRAM_RESPONSE_UNKNOWN') from None


def assets():
    images = [base.read_png(ROOT / 'marketing/telegram/emojis-20261024' / (name + '.png')) for name in FILES]
    if any(int.from_bytes(data[16:20], 'big') != 100 or int.from_bytes(data[20:24], 'big') != 100 for data in images):
        raise base.SetupError('EMOJI_100PX_REQUIRED')
    return images


def verify_pack(pack):
    if pack.get('name') != NAME or pack.get('sticker_type') != 'custom_emoji' or len(pack.get('stickers', [])) != 6:
        raise base.SetupError('PACK_CONFIRMATION_MISMATCH')
    result = []
    for sticker in pack['stickers']:
        ident = sticker.get('custom_emoji_id')
        if not isinstance(ident, str) or not ident.isdigit() or sticker.get('width') != 100 or sticker.get('height') != 100:
            raise base.SetupError('EMOJI_CONFIRMATION_MISMATCH')
        result.append(ident)
    return result


def apply(api, images):
    base.identity(api)
    if RECEIPT.exists():
        saved = json.loads(RECEIPT.read_text())
        if (saved.get('status') != 'created' or saved.get('name') != NAME
                or saved.get('asset_sha256') != [base.digest(v) for v in images]):
            raise base.SetupError('EMOJI_RECEIPT_REQUIRES_REVIEW')
        ids = verify_pack(api.call('getStickerSet', {'name': NAME}))
        if saved.get('custom_emoji_ids') and saved['custom_emoji_ids'] != ids:
            raise base.SetupError('PACK_IDS_CHANGED')
        saved.update(custom_emoji_ids=ids, url='https://t.me/addemoji/' + NAME, verified_at=base.now())
        base.save_receipt(RECEIPT, saved)
        return saved
    admins = api.call('getChatAdministrators', {'chat_id': base.CHANNEL_ID})
    owners = [a['user'] for a in admins if a.get('status') == 'creator' and a.get('user', {}).get('is_bot') is False]
    if len(owners) != 1 or type(owners[0].get('id')) is not int or owners[0]['id'] <= 0:
        raise base.SetupError('VERIFIED_CHANNEL_CREATOR_REQUIRED')
    state = {'name': NAME, 'status': 'creating', 'channel_id': base.CHANNEL_ID, 'bot_id': base.BOT_ID,
             'owner_verified_as_channel_creator': True, 'asset_sha256': [base.digest(v) for v in images],
             'intent_at': base.now(), 'inline_channel_emoji_enabled': False}
    base.save_receipt(RECEIPT, state)
    try:
        params = {'user_id': owners[0]['id'], 'name': NAME, 'title': 'FTI Protocol | Glass Emoji',
                  'sticker_type': 'custom_emoji', 'needs_repainting': False,
                  'stickers': [{'sticker': 'attach://emoji' + str(i), 'format': 'static',
                                'emoji_list': [EMOJI[i]]} for i in range(6)]}
        if api.call('createNewStickerSet', params, images) is not True:
            raise base.SetupError('PACK_CREATION_UNCONFIRMED')
        state.update(status='created', confirmed_at=base.now())
        base.save_receipt(RECEIPT, state)
        state['custom_emoji_ids'] = verify_pack(api.call('getStickerSet', {'name': NAME}))
        state['url'] = 'https://t.me/addemoji/' + NAME
        state['verified_at'] = base.now()
        base.save_receipt(RECEIPT, state)
    except Rejected as error:
        state.update(status='rejected', reason=str(error))
        base.save_receipt(RECEIPT, state)
        raise
    except Exception:
        if state['status'] != 'created':
            state['status'] = 'unknown'
        base.save_receipt(RECEIPT, state)
        raise base.SetupError('EMOJI_OUTCOME_REVIEW_RECEIPT') from None
    return state


if __name__ == '__main__':
    try:
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument('--apply', action='store_true')
        args = parser.parse_args()
        images = assets()
        if not args.apply:
            print(json.dumps({'status': 'PREVIEW', 'name': NAME, 'emoji_count': len(images)}))
        else:
            if not sys.stdin.isatty():
                raise base.SetupError('INTERACTIVE_TTY_REQUIRED')
            with warnings.catch_warnings():
                warnings.simplefilter('error', getpass.GetPassWarning)
                token = getpass.getpass('Telegram bot token (hidden): ')
            fd = os.open(str(RECEIPT) + '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'w') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                result = apply(API(token), images)
            print(json.dumps(result, sort_keys=True))
    except Exception as error:
        print(str(error) if isinstance(error, base.SetupError) else 'EMOJI_SETUP_STOPPED', file=sys.stderr)
        sys.exit(1)
