#!/usr/bin/env python3
"""Publish the approved FTI guide once, with a hidden token and durable receipt."""
import argparse
import fcntl
import getpass
import html
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request
import warnings

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('fti_video_base', ROOT/'tools/configure-telegram-channel.py')
base = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(base)
POST = ROOT/'marketing/video-20261024/telegram-post.en.json'
RECEIPT = ROOT/'marketing/telegram/live-user-video-20261024.json'


class Error(Exception):
    pass


def load_plan(video):
    post = json.loads(POST.read_text())
    text = post['text']
    if (post['version'] != 1 or post['language'] != 'en'
            or post['channel_id'] != base.CHANNEL_ID or post['bot_id'] != base.BOT_ID
            or not 1 <= len(text.encode('utf-16-le'))//2 <= 1024
            or len(re.findall(r'#[A-Za-z][A-Za-z0-9_]*', text)) != 6):
        raise Error('INVALID_VIDEO_PLAN')
    if (not video.is_file() or video.stat().st_size != post['video_bytes']
            or not 0 < post['video_bytes'] < 50_000_000
            or base.digest(video.read_bytes()) != post['video_sha256']):
        raise Error('APPROVED_VIDEO_HASH_OR_SIZE_MISMATCH')
    first, rest = text.split('\n', 1)
    params = {'chat_id': base.CHANNEL_ID, 'caption': '<b>'+html.escape(first)+'</b>\n'+html.escape(rest),
              'parse_mode': 'HTML', 'duration': post['duration'], 'width': post['width'],
              'height': post['height'], 'supports_streaming': True, 'reply_markup': base.BUTTONS,
              'thumbnail': 'attach://thumbnail', 'cover': 'attach://cover'}
    files = [('video', 'FTI_User_Presentation_EN.mp4', 'video/mp4', video)]
    for name in ('thumbnail', 'cover'):
        path = ROOT/f'marketing/video-20261024/frames/telegram-{name}.jpg'
        if not path.is_file() or path.read_bytes()[:2] != b'\xff\xd8':
            raise Error('VIDEO_PREVIEW_MISSING')
        if name == 'thumbnail' and path.stat().st_size >= 200_000:
            raise Error('THUMBNAIL_TOO_LARGE')
        files.append((name, name+'.jpg', 'image/jpeg', path))
    fingerprint = base.digest(json.dumps({'post': post, 'params': params,
        'files': {field: base.digest(path.read_bytes()) for field, _, _, path in files}},
        sort_keys=True).encode())
    return post, params, files, fingerprint


