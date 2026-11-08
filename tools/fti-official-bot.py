#!/usr/bin/env python3
"""FTI official multilingual DM bot and one-shot verified channel price table.

The default is a local capability preview. No channel schedule is created.
"""
import argparse
import datetime as dt
from decimal import Decimal, localcontext
import fcntl
import getpass
import hashlib
import html
import json
import os
from pathlib import Path
import re
import sqlite3
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import warnings

BOT_ID = 8961425436
CHANNEL_ID = -1003941034086
BOT_USERNAME = 'FTIProtocol_OfficialBot'
CHANNEL_USERNAME = 'FTIProtocol_Official'
TOKEN_ADDRESS = '0x43755b1e813b2d41f669ea08bcf859de07195ea1'
RPC_URL = 'https://ftiprotocol.com/rpc'
CONFIG = Path('/etc/fti-telegram/config.json')
STATE = Path('/var/lib/fti-official-bot/state.sqlite3')
SYSTEMD_PRIVATE_STATE = Path('/var/lib/private/fti-official-bot')
PRICE_STATE = Path('/var/lib/fti-official-price/state.sqlite3')
SERVICE = 'fti-official-bot.service'
UNITS = Path('/etc/systemd/system')
RELEASES = Path('/opt/fti-telegram/official-bot')
UNIT_MARK = '# FTI_OFFICIAL_MULTILINGUAL_BOT_V1\n'
UINT256 = (1 << 256) - 1
SELECTORS = {'price': '0xa035b1fe', 'supply': '0x18160ddd', 'reserve': '0xcd3293de',
             'cycle': '0x6190c9d5', 'opening': '0x9bffe6d6'}
LANGUAGES = {'en': 'English', 'fa': 'فارسی', 'ar': 'العربية', 'tr': 'Türkçe',
             'es': 'Español', 'ru': 'Русский', 'zh': '简体中文'}
