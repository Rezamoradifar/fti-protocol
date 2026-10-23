#!/usr/bin/env python3
"""Install an isolated, finite Telegram queue; token is entered only on the VPS."""
import argparse
from datetime import datetime, timedelta
import fcntl
import getpass
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SERVICE = 'fti-telegram-publisher.service'
TIMER = 'fti-telegram-publisher.timer'
UNITS = Path('/etc/systemd/system')
CONFIG = Path('/etc/fti-telegram/config.json')
RELEASES = Path('/opt/fti-telegram/releases')
MARK = '# FTI_TELEGRAM_PUBLISHER_V1\n'
TZ = ZoneInfo('Asia/Tehran')


def require(condition, code):
    if not condition:
        raise InstallError(code)


class InstallError(Exception):
    pass


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=45)


def publisher():
    spec = importlib.util.spec_from_file_location('fti_telegram_publisher', HERE / 'telegram-publisher.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def build_queue(content, now, first_at=None):
    require(content.get('version') == 1 and content.get('timezone') == 'Asia/Tehran', 'CONTENT_VERSION_INVALID')
    first = datetime.fromisoformat(first_at) if first_at else (
        now.astimezone(TZ) + timedelta(days=1)).replace(hour=19, minute=0, second=0, microsecond=0)
    require(first.tzinfo is not None and first.utcoffset() is not None, 'FIRST_POST_NEEDS_TIMEZONE')
    require(first > now + timedelta(minutes=10), 'FIRST_POST_MUST_BE_FUTURE')
    first = first.astimezone(TZ)
    posts = content.get('posts')
    require(isinstance(posts, list) and 1 <= len(posts) <= 100, 'CONTENT_POSTS_INVALID')
    queue = {'version': 1, 'timezone': 'Asia/Tehran', 'posts': []}
    ids = set()
    for index, post in enumerate(posts):
        key, text = post.get('id'), post.get('text')
        require(isinstance(key, str) and re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', key) and key not in ids, 'POST_ID_INVALID')
        require(isinstance(text, str) and text.strip() and len(text.encode('utf-16-le')) // 2 <= 4096, 'POST_TEXT_INVALID')
        ids.add(key)
        queue['posts'].append({'id': key, 'text': text, 'scheduled_at': (first + timedelta(days=index)).isoformat()})
    return queue


def unit_texts(release):
    return {
        SERVICE: MARK + f'''[Unit]
Description=FTI Telegram queued publisher
Wants=network-online.target
After=network-online.target
[Service]
Type=oneshot
DynamicUser=yes
LoadCredential=botconfig:{CONFIG}
ExecStart=/usr/bin/python3 {release}/telegram-publisher.py --config %d/botconfig --queue {release}/queue.json --state /var/lib/fti-telegram/publications.sqlite3 --publish
StateDirectory=fti-telegram
StateDirectoryMode=0700
UMask=0077
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
NoNewPrivileges=yes
RestrictSUIDSGID=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
TimeoutStartSec=100
''',
        TIMER: MARK + '''[Unit]
Description=Check the FTI Telegram queue every minute
[Timer]
OnCalendar=*-*-* *:*:00
AccuracySec=5s
Persistent=false
Unit=fti-telegram-publisher.service
[Install]
WantedBy=timers.target
'''}


def private_dir(path):
    if path.exists():
        require(not path.is_symlink() and path.is_dir() and path.stat().st_uid == 0 and not path.stat().st_mode & 0o077, 'UNSAFE_PRIVATE_DIRECTORY')
    else:
        path.mkdir(mode=0o700, parents=True)


def atomic(path, data, mode):
    fd, temporary = tempfile.mkstemp(prefix='.fti-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def clean_empty_state():
    """Only remove an empty state directory created by read-only validation."""
    state = Path('/var/lib/fti-telegram')
    private = Path('/var/lib/private/fti-telegram')
    if state.is_symlink() and state.resolve() == private:
        if private.exists():
            private.rmdir()  # Never recursively remove state or a ledger.
        state.unlink()
    elif state.is_dir() and not state.is_symlink():
        state.rmdir()


def clean_release(release, expected):
    if not release.exists() or release.is_symlink():
        return
    for child in release.iterdir():
        if child.name not in expected or child.is_symlink() or not child.is_file() or child.read_bytes() != expected[child.name]:
            return  # Preserve concurrent or unfamiliar files.
    for child in release.iterdir():
        child.unlink()
    release.rmdir()


def install(queue, channel, module):
    require(os.geteuid() == 0, 'RUN_AS_ROOT_ON_VPS')
    require(sys.stdin.isatty() and sys.stderr.isatty(), 'INTERACTIVE_TERMINAL_REQUIRED')
    require(Path('/run/systemd/system').is_dir(), 'SYSTEMD_REQUIRED')
    require(not CONFIG.parent.is_symlink() and not RELEASES.parent.is_symlink(), 'UNSAFE_INSTALL_DIRECTORY')
    for name in (SERVICE, TIMER):
        path = UNITS / name
        require(not path.exists() and not path.is_symlink(), 'PUBLISHER_UNIT_ALREADY_EXISTS')
    require(not CONFIG.exists() and not CONFIG.is_symlink(), 'PUBLISHER_CONFIG_ALREADY_EXISTS')
    require(not Path('/var/lib/fti-telegram').exists() and not Path('/var/lib/private/fti-telegram').exists(), 'PUBLISHER_STATE_ALREADY_EXISTS')
    require(isinstance(channel, str) and re.fullmatch(r'@[A-Za-z0-9_]{5,32}', channel), 'PUBLIC_CHANNEL_USERNAME_REQUIRED')
    token = getpass.getpass('Telegram bot token (hidden, VPS only): ').strip()
    api = module.TelegramAPI(token)
    me = api.call('getMe', {})
    chat = api.call('getChat', {'chat_id': channel})
    config = {'bot_token': token, 'channel_id': chat.get('id'), 'expected_channel_id': chat.get('id'), 'expected_bot_id': me.get('id')}
    identity = module.validate_identity(config, api)
    require(chat.get('type') == 'channel' and isinstance(chat.get('username'), str), 'PUBLIC_CHANNEL_REQUIRED')
    require(chat['username'].casefold() == channel[1:].casefold(), 'CHANNEL_USERNAME_MISMATCH')
    print(json.dumps({'validated': True, 'bot': identity.get('bot_username'), 'channel': chat['username'], 'channel_id': chat['id'], 'first_post': queue['posts'][0]['scheduled_at'], 'posts': len(queue['posts'])}))

    source = (HERE / 'telegram-publisher.py').read_bytes()
    encoded = json.dumps(queue, ensure_ascii=False, indent=2).encode() + b'\n'
    release = RELEASES / hashlib.sha256(source + encoded).hexdigest()[:20]
    require(not RELEASES.is_symlink() and not release.is_symlink(), 'UNSAFE_RELEASE_DIRECTORY')
    RELEASES.mkdir(parents=True, mode=0o755, exist_ok=True)
    RELEASES.parent.chmod(0o755)
    RELEASES.chmod(0o755)
    require(not release.exists(), 'RELEASE_ALREADY_EXISTS')
    units = unit_texts(release)
    validation_units = dict(units)
    validation_units[SERVICE] = units[SERVICE].replace(' --publish\n', ' --validate\n')
    expected = {'telegram-publisher.py': source, 'queue.json': encoded,
                **{name: text.encode() for name, text in units.items()}}
    config_written = False
    units_written = []
    service_attempted = False
    try:
        release.mkdir(mode=0o755)
        release.chmod(0o755)  # Explicitly counter the private installer umask.
        for name, data in expected.items():
            atomic(release / name, data, 0o644)
        run('systemd-analyze', 'verify', *[str(release / name) for name in units])
        private_dir(CONFIG.parent)
        atomic(CONFIG, json.dumps(config).encode() + b'\n', 0o600)
        config_written = True
        for name, text in validation_units.items():
            path = UNITS / name
            require(not path.exists() and not path.is_symlink(), 'CONCURRENT_UNIT_EDIT')
            atomic(path, text.encode(), 0o644)
            units_written.append(name)
        run('systemctl', 'daemon-reload')
        # Validate the actual service credential sandbox with a read-only mode.
        # Never use --publish for installation testing, even after a long prompt.
        service_attempted = True
        run('systemctl', 'start', SERVICE)
        require(datetime.fromisoformat(queue['posts'][0]['scheduled_at']) > datetime.now(TZ) + timedelta(minutes=10), 'FIRST_POST_MUST_BE_FUTURE')
        require((UNITS / SERVICE).read_text() == validation_units[SERVICE], 'CONCURRENT_UNIT_EDIT')
        atomic(UNITS / SERVICE, units[SERVICE].encode(), 0o644)
        run('systemctl', 'daemon-reload')
        run('systemctl', 'enable', '--now', TIMER)
        run('systemctl', 'is-active', '--quiet', TIMER)
    except BaseException:
        if TIMER in units_written and (UNITS / TIMER).read_text() == units[TIMER]:
            subprocess.run(['systemctl', 'disable', '--now', TIMER], capture_output=True, timeout=45)
        if SERVICE in units_written and (UNITS / SERVICE).read_text() in (units[SERVICE], validation_units[SERVICE]):
            subprocess.run(['systemctl', 'stop', SERVICE], capture_output=True, timeout=45)
        for name in units_written:
            path = UNITS / name
            if path.read_text() in (units[name], validation_units[name]):
                path.unlink()
        if config_written and CONFIG.exists() and not CONFIG.is_symlink() and CONFIG.read_text() == json.dumps(config) + '\n':
            CONFIG.unlink()
        subprocess.run(['systemctl', 'daemon-reload'], capture_output=True, timeout=45)
        if service_attempted:
            try:
                clean_empty_state()
            except OSError:
                pass  # A nonempty state directory is always retained for inspection.
        clean_release(release, expected)
        raise
    print('FTI_TELEGRAM_TIMER_ENABLED')
    print('FIRST_POST=' + queue['posts'][0]['scheduled_at'])
    print('QUEUE=' + str(release / 'queue.json'))
    print('STOP_COMMAND=systemctl disable --now ' + TIMER + ' && systemctl stop ' + SERVICE)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='read token interactively and enable the dedicated timer')
    parser.add_argument('--channel', help='public channel @username that you control; bot must already be its administrator')
    parser.add_argument('--first-at', help='future ISO8601 timestamp with offset; default tomorrow 19:00 Asia/Tehran')
    args = parser.parse_args()
    os.umask(0o077)
    content = json.loads((ROOT / 'config/telegram-launch-posts.en.json').read_text())
    queue = build_queue(content, datetime.now(TZ), args.first_at)
    if not args.apply:
        print(json.dumps({'result': 'FTI_TELEGRAM_INSTALL_PREVIEW', 'first_post': queue['posts'][0]['scheduled_at'], 'posts': len(queue['posts']), 'timezone': queue['timezone'], 'messages_sent': 0}))
        return
    require(os.geteuid() == 0, 'RUN_AS_ROOT_ON_VPS')
    with open('/run/lock/fti-telegram-install.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        install(queue, args.channel or input('Public channel @username: ').strip(), publisher())


if __name__ == '__main__':
    try:
        main()
    except InstallError as error:
        print('FTI_TELEGRAM_INSTALL_STOPPED: ' + str(error), file=sys.stderr)
        sys.exit(1)
    except (Exception, KeyboardInterrupt):
        # Never print exception objects: transport errors may contain bot URLs.
        print('FTI_TELEGRAM_INSTALL_STOPPED: check channel, admin rights, network and systemd; token not logged.', file=sys.stderr)
        sys.exit(1)
