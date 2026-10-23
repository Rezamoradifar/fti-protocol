#!/usr/bin/env python3
"""Try native FTI emoji on existing series captions; never create another post."""
import argparse
import fcntl
import getpass
import html
import importlib.util
import json
import os
from pathlib import Path
import sys
import warnings

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('fti_caption_base', ROOT / 'tools/configure-telegram-channel.py')
base = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(base)
base.METHODS.add('editMessageCaption')
MAP = {'🟢': 0, '💎': 1, '◈': 1, '🛡️': 2, '🔗': 3, '🧭': 4, '📖': 5}
FALLBACK = ['🟢', '💎', '🛡️', '🔗', '🧭', '📖']
RECEIPT = ROOT / 'marketing/telegram/live-series-emoji-20261024.json'


def verify_edit(result, post):
    prefix, heading = post['text'].split('\n', 1)[0].split(' ', 1)
    size = lambda value: len(value.encode('utf-16-le')) // 2
    def entity(kind, offset, length):
        return [e for e in result.get('caption_entities', []) if isinstance(e, dict)
                and e.get('type') == kind and type(e.get('offset')) is int and e['offset'] == offset
                and type(e.get('length')) is int and e['length'] == length]
    return (type(result.get('message_id')) is int and result['message_id'] == post['message_id']
            and type(result.get('chat', {}).get('id')) is int and result['chat']['id'] == base.CHANNEL_ID
            and result.get('caption') == post['text'] and result.get('reply_markup') == base.BUTTONS
            and bool(entity('bold', size(prefix) + 1, size(heading)))
            and any(e.get('custom_emoji_id') == post['emoji_id'] for e in entity('custom_emoji', 0, size(prefix))))


def plan():
    config = json.loads((ROOT / 'config/telegram-series-20261024.en.json').read_text())
    sent = json.loads((ROOT / 'marketing/telegram/live-series-20261024.json').read_text())
    pack = json.loads((ROOT / 'marketing/telegram/live-emoji-pack-20261024.json').read_text())
    if (sent.get('channel_id') != base.CHANNEL_ID or sent.get('bot_id') != base.BOT_ID
            or not sent.get('verified_at') or len(sent.get('posts', {})) != 20 or pack.get('status') != 'created'
            or len(pack.get('custom_emoji_ids', [])) != 6):
        raise base.SetupError('VERIFIED_SERIES_AND_PACK_REQUIRED')
    result = []
    for post in config['posts']:
        record = sent['posts'][post['id']]
        if record.get('status') != 'sent' or type(record.get('message_id')) is not int:
            raise base.SetupError('SERIES_SEND_CONFIRMATION_REQUIRED')
        i = MAP[post['emoji']]
        eid, emoji = pack['custom_emoji_ids'][i], FALLBACK[i]
        if not isinstance(eid, str) or not eid.isdigit():
            raise base.SetupError('INVALID_CUSTOM_EMOJI_ID')
        title, rest = post['text'].split('\n', 1)
        caption = f'<tg-emoji emoji-id="{eid}">{emoji}</tg-emoji> <b>{html.escape(title)}</b>\n' + html.escape(rest)
        result.append({'id': post['id'], 'message_id': record['message_id'], 'emoji_id': eid,
                       'caption': caption, 'text': emoji + ' ' + post['text'],
                       'caption_sha256': base.digest(caption.encode())})
    if len(result) != 20 or len({p['message_id'] for p in result}) != 20:
        raise base.SetupError('EXACT_SERIES_REQUIRED')
    return result


def apply(api, posts):
    base.identity(api)
    digest = base.digest(json.dumps(posts, sort_keys=True).encode())
    if RECEIPT.exists():
        state = json.loads(RECEIPT.read_text())
        if state.get('plan_sha256') != digest or state.get('status') not in {'editing', 'verified'}:
            raise base.SetupError('EMOJI_EDITS_REQUIRE_REVIEW')
    else:
        state = {'channel_id': base.CHANNEL_ID, 'bot_id': base.BOT_ID,
                 'plan_sha256': digest, 'status': 'editing', 'posts': {}}
    for post in posts:
        old = state['posts'].get(post['id'])
        if old:
            if old.get('status') != 'edited' or old.get('caption_sha256') != post['caption_sha256']:
                raise base.SetupError('EMOJI_EDITS_REQUIRE_REVIEW')
            continue
        record = {'status': 'editing', 'message_id': post['message_id'],
                  'caption_sha256': post['caption_sha256'], 'intent_at': base.now()}
        state['posts'][post['id']] = record
        base.save_receipt(RECEIPT, state)
        try:
            result = api.call('editMessageCaption', {'chat_id': base.CHANNEL_ID,
                'message_id': post['message_id'], 'caption': post['caption'], 'parse_mode': 'HTML',
                'reply_markup': base.BUTTONS})
            if not verify_edit(result, post):
                raise base.SetupError('NATIVE_EMOJI_CONFIRMATION_MISMATCH')
        except base.Rejected:
            record.update(status='rejected', confirmed_rejection_at=base.now())
            state['status'] = 'api_rejected'
            base.save_receipt(RECEIPT, state)
            return {'status': 'NATIVE_CHANNEL_EMOJI_API_REJECTED', 'edited_count': sum(
                    v.get('status') == 'edited' for v in state['posts'].values())}
        except Exception:
            record['status'], state['status'] = 'unknown', 'review_required'
            base.save_receipt(RECEIPT, state)
            raise base.SetupError('EMOJI_EDIT_OUTCOME_REVIEW_RECEIPT') from None
        record.update(status='edited', custom_emoji_id=post['emoji_id'], verified_at=base.now())
        base.save_receipt(RECEIPT, state)
    state.update(status='verified', verified_at=base.now())
    base.save_receipt(RECEIPT, state)
    return {'status': 'NATIVE_CHANNEL_EMOJI_VERIFIED', 'edited_count': len(posts)}


if __name__ == '__main__':
    try:
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument('--apply', action='store_true')
        args = parser.parse_args()
        posts = plan()
        if not args.apply:
            print(json.dumps({'status': 'PREVIEW', 'posts': len(posts)}))
        else:
            if not sys.stdin.isatty():
                raise base.SetupError('INTERACTIVE_TTY_REQUIRED')
            with warnings.catch_warnings():
                warnings.simplefilter('error', getpass.GetPassWarning)
                token = getpass.getpass('Telegram bot token (hidden): ')
            fd = os.open(str(RECEIPT) + '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'w') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                print(json.dumps(apply(base.TelegramAPI(token), posts)))
    except Exception as error:
        print(str(error) if isinstance(error, base.SetupError) else 'EMOJI_CAPTION_UPDATE_STOPPED', file=sys.stderr)
        sys.exit(1)