COPY = {
'en': {'welcome': 'Welcome to FTI Protocol', 'intro': 'View the live contract price and open the official applications. This bot never asks for a seed phrase or private key.',
       'help': 'Use /price for the observed contract price, /language to choose a language, and /start for official links. Membership and trading actions take place in your wallet through the official website.',
       'choose': 'Choose your language', 'saved': 'Language saved.', 'price': 'FTI contract price', 'opening': 'Cycle opening quote · reference', 'observed': 'Observed at', 'change': 'Change vs opening quote',
       'empty': 'No spot price exists while token supply is zero.', 'unavailable': 'The verified price is temporarily unavailable. Please try again shortly.',
       'note': 'Reserve/share quote in USDT. This is not a guaranteed sale value or a forecast. Fees and trading limits apply.',
       'app': 'Launch App', 'market': 'Token Market', 'channel': 'Official Channel', 'language': 'Language', 'commands': ['Open official links', 'View the verified contract price', 'Choose your language', 'Get help']},
'fa': {'welcome': 'به FTI Protocol خوش آمدید', 'intro': 'قیمت زنده قرارداد را ببینید و وارد برنامه‌های رسمی شوید. این ربات هرگز عبارت بازیابی یا کلید خصوصی نمی‌خواهد.',
       'help': 'با /price قیمت مشاهده‌شده قرارداد را ببینید، با /language زبان را انتخاب کنید و با /start لینک‌های رسمی را باز کنید. عضویت و معامله از طریق سایت رسمی و داخل ولت شما انجام می‌شود.',
       'choose': 'زبان خود را انتخاب کنید', 'saved': 'زبان ذخیره شد.', 'price': 'قیمت قراردادی FTI', 'opening': 'قیمت آغاز چرخه · مرجع', 'observed': 'زمان مشاهده', 'change': 'تغییر نسبت به قیمت آغاز چرخه',
       'empty': 'تا زمانی که عرضه توکن صفر است، قیمت جاری وجود ندارد.', 'unavailable': 'قیمت تأییدشده موقتاً در دسترس نیست. کمی بعد دوباره امتحان کنید.',
       'note': 'قیمت نسبت ذخیره به عرضه با واحد USDT است. ارزش فروش یا رشد آینده تضمین نمی‌شود؛ کارمزد و محدودیت‌های معامله اعمال می‌شوند.',
       'app': 'ورود به پنل', 'market': 'بازار توکن', 'channel': 'کانال رسمی', 'language': 'زبان', 'commands': ['بازکردن لینک‌های رسمی', 'نمایش قیمت تأییدشده قرارداد', 'انتخاب زبان', 'راهنما']},
'ar': {'welcome': 'مرحباً بك في FTI Protocol', 'intro': 'اعرض سعر العقد المباشر وافتح التطبيقات الرسمية. لا يطلب هذا الروبوت عبارة الاسترداد أو المفتاح الخاص مطلقاً.',
       'help': 'استخدم /price لسعر العقد المرصود و /language لاختيار اللغة و /start للروابط الرسمية. تتم العضوية والتداول عبر الموقع الرسمي ومحفظتك.',
       'choose': 'اختر لغتك', 'saved': 'تم حفظ اللغة.', 'price': 'سعر عقد FTI', 'opening': 'سعر افتتاح الدورة · مرجع', 'observed': 'وقت الرصد', 'change': 'التغير منذ افتتاح الدورة',
       'empty': 'لا يوجد سعر فوري عندما يكون عرض الرمز صفراً.', 'unavailable': 'السعر المتحقق غير متاح مؤقتاً. يرجى المحاولة لاحقاً.',
       'note': 'سعر الاحتياطي مقابل العرض بوحدة USDT. ليس قيمة بيع مضمونة أو توقعاً. تطبق الرسوم وحدود التداول.',
       'app': 'فتح التطبيق', 'market': 'سوق الرمز', 'channel': 'القناة الرسمية', 'language': 'اللغة', 'commands': ['فتح الروابط الرسمية', 'عرض سعر العقد المتحقق', 'اختيار اللغة', 'المساعدة']},
 'tr': {'welcome': 'FTI Protocol’e hoş geldiniz', 'intro': 'Canlı sözleşme fiyatını görüntüleyin ve resmî uygulamaları açın. Bu bot asla kurtarma ifadenizi veya özel anahtarınızı istemez.',
       'help': 'Gözlemlenen sözleşme fiyatı için /price, dil seçmek için /language, resmî bağlantılar için /start kullanın. Üyelik ve işlemler resmî site üzerinden cüzdanınızda gerçekleşir.',
       'choose': 'Dilinizi seçin', 'saved': 'Dil kaydedildi.', 'price': 'FTI sözleşme fiyatı', 'opening': 'Döngü açılış kotasyonu · referans', 'observed': 'Gözlem zamanı', 'change': 'Açılış kotasyonuna göre değişim',
       'empty': 'Token arzı sıfırken anlık fiyat yoktur.', 'unavailable': 'Doğrulanmış fiyat geçici olarak kullanılamıyor. Lütfen tekrar deneyin.',
       'note': 'USDT cinsinden rezerv/arz kotasyonudur. Garanti edilmiş satış değeri veya tahmin değildir. Ücretler ve işlem limitleri geçerlidir.',
       'app': 'Uygulamayı Aç', 'market': 'Token Piyasası', 'channel': 'Resmî Kanal', 'language': 'Dil', 'commands': ['Resmî bağlantıları aç', 'Doğrulanmış sözleşme fiyatı', 'Dilinizi seçin', 'Yardım alın']},
'es': {'welcome': 'Bienvenido a FTI Protocol', 'intro': 'Consulta el precio del contrato y abre las aplicaciones oficiales. Este bot nunca solicita tu frase de recuperación ni tu clave privada.',
       'help': 'Usa /price para consultar el precio observado del contrato, /language para elegir el idioma y /start para los enlaces oficiales. La membresía y las operaciones se realizan en tu cartera mediante el sitio oficial.',
       'choose': 'Elige tu idioma', 'saved': 'Idioma guardado.', 'price': 'Precio del contrato FTI', 'opening': 'Cotización inicial del ciclo · referencia', 'observed': 'Fecha de observación', 'change': 'Cambio desde la cotización inicial',
       'empty': 'No existe precio al contado mientras la oferta del token sea cero.', 'unavailable': 'El precio verificado no está disponible temporalmente. Inténtalo de nuevo.',
       'note': 'Cotización de reserva/oferta en USDT. No garantiza el valor de venta ni predice el futuro. Se aplican comisiones y límites.',
       'app': 'Abrir Aplicación', 'market': 'Mercado del Token', 'channel': 'Canal Oficial', 'language': 'Idioma', 'commands': ['Abrir enlaces oficiales', 'Ver el precio verificado', 'Elegir idioma', 'Obtener ayuda']},
'ru': {'welcome': 'Добро пожаловать в FTI Protocol', 'intro': 'Смотрите текущую цену контракта и открывайте официальные приложения. Бот никогда не запрашивает сид-фразу или закрытый ключ.',
       'help': 'Команда /price показывает наблюдаемую цену контракта, /language выбирает язык, /start открывает официальные ссылки. Регистрация и торговля выполняются в вашем кошельке через официальный сайт.',
       'choose': 'Выберите язык', 'saved': 'Язык сохранён.', 'price': 'Цена контракта FTI', 'opening': 'Котировка открытия цикла · ориентир', 'observed': 'Время наблюдения', 'change': 'Изменение к котировке открытия',
       'empty': 'При нулевом предложении токена спотовой цены нет.', 'unavailable': 'Проверенная цена временно недоступна. Повторите попытку позже.',
       'note': 'Котировка резерв/предложение в USDT. Это не гарантированная цена продажи и не прогноз. Применяются комиссии и торговые ограничения.',
       'app': 'Открыть Приложение', 'market': 'Рынок Токена', 'channel': 'Официальный Канал', 'language': 'Язык', 'commands': ['Официальные ссылки', 'Проверенная цена контракта', 'Выбрать язык', 'Справка']},
'zh': {'welcome': '欢迎使用 FTI Protocol', 'intro': '查看实时合约价格并打开官方应用。本机器人绝不会索要助记词或私钥。',
       'help': '使用 /price 查看已观测的合约价格，使用 /language 选择语言，使用 /start 打开官方链接。注册和交易均通过官方网站在您的钱包中完成。',
       'choose': '请选择语言', 'saved': '语言已保存。', 'price': 'FTI 合约价格', 'opening': '周期初始报价 · 参考', 'observed': '观测时间', 'change': '相对周期初始报价的变化',
       'empty': '代币供应量为零时不存在现货价格。', 'unavailable': '暂时无法获取已验证的价格，请稍后重试。',
       'note': '以 USDT 表示的储备/供应量报价。这不是保证的卖出价值或预测；适用手续费及交易限制。',
       'app': '打开应用', 'market': '代币市场', 'channel': '官方频道', 'language': '语言', 'commands': ['打开官方链接', '查看已验证合约价格', '选择语言', '获取帮助']}}


for code, message in {'en': 'Please wait a moment and try again.', 'fa': 'یک لحظه صبر کنید و دوباره بزنید.',
                      'ar': 'يرجى الانتظار قليلاً والمحاولة مجدداً.', 'tr': 'Lütfen biraz bekleyip tekrar deneyin.',
                      'es': 'Espera un momento e inténtalo de nuevo.', 'ru': 'Подождите немного и повторите попытку.',
                      'zh': '请稍候再试。'}.items():
    COPY[code]['wait'] = message


class BotError(Exception):
    """Only fixed non-secret codes may leave this process."""


class Rejected(BotError):
    def __init__(self, code):
        super().__init__('TELEGRAM_REJECTED')
        self.code = code


