#!/usr/bin/env python3
"""Publish a finite approved queue; no content generation or wallet access."""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

UTC = dt.timezone.utc
TEHRAN = ZoneInfo('Asia/Tehran')
GRACE_SECONDS = 7200


class PublisherError(Exception):
    """Only fixed, non-secret error identifiers may be displayed."""


class APIRejected(PublisherError):
    def __init__(self, code, retry_after=0):
        super().__init__('TELEGRAM_REJECTED')
        self.code, self.retry_after = code, retry_after


class DeliveryUnknown(PublisherError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class TelegramAPI:
    def __init__(self, token):
        if not isinstance(token, str) or not re.fullmatch(r'[0-9]{5,20}:[A-Za-z0-9_-]{20,200}', token):
            raise PublisherError('INVALID_BOT_TOKEN')
        self._token = token
        self._opener = urllib.request.build_opener(NoRedirect())

    def call(self, method, params):
        if method not in {'getMe', 'getChat', 'getChatMember', 'sendMessage'}:
            raise PublisherError('METHOD_NOT_ALLOWED')
        request = urllib.request.Request(
            'https://api.telegram.org/bot' + self._token + '/' + method,
            data=json.dumps(params).encode(), headers={'Content-Type': 'application/json'}, method='POST')
        status = 200
        try:
            with self._opener.open(request, timeout=25) as response:
                status, raw = response.status, response.read(1_000_001)
        except urllib.error.HTTPError as error:
            status = error.code
            raw = error.read(1_000_001)
        except Exception:
            raise DeliveryUnknown('TELEGRAM_RESPONSE_UNKNOWN') from None
        if status >= 500 or len(raw) > 1_000_000:
            raise DeliveryUnknown('TELEGRAM_RESPONSE_UNKNOWN')
        try:
            body = json.loads(raw)
            if body.get('ok') is False and isinstance(body.get('error_code'), int):
                retry = body.get('parameters', {}).get('retry_after', 0)
                raise APIRejected(body['error_code'], retry if type(retry) is int and retry >= 0 else 0)
            if status != 200 or body.get('ok') is not True or 'result' not in body:
                raise ValueError()
            return body['result']
        except APIRejected:
            raise
        except Exception:
            raise DeliveryUnknown('TELEGRAM_RESPONSE_UNKNOWN') from None


def private_file(path):
    path = Path(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid not in {0, os.geteuid()} or info.st_mode & 0o077:
        raise PublisherError('PRIVATE_CONFIG_REQUIRED')
    return path


def load_config(path):
    try:
        config = json.loads(private_file(path).read_text())
        token = config['bot_token']
        bot, channel, actual = config['expected_bot_id'], config['expected_channel_id'], config['channel_id']
        if (type(bot) is not int or bot <= 0 or type(channel) is not int or channel >= 0
                or type(actual) is not int or actual != channel):
            raise ValueError()
        TelegramAPI(token)
        if int(token.split(':')[0]) != bot:
            raise ValueError()
        return config
    except PublisherError:
        raise
    except Exception:
        raise PublisherError('INVALID_PRIVATE_CONFIG') from None


def validate_identity(config, api=None):
    api = api or TelegramAPI(config['bot_token'])
    me = api.call('getMe', {})
    chat = api.call('getChat', {'chat_id': config['channel_id']})
    if me.get('is_bot') is not True or me.get('id') != config['expected_bot_id']:
        raise PublisherError('BOT_IDENTITY_MISMATCH')
    if chat.get('type') != 'channel' or chat.get('id') != config['expected_channel_id']:
        raise PublisherError('CHANNEL_IDENTITY_MISMATCH')
    member = api.call('getChatMember', {'chat_id': chat['id'], 'user_id': me['id']})
    if (member.get('user', {}).get('id') != me['id'] or member.get('status') != 'administrator'
            or member.get('can_post_messages') is not True):
        raise PublisherError('BOT_POST_PERMISSION_REQUIRED')
    return {'bot_id': me['id'], 'channel_id': chat['id'],
            'bot_username': me.get('username'), 'channel_username': chat.get('username')}


def load_queue(path):
    try:
        queue = json.loads(Path(path).read_text())
        if queue.get('version') != 1 or queue.get('timezone') != 'Asia/Tehran':
            raise ValueError()
        posts = queue['posts']
        if not isinstance(posts, list) or not 1 <= len(posts) <= 366:
            raise ValueError()
        ids, days, result = set(), set(), []
        for source in posts:
            post = dict(source)
            ident, text = post['id'], post['text']
            scheduled = dt.datetime.fromisoformat(post['scheduled_at'])
            if not isinstance(ident, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', ident) or ident in ids:
                raise ValueError()
            if not isinstance(text, str) or not text.strip() or not 1 <= len(text.encode('utf-16-le')) // 2 <= 4096:
                raise ValueError()
            if scheduled.tzinfo is None or scheduled.utcoffset() != scheduled.astimezone(TEHRAN).utcoffset():
                raise ValueError()
            day = scheduled.astimezone(TEHRAN).date()
            if day in days:
                raise ValueError()
            ids.add(ident)
            days.add(day)
            post['due'] = scheduled.timestamp()
            post['digest'] = hashlib.sha256(json.dumps(source, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
            result.append(post)
        return sorted(result, key=lambda p: p['due'])
    except Exception:
        raise PublisherError('INVALID_QUEUE') from None


def open_state(path):
    path = Path(path)
    parent = path.parent
    parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = parent.stat()
    if info.st_uid not in {0, os.geteuid()} or info.st_mode & 0o022:
        raise PublisherError('PRIVATE_STATE_DIRECTORY_REQUIRED')
    descriptor = os.open(str(path) + '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    lock = os.fdopen(descriptor, 'w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        raise PublisherError('PUBLISHER_BUSY') from None
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    if os.fstat(fd).st_uid not in {0, os.geteuid()}:
        os.close(fd)
        lock.close()
        raise PublisherError('PRIVATE_STATE_FILE_REQUIRED')
    os.fchmod(fd, 0o600)
    os.close(fd)
    db = sqlite3.connect(path)
    db.execute('PRAGMA synchronous=FULL')
    db.execute('CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, digest TEXT NOT NULL, due REAL NOT NULL, state TEXT NOT NULL, message_id INTEGER, retry_at REAL DEFAULT 0, attempted_at REAL)')
    if 'attempted_at' not in {row[1] for row in db.execute('PRAGMA table_info(posts)')}:
        db.execute('ALTER TABLE posts ADD COLUMN attempted_at REAL')
    db.execute('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    db.commit()
    return db, lock


def sync_queue(db, posts):
    for post in posts:
        row = db.execute('SELECT digest FROM posts WHERE id=?', (post['id'],)).fetchone()
        if row and row[0] != post['digest']:
            raise PublisherError('QUEUED_POST_CHANGED_REQUIRES_REVIEW')
    for post in posts:
        db.execute('INSERT OR IGNORE INTO posts(id,digest,due,state) VALUES(?,?,?,?)',
                   (post['id'], post['digest'], post['due'], 'pending'))
    db.commit()


def publish(config, posts, db, api=None, now=None):
    now = now or dt.datetime.now(UTC)
    timestamp = now.timestamp()
    identity = json.dumps([config['expected_bot_id'], config['expected_channel_id']])
    pinned = db.execute("SELECT value FROM metadata WHERE key='identity'").fetchone()
    if pinned and pinned[0] != identity:
        raise PublisherError('LEDGER_IDENTITY_MISMATCH')
    if not pinned:
        if db.execute("SELECT 1 FROM metadata WHERE key='armed'").fetchone():
            raise PublisherError('UNBOUND_LEDGER_REQUIRES_REVIEW')
        db.execute("INSERT INTO metadata VALUES('identity',?)", (identity,))
        db.commit()
    sync_queue(db, posts)
    first = db.execute("SELECT value FROM metadata WHERE key='armed'").fetchone() is None
    if first:
        db.execute("INSERT INTO metadata VALUES('armed',?)", (str(timestamp),))
        db.commit()
        return {'status': 'ARMED_NO_SEND'}
    # A durable intent left by an interrupted process must never be sent again.
    db.execute("UPDATE posts SET state='review_unknown' WHERE state='sending'")
    db.commit()
    eligible = []
    for post in posts:
        state, retry_at = db.execute('SELECT state,retry_at FROM posts WHERE id=?', (post['id'],)).fetchone()
        if state != 'pending' or post['due'] > timestamp:
            continue
        if timestamp - post['due'] > GRACE_SECONDS:
            db.execute("UPDATE posts SET state='review_expired' WHERE id=?", (post['id'],))
        elif retry_at <= timestamp:
            eligible.append(post)
    db.commit()
    if not eligible:
        return {'status': 'NO_POST_DUE'}
    post = eligible[0]
    # Queue validation permits one item per Tehran date; also cover earlier queue revisions.
    start = now.astimezone(TEHRAN).replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + dt.timedelta(days=1)
    if db.execute("SELECT 1 FROM posts WHERE state IN ('sent','sending','review_unknown') AND COALESCE(attempted_at,due)>=? AND COALESCE(attempted_at,due)<? LIMIT 1", (start.timestamp(), end.timestamp())).fetchone():
        return {'status': 'DAILY_LIMIT'}
    api = api or TelegramAPI(config['bot_token'])
    validate_identity(config, api)
    db.execute("UPDATE posts SET state='sending',attempted_at=? WHERE id=? AND state='pending'", (timestamp, post['id']))
    db.commit()
    try:
        message = api.call('sendMessage', {'chat_id': config['expected_channel_id'], 'text': post['text'],
                                         'link_preview_options': {'is_disabled': True}})
        if type(message.get('message_id')) is not int or message.get('chat', {}).get('id') != config['expected_channel_id']:
            raise DeliveryUnknown('TELEGRAM_RESPONSE_UNKNOWN')
    except APIRejected as error:
        if error.code == 429:
            db.execute("UPDATE posts SET state='pending',retry_at=? WHERE id=?", (timestamp + max(60, error.retry_after), post['id']))
            outcome = 'RATE_LIMITED_NOT_SENT'
        else:
            db.execute("UPDATE posts SET state='rejected' WHERE id=?", (post['id'],))
            outcome = 'REJECTED_NOT_SENT'
        db.commit()
        return {'status': outcome, 'post_id': post['id']}
    except Exception:
        db.execute("UPDATE posts SET state='review_unknown' WHERE id=?", (post['id'],))
        db.commit()
        return {'status': 'REVIEW_DELIVERY_UNKNOWN', 'post_id': post['id']}
    db.execute("UPDATE posts SET state='sent',message_id=? WHERE id=?", (message['message_id'], post['id']))
    db.commit()
    return {'status': 'POST_SENT', 'post_id': post['id'], 'message_id': message['message_id']}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--queue', required=True)
    parser.add_argument('--state', required=True)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--validate', action='store_true')
    modes.add_argument('--status', action='store_true')
    modes.add_argument('--publish', action='store_true')
    args = parser.parse_args(argv)
    db, lock = None, None
    try:
        config, posts = load_config(args.config), load_queue(args.queue)
        if args.validate:
            identity = validate_identity(config)
            print(json.dumps({'status': 'IDENTITY_VERIFIED', **identity}))
            return 0
        db, lock = open_state(args.state)
        if args.publish:
            output = publish(config, posts, db)
        else:
            sync_queue(db, posts)
            counts = dict(db.execute('SELECT state,COUNT(*) FROM posts GROUP BY state'))
            output = {'status': 'DRY_RUN_NO_SEND', 'queue_count': len(posts), 'states': counts}
        print(json.dumps(output))
        return 0
    except PublisherError as error:
        print('FTI_TELEGRAM_STOPPED: ' + str(error), file=sys.stderr)
        return 1
    except Exception:
        print('FTI_TELEGRAM_STOPPED: LOCAL_FAILURE', file=sys.stderr)
        return 1
    finally:
        if db is not None:
            db.close()
        if lock is not None:
            lock.close()


if __name__ == '__main__':
    raise SystemExit(main())
