// This classic script works independently of the application modules.
(function () {
  'use strict';
  var root = document.getElementById('root');
  var preview = root && root.querySelector('[data-fti-boot]');
  if (!preview || preview.hasAttribute('data-fti-guarded')) return;
  var recovery = preview.querySelector('[data-fti-recovery]');
  var retry = preview.querySelector('[data-fti-boot-retry]');
  if (!recovery || !retry) return;
  preview.setAttribute('data-fti-guarded', '');

  var labels = {
    en: {
      member: 'Member workspace', market: 'Token market', admin: 'Protocol administration', home: 'FTI homepage',
      memberIntro: 'View your membership and network.', marketIntro: 'View the FTI price and trade from your wallet.', adminIntro: 'Open the protocol management workspace.',
      slow: 'The workspace is taking longer to open. You can wait or try again.', error: 'The workspace could not open. Check your connection and try again.', retry: 'Try again'
    },
    fa: {
      member: 'پنل اعضا', market: 'بازار توکن', admin: 'مدیریت پروتکل', home: 'صفحهٔ اصلی FTI',
      memberIntro: 'عضویت و شبکهٔ خود را ببینید.', marketIntro: 'قیمت FTI را ببینید و از طریق کیف‌پول خود معامله کنید.', adminIntro: 'به بخش مدیریت پروتکل وارد شوید.',
      slow: 'باز شدن پنل بیشتر از معمول طول کشیده است. می‌توانید منتظر بمانید یا دوباره تلاش کنید.', error: 'پنل باز نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.', retry: 'تلاش دوباره'
    },
    ar: {
      member: 'لوحة الأعضاء', market: 'سوق الرمز', admin: 'إدارة البروتوكول', home: 'صفحة FTI الرئيسية',
      memberIntro: 'اطّلع على عضويتك وشبكتك.', marketIntro: 'تابع سعر FTI وتداول من محفظتك.', adminIntro: 'افتح لوحة إدارة البروتوكول.',
      slow: 'يستغرق فتح اللوحة وقتًا أطول من المعتاد. يمكنك الانتظار أو إعادة المحاولة.', error: 'تعذّر فتح اللوحة. تحقّق من الاتصال وحاول مجددًا.', retry: 'إعادة المحاولة'
    },
    tr: {
      member: 'Üye paneli', market: 'Token piyasası', admin: 'Protokol yönetimi', home: 'FTI ana sayfası',
      memberIntro: 'Üyeliğinizi ve ağınızı görüntüleyin.', marketIntro: 'FTI fiyatını görün ve cüzdanınızdan işlem yapın.', adminIntro: 'Protokol yönetim panelini açın.',
      slow: 'Panelin açılması normalden uzun sürüyor. Bekleyebilir veya yeniden deneyebilirsiniz.', error: 'Panel açılamadı. Bağlantınızı kontrol edip yeniden deneyin.', retry: 'Yeniden deneyin'
    },
    'zh-CN': {
      member: '会员中心', market: '代币市场', admin: '协议管理', home: 'FTI 首页',
      memberIntro: '查看您的会员资格和网络。', marketIntro: '查看 FTI 价格并通过钱包交易。', adminIntro: '打开协议管理面板。',
      slow: '打开面板所需的时间比平时长。您可以等待或重试。', error: '无法打开面板。请检查网络连接后重试。', retry: '重试'
    },
    ru: {
      member: 'Кабинет участника', market: 'Рынок токена', admin: 'Управление протоколом', home: 'Главная FTI',
      memberIntro: 'Посмотрите данные о своём участии и сети.', marketIntro: 'Узнайте цену FTI и торгуйте через свой кошелёк.', adminIntro: 'Откройте панель управления протоколом.',
      slow: 'Панель открывается дольше обычного. Можно подождать или попробовать снова.', error: 'Не удалось открыть панель. Проверьте подключение и попробуйте снова.', retry: 'Попробовать снова'
    },
    es: {
      member: 'Panel de miembros', market: 'Mercado del token', admin: 'Administración del protocolo', home: 'Inicio de FTI',
      memberIntro: 'Consulta tu membresía y tu red.', marketIntro: 'Consulta el precio de FTI y opera desde tu cartera.', adminIntro: 'Abre el panel de administración del protocolo.',
      slow: 'El panel está tardando más de lo habitual. Puedes esperar o volver a intentarlo.', error: 'No se pudo abrir el panel. Comprueba la conexión y vuelve a intentarlo.', retry: 'Volver a intentar'
    }
  };

  function supported(value) {
    if (!value) return '';
    var code = value.toLowerCase();
    if (/^zh(-cn|-hans)?$/.test(code)) return 'zh-CN';
    return Object.prototype.hasOwnProperty.call(labels, code) ? code : '';
  }

  var lang = '';
  try { lang = supported(new URL(location.href).searchParams.get('lang')); } catch (e) {}
  if (!lang) {
    try { lang = supported(localStorage.getItem('fti-language')); } catch (e) {}
  }
  lang = lang || 'en';
  var text = labels[lang];
  var path = location.pathname;
  var surface = /^\/admin(?:\/|$)/.test(path) ? 'admin' : /^\/token(?:\/|$)/.test(path) ? 'market' : 'member';
  preview.lang = lang;
  preview.dir = lang === 'fa' || lang === 'ar' ? 'rtl' : 'ltr';
  function field(name) { return preview.querySelector('[data-fti-' + name + ']'); }
  function setLabel(name, value) {
    var node = field(name);
    if (node) node.textContent = value;
  }
  function link(name, route, hash) {
    var node = field('preview-' + name);
    if (!node) return;
    node.textContent = text[name];
    node.setAttribute('href', name === surface ? hash : route + '?lang=' + lang + hash);
  }
  setLabel('preview-title', text[surface]);
  setLabel('preview-description', text[surface + 'Intro']);
  link('home', '/', '');
  link('market', '/token/', '#trade');
  link('member', '/app/', '#overview');

  setLabel('boot-retry', text.retry);
  if (retry.tagName === 'A') retry.href = location.href;
  function reload(event) {
    event.preventDefault();
    location.reload();
  }
  retry.addEventListener('click', reload);
  var entry = document.querySelector('script[data-fti-app-entry]');
  var timer;
  var observer;
  function cleanup() {
    clearTimeout(timer);
    if (observer) observer.disconnect();
    if (entry) entry.removeEventListener('error', failed);
    window.removeEventListener('fti:boot-error', failed);
    window.removeEventListener('error', entryException);
    retry.removeEventListener('click', reload);
  }
  function show(state) {
    // The preview can briefly be detached during a failed render. Keep its
    // notice current in case the observer restores it to an empty root.
    preview.setAttribute('data-state', state);
    setLabel('boot-message', text[state]);
    recovery.hidden = false;
  }
  function failed() {
    clearTimeout(timer);
    show('error');
  }
  function entryException(event) {
    // An uncaught exception in a directly loaded module is reported on window.
    if (entry && event.filename && event.filename === entry.src) failed();
  }
  if (window.MutationObserver) {
    observer = new MutationObserver(function () {
      if (root.contains(preview)) return;
      if (root.querySelector('main#main')) cleanup();
      else if (!root.firstElementChild && !root.textContent.trim()) root.appendChild(preview);
    });
    observer.observe(root, {childList: true, subtree: true});
  }
  window.addEventListener('fti:boot-error', failed);
  window.addEventListener('error', entryException);
  if (entry) entry.addEventListener('error', failed);
  if (!entry || !('noModule' in document.createElement('script')) || entry.hasAttribute('data-fti-boot-failed')) failed();
  else timer = setTimeout(function () { show('slow'); }, 18000);
})();