def send_video(api, params, files):
    boundary = 'FTIVideo'+os.urandom(16).hex()
    chunks = []
    for key, value in params.items():
        value = json.dumps(value) if isinstance(value, (dict, list, bool)) else str(value)
        chunks.append((f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n').encode())
    for field, filename, mime, path in files:
        chunks.extend([(f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{filename}"\r\nContent-Type: {mime}\r\n\r\n').encode(),
                       path.read_bytes(), b'\r\n'])
    chunks.append(f'--{boundary}--\r\n'.encode())
    request = urllib.request.Request('https://api.telegram.org/bot'+api._token+'/sendVideo',
        data=b''.join(chunks), headers={'Content-Type': 'multipart/form-data; boundary='+boundary}, method='POST')
    try:
        with api._opener.open(request, timeout=240) as response:
            status, raw = response.status, response.read(1_000_001)
    except urllib.error.HTTPError as error:
        status, raw = error.code, error.read(1_000_001)
    except Exception:
        raise Error('VIDEO_DELIVERY_UNKNOWN_NO_AUTOMATIC_RETRY') from None
    try:
        body = json.loads(raw)
        if status in {400,401,403,404,409,413,429} and body.get('ok') is False:
            raise base.Rejected('TELEGRAM_VIDEO_REJECTED')
        if status != 200 or len(raw) > 1_000_000 or body.get('ok') is not True or not isinstance(body.get('result'), dict):
            raise ValueError()
        return body['result']
    except base.Rejected:
        raise
    except Exception:
        raise Error('VIDEO_DELIVERY_UNKNOWN_NO_AUTOMATIC_RETRY') from None


def verify(message, post):
    video = message.get('video', {})
    if (type(message.get('message_id')) is not int or message['message_id'] <= 0
            or message.get('chat', {}).get('id') != base.CHANNEL_ID
            or message.get('caption') != post['text'] or message.get('reply_markup') != base.BUTTONS
            or (video.get('width'), video.get('height'), video.get('duration')) != (post['width'],post['height'],post['duration'])
            or ('file_size' in video and video['file_size'] != post['video_bytes'])
            or ('mime_type' in video and video['mime_type'] != 'video/mp4')
            or not isinstance(video.get('file_id'), str)
            or not re.fullmatch(r'[A-Za-z0-9_-]{1,1000}', video['file_id'])):
        raise Error('VIDEO_CONFIRMATION_MISMATCH_REVIEW_RECEIPT')
    entities = message.get('caption_entities', [])
    first = post['text'].split('\n', 1)[0]
    if not any(e.get('type') == 'bold' and e.get('offset') == 0 and e.get('length') == len(first.encode('utf-16-le'))//2 for e in entities):
        raise Error('VIDEO_CAPTION_FORMAT_MISMATCH_REVIEW_RECEIPT')
    for match in re.finditer(r'#[A-Za-z][A-Za-z0-9_]*', post['text']):
        offset = len(post['text'][:match.start()].encode('utf-16-le'))//2
        if not any(e.get('type') == 'hashtag' and e.get('offset') == offset and e.get('length') == len(match.group()) for e in entities):
            raise Error('VIDEO_HASHTAGS_MISMATCH_REVIEW_RECEIPT')
    return {'message_id': message['message_id'], 'video_file_id': video['file_id'],
            'video_file_unique_id': video.get('file_unique_id'), 'caption_verified': True,
            'buttons_verified': True, 'media_verified': True,
            'url': 'https://t.me/FTIProtocol_Official/'+str(message['message_id'])}


def publish(api, post, params, files, fingerprint):
    RECEIPT.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(RECEIPT)+'.lock', os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
        if RECEIPT.is_symlink():
            raise Error('INVALID_VIDEO_RECEIPT')
        if RECEIPT.exists():
            state = json.loads(RECEIPT.read_text())
            if (state.get('fingerprint') == fingerprint and state.get('status') == 'sent'
                    and state.get('caption_verified') is True and state.get('media_verified') is True
                    and state.get('buttons_verified') is True):
                return {'status': 'ALREADY_SENT', 'url': state['url']}
            raise Error('EXISTING_VIDEO_RECEIPT_REQUIRES_REVIEW_NO_RETRY')
        base.identity(api)
        state = {'schema_version': 1, 'channel_id': base.CHANNEL_ID, 'bot_id': base.BOT_ID,
                 'fingerprint': fingerprint, 'video_sha256': post['video_sha256'],
                 'caption_sha256': base.digest(post['text'].encode()),
                 'status': 'sending', 'intent_at': base.now()}
        base.save_receipt(RECEIPT, state)
        try:
            message = send_video(api, params, files)
            state.update(status='delivered_unverified', message_id=message.get('message_id'))
            base.save_receipt(RECEIPT, state)
            if message.get('message_id') == 0:
                state.update(status='processing', accepted_at=base.now())
                base.save_receipt(RECEIPT, state)
                return {'status': 'VIDEO_PROCESSING_NO_RESEND'}
            confirmed = verify(message, post)
        except base.Rejected:
            state.update(status='rejected', review_required=True)
            base.save_receipt(RECEIPT, state)
            raise Error('TELEGRAM_VIDEO_REJECTED_NO_RETRY') from None
        except Exception:
            state.update(status='unknown', review_required=True)
            base.save_receipt(RECEIPT, state)
            raise Error('VIDEO_DELIVERY_REQUIRES_REVIEW_NO_RETRY') from None
        state.update(status='sent', confirmed_at=base.now(), **confirmed)
        base.save_receipt(RECEIPT, state)
        return {'status': 'VIDEO_POST_CONFIRMED', **confirmed}


def recover(api, post, fingerprint):
    """Observe channel updates without acknowledging them or sending messages."""
    base.METHODS.update({'getWebhookInfo', 'getUpdates'})
    if api.call('getWebhookInfo', {}).get('url'):
        raise Error('WEBHOOK_ACTIVE_NO_UPDATE_POLL')
    updates = api.call('getUpdates', {'limit': 100, 'timeout': 0})
    matches = {}
    for update in updates:
        message = update.get('channel_post') or update.get('edited_channel_post') or {}
        if (message.get('chat', {}).get('id') == base.CHANNEL_ID
                and message.get('caption') == post['text'] and message.get('message_id', 0) > 0):
            matches[message['message_id']] = message
    if len(matches) != 1:
        return {'status': 'AWAITING_CHANNEL_CONFIRMATION', 'matching_updates': len(matches)}
    confirmed = verify(next(iter(matches.values())), post)
    fd = os.open(str(RECEIPT)+'.lock', os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
        if RECEIPT.is_symlink() or not RECEIPT.is_file():
            raise Error('VIDEO_RECEIPT_REQUIRED_FOR_RECOVERY')
        state = json.loads(RECEIPT.read_text())
        if state.get('fingerprint') != fingerprint:
            raise Error('VIDEO_RECEIPT_FINGERPRINT_MISMATCH')
        if state.get('status') == 'sent' and state.get('message_id') != confirmed['message_id']:
            raise Error('VIDEO_MESSAGE_ID_CONFLICT')
        state.pop('review_required', None)
        state.update(status='sent', confirmed_at=base.now(), confirmation_source='channel_post_update', **confirmed)
        base.save_receipt(RECEIPT, state)
    return {'status': 'VIDEO_POST_CONFIRMED', **confirmed}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video', type=Path, required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--recover', action='store_true', help='Read updates only; never resend')
    args = parser.parse_args()
    try:
        post, params, files, fingerprint = load_plan(args.video)
        if not args.apply and not args.recover:
            print(json.dumps({'status': 'PREVIEW', 'text': post['text'], 'parameters': params,
                              'fingerprint': fingerprint, 'bytes': post['video_bytes']}, ensure_ascii=False, indent=2))
            return 0
        if not sys.stdin.isatty():
            raise Error('INTERACTIVE_TTY_REQUIRED')
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            token = getpass.getpass('Telegram bot token (hidden): ')
        api = base.TelegramAPI(token)
        result = recover(api, post, fingerprint) if args.recover else publish(api, post, params, files, fingerprint)
        print(json.dumps(result, sort_keys=True), flush=True)
        return 0
    except (Error, base.SetupError) as error:
        print(str(error), file=sys.stderr)
    except (Exception, KeyboardInterrupt):
        print('VIDEO_PUBLISH_STOPPED_REVIEW_RECEIPT', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