class UnknownDelivery(BotError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def require(condition, code):
    if not condition:
        raise BotError(code)


def request_json(url, data=None, timeout=25):
    # Endpoints are constants in this module; no redirects or credential-bearing errors.
    request = urllib.request.Request(url, data=None if data is None else json.dumps(data).encode(),
                                     headers={'Content-Type': 'application/json', 'User-Agent': 'FTI-Official-Bot/1'},
                                     method='GET' if data is None else 'POST')
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout) as response:
            status, raw = response.status, response.read(1_000_001)
    except urllib.error.HTTPError as error:
        status, raw = error.code, error.read(1_000_001)
    except Exception:
        raise UnknownDelivery('REMOTE_RESPONSE_UNKNOWN') from None
    require(len(raw) <= 1_000_000 and status < 500, 'REMOTE_RESPONSE_UNKNOWN')
    try:
        return status, json.loads(raw)
    except Exception:
        raise UnknownDelivery('REMOTE_RESPONSE_UNKNOWN') from None


class TelegramAPI:
    METHODS = {'getMe', 'getChat', 'getChatMember', 'getWebhookInfo', 'getUpdates',
               'answerCallbackQuery', 'sendMessage', 'setMyCommands', 'setMyDescription', 'setMyShortDescription'}

    def __init__(self, token):
        require(isinstance(token, str) and re.fullmatch(r'[0-9]{5,20}:[A-Za-z0-9_-]{20,200}', token)
                and int(token.split(':')[0]) == BOT_ID, 'INVALID_BOT_TOKEN')
        self._token = token

    def call(self, method, params):
        require(method in self.METHODS, 'METHOD_NOT_ALLOWED')
        status, body = request_json('https://api.telegram.org/bot' + self._token + '/' + method,
                                    params, timeout=35 if method == 'getUpdates' else 25)
        if isinstance(body, dict) and body.get('ok') is False and type(body.get('error_code')) is int:
            raise Rejected(body['error_code'])
        require(status == 200 and isinstance(body, dict) and body.get('ok') is True and 'result' in body,
                'TELEGRAM_RESPONSE_UNKNOWN')
        return body['result']


def config_file(path):
    try:
        path = Path(path)
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_uid in {0, os.geteuid()} and not info.st_mode & 0o077,
                'PRIVATE_CONFIG_REQUIRED')
        config = json.loads(path.read_text())
        require(config.get('expected_bot_id') == BOT_ID and config.get('expected_channel_id') == CHANNEL_ID
                and config.get('channel_id') == CHANNEL_ID, 'OFFICIAL_IDENTITY_REQUIRED')
        TelegramAPI(config.get('bot_token'))
        return config
    except BotError:
        raise
    except Exception:
        raise BotError('INVALID_PRIVATE_CONFIG') from None


def validate_bot(api, channel=False):
    me = api.call('getMe', {})
    require(me.get('id') == BOT_ID and me.get('is_bot') is True and
            str(me.get('username', '')).casefold() == BOT_USERNAME.casefold(), 'BOT_IDENTITY_MISMATCH')
    if channel:
        chat = api.call('getChat', {'chat_id': CHANNEL_ID})
        member = api.call('getChatMember', {'chat_id': CHANNEL_ID, 'user_id': BOT_ID})
        require(chat.get('type') == 'channel' and chat.get('id') == CHANNEL_ID and
                str(chat.get('username', '')).casefold() == CHANNEL_USERNAME.casefold(), 'CHANNEL_IDENTITY_MISMATCH')
        require(member.get('user', {}).get('id') == BOT_ID and member.get('status') == 'administrator'
                and member.get('can_post_messages') is True, 'CHANNEL_POST_PERMISSION_REQUIRED')
    return me


def rpc(method, params):
    require(method in {'eth_chainId', 'eth_call', 'eth_getBlockByNumber'}, 'RPC_METHOD_NOT_ALLOWED')
    status, body = request_json(RPC_URL, {'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params})
    require(status == 200 and isinstance(body, dict) and body.get('jsonrpc') == '2.0' and body.get('id') == 1
            and 'error' not in body and 'result' in body, 'PRICE_RPC_UNAVAILABLE')
    return body['result']


def hex_integer(value, word=False):
    require(isinstance(value, str) and re.fullmatch(r'0x[0-9a-fA-F]{64}' if word else r'0x[0-9a-fA-F]+', value),
            'INVALID_CHAIN_VALUE')
    result = int(value, 16)
    require(result <= UINT256, 'INVALID_CHAIN_VALUE')
    return result


def chain_snapshot(read=rpc, now=None):
    clock = time.time if now is None else lambda: now
    require(hex_integer(read('eth_chainId', [])) == 56, 'WRONG_PRICE_NETWORK')
    block = read('eth_getBlockByNumber', ['latest', False])
    require(isinstance(block, dict) and re.fullmatch(r'0x[0-9a-fA-F]{64}', block.get('hash', '')), 'INVALID_PRICE_BLOCK')
    number, timestamp = hex_integer(block.get('number')), hex_integer(block.get('timestamp'))
    require(clock() - timestamp <= 90 and timestamp <= clock() + 15, 'STALE_PRICE_BLOCK')
    values = {key: hex_integer(read('eth_call', [{'to': TOKEN_ADDRESS, 'data': data}, hex(number)]), True)
              for key, data in SELECTORS.items()}
    again = read('eth_getBlockByNumber', [hex(number), False])
    require(isinstance(again, dict) and again.get('hash') == block['hash']
            and again.get('number') == block['number'] and again.get('timestamp') == block['timestamp'], 'PRICE_BLOCK_CHANGED')
    require(clock() - timestamp <= 90, 'STALE_PRICE_BLOCK')
    require(values['cycle'] > 0 and values['opening'] > 0, 'INVALID_CYCLE_QUOTE')
    if values['supply']:
        require(values['price'] == values['reserve'] * 10 ** 18 // values['supply'], 'PRICE_RESERVE_MISMATCH')
    else:
        require(values['price'] == 0, 'INVALID_ZERO_SUPPLY_PRICE')
    return {'chain': 56, 'token': TOKEN_ADDRESS, 'block': number, 'hash': block['hash'].lower(),
            'time': timestamp, **{key: str(value) for key, value in values.items()}}


def state_path(path):
    path = Path(path)
    parent = path.parent
    if parent.is_symlink():
        # DynamicUser+StateDirectory deliberately creates this one root-owned
        # alias. Follow only its exact reviewed destination, never generic links.
        targets = {str(SYSTEMD_PRIVATE_STATE), str(SYSTEMD_PRIVATE_STATE.relative_to(parent.parent))}
        require(path == STATE and parent.lstat().st_uid == 0 and os.readlink(parent) in targets
                and parent.resolve(strict=True) == SYSTEMD_PRIVATE_STATE, 'PRIVATE_STATE_DIRECTORY_REQUIRED')
        for ancestor in (parent.parent, SYSTEMD_PRIVATE_STATE.parent):
            info = ancestor.lstat()
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
                    'PRIVATE_STATE_DIRECTORY_REQUIRED')
        require(SYSTEMD_PRIVATE_STATE.resolve(strict=True) == SYSTEMD_PRIVATE_STATE,
                'PRIVATE_STATE_DIRECTORY_REQUIRED')
        parent = SYSTEMD_PRIVATE_STATE
        path = parent / path.name
    else:
        parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        require(parent.resolve(strict=True) == parent.absolute(), 'PRIVATE_STATE_DIRECTORY_REQUIRED')
    info = parent.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid in {0, os.geteuid()} and not info.st_mode & 0o077,
            'PRIVATE_STATE_DIRECTORY_REQUIRED')
    return path


def open_state(path):
    path = state_path(path)
    lock = db = None
    try:
        lock_fd = os.open(str(path) + '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        info = os.fstat(lock_fd)
        if not (stat.S_ISREG(info.st_mode) and info.st_uid in {0, os.geteuid()}):
            os.close(lock_fd)
            raise BotError('PRIVATE_STATE_FILE_REQUIRED')
        os.fchmod(lock_fd, 0o600)
        lock = os.fdopen(lock_fd, 'w')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise BotError('BOT_STATE_BUSY') from None
        fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            info = os.fstat(fd)
            require(stat.S_ISREG(info.st_mode) and info.st_uid in {0, os.geteuid()}, 'PRIVATE_STATE_FILE_REQUIRED')
            os.fchmod(fd, 0o600)
        finally:
            os.close(fd)
        db = sqlite3.connect(path)
        db.execute('PRAGMA synchronous=FULL')
        db.executescript('''
          CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS chats(id INTEGER PRIMARY KEY,language TEXT NOT NULL,last_at REAL NOT NULL DEFAULT 0);
          CREATE TABLE IF NOT EXISTS updates(id INTEGER PRIMARY KEY,state TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS observations(block INTEGER PRIMARY KEY,hash TEXT NOT NULL,time INTEGER NOT NULL,cycle TEXT NOT NULL,opening TEXT NOT NULL,price TEXT NOT NULL,supply TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS channel_posts(id TEXT PRIMARY KEY,state TEXT NOT NULL,payload_sha256 TEXT NOT NULL,message_id INTEGER,created_at REAL NOT NULL);
        ''')
        identity = json.dumps([BOT_ID, CHANNEL_ID, 56, TOKEN_ADDRESS])
        old = db.execute("SELECT value FROM metadata WHERE key='identity'").fetchone()
        require(not old or old[0] == identity, 'STATE_IDENTITY_MISMATCH')
        db.execute("INSERT OR IGNORE INTO metadata VALUES('identity',?)", (identity,))
        db.commit()
        return db, lock
    except BaseException:
        if db is not None:
            db.close()
        if lock is not None:
            lock.close()
        raise


def remember(db, snapshot):
    row = db.execute('SELECT hash FROM observations WHERE block=?', (snapshot['block'],)).fetchone()
    require(not row or row[0] == snapshot['hash'], 'OBSERVATION_BLOCK_CHANGED')
    # Retain observed values only. A cycle opening quote is a separate reference,
    # never inserted as a fabricated spot price at a made-up time.
    db.execute('INSERT OR IGNORE INTO observations VALUES(?,?,?,?,?,?,?)',
               tuple(snapshot[key] for key in ['block', 'hash', 'time', 'cycle', 'opening', 'price', 'supply']))
    db.execute('DELETE FROM observations WHERE block NOT IN (SELECT block FROM observations ORDER BY block DESC LIMIT 256)')
    db.commit()


def decimal_text(wei, digits=8):
    with localcontext() as context:
        context.prec = 100
        number = Decimal(wei) / Decimal(10 ** 18)
        result = format(number, f'.{digits}f').rstrip('0').rstrip('.')
        if number != 0 and Decimal(result or '0') == 0:
            return format(number, 'f').rstrip('0').rstrip('.')
        return result or '0'


def growth(price, opening):
    with localcontext() as context:
        context.prec = 100
        value = (Decimal(price) / Decimal(opening) - 1) * 100
        return ('+' if value > 0 else '') + format(value, '.4f') + '%'


def utc(timestamp):
    return dt.datetime.fromtimestamp(timestamp, dt.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')


def language_for(code):
    return code.lower().split('-')[0] if isinstance(code, str) and code.lower().split('-')[0] in COPY else 'en'


def links(language='en'):
    text = COPY[language]
    return {'inline_keyboard': [
        [{'text': text['app'], 'url': 'https://ftiprotocol.com/app/'}],
        [{'text': text['market'], 'url': 'https://ftiprotocol.com/token/'},
         {'text': text['channel'], 'url': 'https://t.me/FTIProtocol_Official'}],
        [{'text': text['price'], 'callback_data': 'price'},
         {'text': text['language'], 'callback_data': 'language'}]]}


def language_keyboard():
    rows = [[{'text': name, 'callback_data': 'lang:' + code} for code, name in list(LANGUAGES.items())[i:i + 2]]
            for i in range(0, len(LANGUAGES), 2)]
    return {'inline_keyboard': rows}


def price_text(snapshot, language='en'):
    text = COPY[language]
    observed = decimal_text(snapshot['price']) + ' USDT' if int(snapshot['supply']) else text['empty']
    rows = ['<b>' + html.escape(text['price']) + '</b>', html.escape(observed),
            html.escape(text['opening']) + ': ' + decimal_text(snapshot['opening']) + ' USDT']
    if int(snapshot['supply']):
        rows.append(html.escape(text['change']) + ': ' + growth(snapshot['price'], snapshot['opening']))
    rows += [html.escape(text['observed']) + ': ' + utc(snapshot['time']), 'BNB Chain · 56 · #' + str(snapshot['block']), '', html.escape(text['note'])]
    return '\n'.join(rows)


def channel_table(snapshot, observations):
    current_cycle = snapshot['cycle']
    rows = [row for row in observations if str(row['cycle']) == current_cycle and int(row['supply']) > 0]
    rows = sorted(rows, key=lambda row: row['block'])[-8:]
    lines = ['UTC observation      FTI / USDT    vs open']
    for row in rows:
        stamp = dt.datetime.fromtimestamp(row['time'], dt.timezone.utc).strftime('%Y-%m-%d %H:%M')
        lines.append(stamp + '  ' + decimal_text(row['price']) + '  ' + growth(row['price'], snapshot['opening']))
    if not rows:
        lines.append('No spot price: token supply is zero.')
    text = ('<b>FTI Protocol | Observed Price Table</b>\n\n'
            'Cycle ' + str(current_cycle) + ' opening quote (reference): <b>' + decimal_text(snapshot['opening']) + ' USDT</b>\n\n'
            '<pre>' + html.escape('\n'.join(lines)) + '</pre>\n'
            'Latest verified block: ' + str(snapshot['block']) + '\n'
            'Updated: ' + utc(snapshot['time']) + '\n\n'
            'Rows are actual recorded observations, not a continuous trading history. '
            'Reserve/share quotes; sale fees and limits apply. Future growth is not guaranteed.\n\n'
            '#FTIProtocol #FTI #BNBChain')
    require(len(text.encode('utf-16-le')) // 2 < 4096, 'PRICE_POST_TOO_LONG')
    markup = links('en')
    markup['inline_keyboard'] = markup['inline_keyboard'][:-1]
    return {'chat_id': CHANNEL_ID, 'text': text, 'parse_mode': 'HTML',
            'link_preview_options': {'is_disabled': True}, 'reply_markup': markup}


def observed_rows(db, cycle):
    result = db.execute('SELECT block,hash,time,cycle,opening,price,supply FROM observations WHERE cycle=? ORDER BY block DESC LIMIT 8', (str(cycle),))
    return [dict(zip(['block', 'hash', 'time', 'cycle', 'opening', 'price', 'supply'], row)) for row in result]


def verified_history(db, snapshot, read=rpc):
    rows = observed_rows(db, snapshot['cycle'])
    result = []
    for row in rows:
        if row['opening'] != snapshot['opening']:
            continue
        block = read('eth_getBlockByNumber', [hex(row['block']), False])
        # Drop an orphaned prior observation; never present it as canonical history.
        if isinstance(block, dict) and block.get('hash', '').lower() == row['hash'] and hex_integer(block.get('timestamp')) == row['time']:
            result.append(row)
    require(any(row['block'] == snapshot['block'] for row in result), 'PRICE_BLOCK_CHANGED')
    return result


def publish_price(db, api, payload, post_id, now=None):
    require(re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', post_id) is not None, 'INVALID_PRICE_POST_ID')
    old = db.execute('SELECT state,message_id FROM channel_posts WHERE id=?', (post_id,)).fetchone()
    if old:
        require(old[0] == 'sent', 'PRICE_POST_REQUIRES_MANUAL_REVIEW')
        return {'status': 'ALREADY_PUBLISHED', 'post_id': post_id, 'message_id': old[1]}
    validate_bot(api, channel=True)
    require(payload.get('chat_id') == CHANNEL_ID, 'CHANNEL_IDENTITY_MISMATCH')
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    db.execute('INSERT INTO channel_posts VALUES(?,?,?,?,?)', (post_id, 'sending', digest, None, time.time() if now is None else now))
    db.commit()  # Persist intent before the irreversible send; never retry an unknown delivery.
    try:
        message = api.call('sendMessage', payload)
        require(type(message.get('message_id')) is int and message['message_id'] > 0
                and message.get('chat', {}).get('id') == CHANNEL_ID, 'TELEGRAM_RESPONSE_UNKNOWN')
    except Rejected:
        db.execute("UPDATE channel_posts SET state='rejected' WHERE id=?", (post_id,))
        db.commit()
        raise
    except Exception:
        db.execute("UPDATE channel_posts SET state='unknown' WHERE id=?", (post_id,))
        db.commit()
        raise BotError('PRICE_POST_REQUIRES_MANUAL_REVIEW') from None
    db.execute("UPDATE channel_posts SET state='sent',message_id=? WHERE id=?", (message['message_id'], post_id))
    db.commit()
    return {'status': 'PRICE_TABLE_PUBLISHED', 'post_id': post_id, 'message_id': message['message_id']}


def menu_plan():
    for language, text in COPY.items():
        code = '' if language == 'en' else language
        yield 'setMyCommands', {'language_code': code, 'scope': {'type': 'all_private_chats'}, 'commands': [
            {'command': command, 'description': description} for command, description in zip(['start', 'price', 'language', 'help'], text['commands'])]}
        yield 'setMyDescription', {'language_code': code, 'description': text['intro']}
        yield 'setMyShortDescription', {'language_code': code, 'short_description': text['welcome']}


def configure_menu(api):
    validate_bot(api)
    for method, payload in menu_plan():
        require(api.call(method, payload) is True, 'BOT_MENU_NOT_CONFIGURED')
    return {'status': 'BOT_MENUS_CONFIGURED', 'languages': list(COPY)}


def acknowledge(api, callback, text=''):
    if isinstance(callback, dict) and isinstance(callback.get('id'), str):
        try:
            api.call('answerCallbackQuery', {'callback_query_id': callback['id'], 'text': text})
        except Exception:
            pass  # An acknowledgement does not decide message delivery state.


def reply_update(db, api, update, price_reader=chain_snapshot, now=None):
    now = time.time() if now is None else now
    ident = update.get('update_id')
    require(type(ident) is int and ident >= 0, 'INVALID_UPDATE')
    if db.execute('SELECT 1 FROM updates WHERE id=?', (ident,)).fetchone():
        return {'status': 'UPDATE_ALREADY_HANDLED'}
    message, callback = update.get('message'), update.get('callback_query')
    actor = message.get('from', {}) if isinstance(message, dict) else callback.get('from', {}) if isinstance(callback, dict) else {}
    if isinstance(callback, dict):
        message = callback.get('message', {})
    actor = actor if isinstance(actor, dict) else {}
    chat = message.get('chat', {}) if isinstance(message, dict) else {}
    chat = chat if isinstance(chat, dict) else {}
    private = type(actor.get('id')) is int and chat.get('type') == 'private' and type(chat.get('id')) is int and chat['id'] > 0 and chat['id'] == actor.get('id') and actor.get('is_bot') is not True
    offset = db.execute("SELECT value FROM metadata WHERE key='offset'").fetchone()
    if offset and ident < int(offset[0]):
        return {'status': 'STALE_UPDATE_IGNORED'}
    # Claim once before any send. Private command text is never stored.
    db.execute('INSERT INTO updates VALUES(?,?)', (ident, 'handling'))
    db.execute('DELETE FROM updates WHERE id < ?', (ident - 5000,))
    db.execute("INSERT OR REPLACE INTO metadata VALUES('offset',?)", (str(ident + 1),))
    db.commit()
    if not private:
        db.execute("UPDATE updates SET state='ignored' WHERE id=?", (ident,))
        db.commit()
        return {'status': 'NON_PRIVATE_UPDATE_IGNORED'}
    chat_id = chat['id']
    stored = db.execute('SELECT language,last_at FROM chats WHERE id=?', (chat_id,)).fetchone()
    language = stored[0] if stored and stored[0] in COPY else language_for(actor.get('language_code'))
    if stored and now - stored[1] < 1:
        acknowledge(api, callback, COPY[language]['wait'])
        db.execute("UPDATE updates SET state='limited' WHERE id=?", (ident,))
        db.commit()
        return {'status': 'PRIVATE_RATE_LIMIT'}
    data = callback.get('data', '') if isinstance(callback, dict) else ''
    command_text = message.get('text')
    command = command_text.split(maxsplit=1)[0].split('@')[0] if isinstance(command_text, str) and command_text.strip() else '/help'
    if data.startswith('lang:') and data[5:] in COPY:
        language = data[5:]
        command = '/start'
    elif data == 'language':
        command = '/language'
    elif data == 'price':
        command = '/price'
    elif callback:
        acknowledge(api, callback)
        db.execute("UPDATE updates SET state='ignored' WHERE id=?", (ident,))
        db.commit()
        return {'status': 'UNKNOWN_CALLBACK_IGNORED'}
    db.execute('INSERT OR REPLACE INTO chats VALUES(?,?,?)', (chat_id, language, now))
    db.commit()
    acknowledge(api, callback, COPY[language]['saved'] if data.startswith('lang:') else '')
    text, markup = COPY[language], links(language)
    if command == '/language':
        content, markup = html.escape(text['choose']), language_keyboard()
    elif command == '/price':
        try:
            snapshot = price_reader()
            remember(db, snapshot)
            content = price_text(snapshot, language)
        except Exception:
            content = html.escape(text['unavailable'])
    elif command == '/start':
        content = '<b>' + html.escape(text['welcome']) + '</b>\n\n' + html.escape(text['intro'])
    else:
        content = html.escape(text['help'])
    payload = {'chat_id': chat_id, 'text': content, 'parse_mode': 'HTML',
               'link_preview_options': {'is_disabled': True}, 'reply_markup': markup}
    try:
        reply = api.call('sendMessage', payload)
        require(type(reply.get('message_id')) is int and reply.get('chat', {}).get('id') == chat_id, 'TELEGRAM_RESPONSE_UNKNOWN')
    except Exception:
        db.execute("UPDATE updates SET state='unknown' WHERE id=?", (ident,))
        db.commit()
        return {'status': 'PRIVATE_REPLY_DELIVERY_UNKNOWN'}
    db.execute("UPDATE updates SET state='replied' WHERE id=?", (ident,))
    db.commit()
    return {'status': 'PRIVATE_REPLY_SENT', 'language': language}


def notify_ready():
    destination = os.environ.get('NOTIFY_SOCKET')
    if not destination:
        return False  # An explicit foreground poll also works outside systemd.
    require(isinstance(destination, str) and destination.startswith(('/', '@')), 'INVALID_NOTIFY_SOCKET')
    address = '\0' + destination[1:] if destination.startswith('@') else destination
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as connection:
            connection.connect(address)
            connection.sendall(b'READY=1\nSTATUS=Verified Telegram polling is ready')
    except Exception:
        raise BotError('SERVICE_READINESS_NOT_DELIVERED') from None
    return True


def poll(db, api, once=False, ready=notify_ready):
    validate_bot(api)
    webhook = api.call('getWebhookInfo', {})
    require(isinstance(webhook, dict) and webhook.get('url') == '', 'ACTIVE_WEBHOOK_REQUIRES_REVIEW')
    stored = db.execute("SELECT value FROM metadata WHERE key='offset'").fetchone()
    if not stored:
        tail = api.call('getUpdates', {'offset': -1, 'limit': 1, 'timeout': 0, 'allowed_updates': ['message', 'callback_query']})
        require(isinstance(tail, list), 'INVALID_UPDATES')
        offset = max((item.get('update_id', -1) for item in tail if type(item.get('update_id')) is int), default=-1) + 1
        db.execute("INSERT INTO metadata VALUES('offset',?)", (str(offset),))
        db.commit()
        if once:
            return {'status': 'BOT_INITIALIZED_NO_OLD_REPLIES'}
    notified = False
    while True:
        offset = int(db.execute("SELECT value FROM metadata WHERE key='offset'").fetchone()[0])
        updates = api.call('getUpdates', {'offset': offset, 'limit': 25, 'timeout': 20 if not once else 0,
                                          'allowed_updates': ['message', 'callback_query']})
        require(isinstance(updates, list) and len(updates) <= 25, 'INVALID_UPDATES')
        previous = offset - 1
        for update in updates:
            require(isinstance(update, dict) and type(update.get('update_id')) is int and update['update_id'] > previous,
                    'INVALID_UPDATE_ORDER')
            previous = update['update_id']
        if not once and not notified:
            # Polling is usable now. Price commands can take several RPC reads;
            # do not make a valid queued batch delay service startup readiness.
            ready()
            notified = True
        for update in updates:
            reply_update(db, api, update)
        if once:
            return {'status': 'BOT_POLL_COMPLETE', 'updates': len(updates)}


def unit_text(source):
    return UNIT_MARK + f'''[Unit]
Description=FTI Protocol official multilingual private-message bot
Wants=network-online.target
After=network-online.target
[Service]
Type=notify
NotifyAccess=main
TimeoutStartSec=120
DynamicUser=yes
LoadCredential=botconfig:{CONFIG}
ExecStart=/usr/bin/python3 {source} --config %d/botconfig --state /var/lib/fti-official-bot/state.sqlite3 --poll
StateDirectory=fti-official-bot
StateDirectoryMode=0700
UMask=0077
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
NoNewPrivileges=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
Restart=on-failure
RestartSec=15
[Install]
WantedBy=multi-user.target
'''


def atomic_new(path, data, mode):
    require(not path.exists() and not path.is_symlink(), 'INSTALL_PATH_ALREADY_EXISTS')
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(descriptor, 'wb') as stream:
        os.fchmod(stream.fileno(), mode)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def root_directory(path, mode=0o755):
    path = Path(path)
    # Validate each existing ancestor; never chmod an unfamiliar root directory.
    for parent in reversed((path, *path.parents)):
        if not parent.exists():
            new_mode = mode if parent == path else 0o755
            parent.mkdir(mode=new_mode)
            parent.chmod(new_mode)  # caller umask must not hide runtime source
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
                'UNSAFE_INSTALL_DIRECTORY')
        if mode == 0o755:
            require(info.st_mode & 0o001, 'PUBLIC_RELEASE_DIRECTORY_UNREADABLE')
    return path


def systemd(*args):
    timeout = 150 if args[:3] == ('systemctl', 'enable', '--now') else 45
    return subprocess.run(args, check=True, capture_output=True, timeout=timeout)


def service_ready():
    def snapshot():
        output = systemd('systemctl', 'show', '--property=Type,ActiveState,SubState,MainPID,NRestarts,Result,StatusText', SERVICE).stdout.decode()
        values = dict(line.split('=', 1) for line in output.splitlines() if '=' in line)
        require(values.get('Type') == 'notify' and values.get('ActiveState') == 'active'
                and values.get('SubState') == 'running' and values.get('Result') == 'success'
                and re.fullmatch(r'[1-9][0-9]*', values.get('MainPID', ''))
                and re.fullmatch(r'[0-9]+', values.get('NRestarts', ''))
                and values.get('StatusText') == 'Verified Telegram polling is ready', 'BOT_SERVICE_NOT_READY')
        return values
    initial = snapshot()
    time.sleep(1)
    confirmed = snapshot()
    require(all(initial[key] == confirmed[key] for key in ('MainPID', 'NRestarts')), 'BOT_SERVICE_NOT_STABLE')


def install(config_path=CONFIG):
    require(os.geteuid() == 0 and Path('/run/systemd/system').is_dir(), 'RUN_AS_ROOT_ON_SYSTEMD_VPS')
    require(Path(config_path) == CONFIG, 'CANONICAL_PRIVATE_CONFIG_REQUIRED')
    lock_fd = os.open('/run/lock/fti-official-bot-install.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'w') as install_lock:
        try:
            fcntl.flock(install_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise BotError('BOT_INSTALL_BUSY') from None
        return install_locked()


def install_locked():
    # Refuse a foreign unit before prompting or writing anything.
    target = UNITS / SERVICE
    require(not target.is_symlink(), 'UNSAFE_SERVICE_PATH')
    if target.exists():
        info = target.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022
                and target.read_text().startswith(UNIT_MARK), 'BOT_SERVICE_ALREADY_EXISTS_REQUIRES_REVIEW')
    fragment = systemd('systemctl', 'show', '--property=FragmentPath', '--value', SERVICE).stdout.decode().strip()
    require(fragment in ('', str(target)), 'BOT_SERVICE_ALREADY_EXISTS_REQUIRES_REVIEW')
    content = Path(__file__).read_bytes()
    release = RELEASES / hashlib.sha256(content).hexdigest()[:20]
    source = release / 'bot.py'
    data = unit_text(source).encode()
    if target.exists():
        require(target.read_bytes() == data, 'BOT_SERVICE_ALREADY_EXISTS_REQUIRES_REVIEW')
    created_config = False
    config_data = None
    pending_config = None
    if not CONFIG.exists():
        require(not CONFIG.is_symlink(), 'UNSAFE_CONFIG_PATH')
        require(sys.stdin.isatty() and sys.stderr.isatty(), 'PRIVATE_CONFIG_MISSING_INTERACTIVE_SETUP_REQUIRED')
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            token = getpass.getpass('Official Telegram bot token (hidden, VPS only): ').strip()
        api = TelegramAPI(token)
        validate_bot(api, channel=True)
        pending_config = {'bot_token': token, 'channel_id': CHANNEL_ID,
                          'expected_bot_id': BOT_ID, 'expected_channel_id': CHANNEL_ID}
        config_data = (json.dumps(pending_config) + '\n').encode()
    config = pending_config or config_file(CONFIG)
    api = TelegramAPI(config['bot_token'])
    validate_bot(api)
    require(api.call('getWebhookInfo', {}).get('url') == '', 'ACTIVE_WEBHOOK_REQUIRES_REVIEW')
    root_directory(RELEASES)
    root_directory(release)
    require(set(release.iterdir()) <= {source}, 'UNEXPECTED_BOT_RELEASE_CONTENT')
    created_source = not source.exists()
    if not created_source:
        info = source.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022
                and info.st_mode & 0o004 and source.read_bytes() == content, 'INSTALLED_SOURCE_MISMATCH')
    else:
        atomic_new(source, content, 0o644)
    created_unit = not target.exists()
    if not created_unit:
        require(target.read_bytes() == data, 'BOT_SERVICE_ALREADY_EXISTS_REQUIRES_REVIEW')
    try:
        if pending_config:
            root_directory(CONFIG.parent, 0o700)
            require(not CONFIG.parent.stat().st_mode & 0o077, 'UNSAFE_CONFIG_DIRECTORY')
            atomic_new(CONFIG, config_data, 0o600)
            created_config = True
        # Validate the exact service before making it visible to systemd.
        with tempfile.TemporaryDirectory(prefix='fti-official-bot-unit-') as temporary:
            candidate = Path(temporary) / SERVICE
            candidate.write_bytes(data)
            systemd('systemd-analyze', 'verify', str(candidate))
        if created_unit:
            atomic_new(target, data, 0o644)
        # This service answers newly received private commands. It never installs
        # or alters the separate channel publisher timer or post queue.
        configure_menu(api)
        systemd('systemctl', 'daemon-reload')
        systemd('systemctl', 'enable', '--now', SERVICE)
        systemd('systemctl', 'is-active', '--quiet', SERVICE)
        service_ready()
    except BaseException:
        # Only undo files created by this attempt, and only if still byte-identical.
        if created_unit and target.exists() and not target.is_symlink() and target.read_bytes() == data:
            try:
                systemd('systemctl', 'disable', '--now', SERVICE)
            except Exception:
                pass
            target.unlink()
            try:
                systemd('systemctl', 'daemon-reload')
            except Exception:
                pass
        can_cleanup = not target.exists() and not target.is_symlink()
        if can_cleanup and created_source and source.exists() and not source.is_symlink() and source.read_bytes() == content:
            source.unlink()
            try:
                release.rmdir()
            except OSError:
                pass
        if can_cleanup and created_config and CONFIG.exists() and not CONFIG.is_symlink() and CONFIG.read_bytes() == config_data:
            CONFIG.unlink()
        raise
    return {'status': 'OFFICIAL_MULTILINGUAL_BOT_ACTIVE', 'languages': list(COPY),
            'channel_schedule_created': False, 'new_private_config': created_config}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--price-preview', action='store_true')
    modes.add_argument('--publish-price', action='store_true')
    modes.add_argument('--configure-menu', action='store_true')
    modes.add_argument('--poll', action='store_true')
    modes.add_argument('--poll-once', action='store_true')
    modes.add_argument('--install', action='store_true')
    parser.add_argument('--config', type=Path, default=CONFIG)
    parser.add_argument('--state', type=Path)
    parser.add_argument('--post-id', default='price-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d'))
    args = parser.parse_args(argv)
    db = lock = None
    try:
        if args.install:
            result = install(args.config)
        elif args.price_preview:
            snapshot = chain_snapshot()
            # A preview needs no bot token, database, local writes or Telegram call.
            result = {'status': 'PRICE_TABLE_PREVIEW_NO_SEND', 'snapshot': snapshot,
                      'payload': channel_table(snapshot, [snapshot])}
        elif args.publish_price or args.poll or args.poll_once:
            config = config_file(args.config)
            api = TelegramAPI(config['bot_token'])
            db, lock = open_state(args.state or (PRICE_STATE if args.publish_price else STATE))
            if args.publish_price:
                old = db.execute('SELECT state,message_id FROM channel_posts WHERE id=?', (args.post_id,)).fetchone()
                if old:
                    require(old[0] == 'sent', 'PRICE_POST_REQUIRES_MANUAL_REVIEW')
                    result = {'status': 'ALREADY_PUBLISHED', 'post_id': args.post_id, 'message_id': old[1]}
                else:
                    snapshot = chain_snapshot()
                    remember(db, snapshot)
                    result = publish_price(db, api, channel_table(snapshot, verified_history(db, snapshot)), args.post_id)
            else:
                result = poll(db, api, once=args.poll_once)
        elif args.configure_menu:
            result = configure_menu(TelegramAPI(config_file(args.config)['bot_token']))
        else:
            result = {'status': 'PREVIEW_NO_NETWORK_NO_SEND', 'languages': LANGUAGES,
                      'commands': ['/start', '/price', '/language', '/help'],
                      'channel_language': 'en', 'channel_schedule_created': False}
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except BotError as error:
        print('FTI_OFFICIAL_BOT_STOPPED: ' + str(error), file=sys.stderr)
        return 1
    except Exception:
        print('FTI_OFFICIAL_BOT_STOPPED: LOCAL_OR_NETWORK_FAILURE', file=sys.stderr)
        return 1
    finally:
        if db is not None:
            db.close()
        if lock is not None:
            lock.close()


if __name__ == '__main__':
    raise SystemExit(main())
