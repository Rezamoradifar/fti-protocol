(() => {
  const timeoutMs = 12000;
  const copy = {
    fa: {
      loading: 'در حال بازشدن پنل FTI',
      waiting: 'اگر بارگذاری ادامه پیدا نکرد، اتصال اینترنت را بررسی کنید و صفحه را دوباره باز کنید.',
      failed: 'بازشدن پنل کامل نشد',
      error: 'دریافت یا اجرای برنامه کامل نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.',
      retry: 'تلاش دوباره',
      help: 'اگر این پیام باقی ماند، صفحه را در مرورگر تازه‌سازی کنید و آدرس صفحه و عکس خطا را برای پشتیبانی بفرستید.',
    },
    en: {
      loading: 'Opening your FTI workspace',
      waiting: 'If loading does not continue, check your connection and open this page again.',
      failed: 'The workspace did not finish opening',
      error: 'The application could not finish downloading or starting. Check your connection and try again.',
      retry: 'Try again',
      help: 'If this message remains, refresh the page in your browser and send the page address and a screenshot to support.',
    },
  };

  function start() {
    const root = document.getElementById('root');
    const fallback = root?.querySelector('[data-fti-boot]');
    if (!fallback || fallback.dataset.guarded) return;
    fallback.dataset.guarded = '1';
    let stored;
    try { stored = localStorage.getItem('fti-language'); } catch {}
    let requested;
    try { requested = new URL(location.href).searchParams.get('lang'); } catch {}
    const lang = (requested || stored || 'fa') === 'fa' ? 'fa' : 'en';
    const text = copy[lang];
    fallback.lang = lang;
    fallback.dir = lang === 'fa' ? 'rtl' : 'ltr';
    const title = fallback.querySelector('[data-fti-boot-title]');
    const message = fallback.querySelector('[data-fti-boot-message]');
    const help = fallback.querySelector('[data-fti-boot-help]');
    const retry = fallback.querySelector('[data-fti-boot-retry]');
    title.textContent = text.loading;
    message.textContent = text.waiting;
    help.textContent = text.help;
    retry.textContent = text.retry;
    retry.href = location.href;
    retry.removeAttribute('target');
    // Reload only after an explicit click. Preserve referral, language and hash.
    const reload = event => {
      event.preventDefault();
      location.reload();
    };
    retry.addEventListener('click', reload);

    const entry = document.querySelector('script[data-fti-app-entry], script[type="module"][src]');
    let timer;
    const isEmpty = () => root.childElementCount === 0 && !root.textContent.trim();
    const failed = () => {
      if (!root.contains(fallback) && isEmpty()) root.append(fallback);
      if (!root.contains(fallback)) return;
      clearTimeout(timer);
      fallback.dataset.state = 'error';
      title.textContent = text.failed;
      message.textContent = text.error;
    };
    const observer = new MutationObserver(() => {
      // React replaces the static fallback with the actual workspace. A slow
      // application may still finish after the timeout; let its own UI take over.
      if (root.querySelector('main')) {
        clearTimeout(timer);
        observer.disconnect();
        entry?.removeEventListener('error', failed);
        retry.removeEventListener('click', reload);
        fallback.remove();
      } else if (!root.contains(fallback) && isEmpty()) {
        // A render failure may clear the initial HTML before the workspace
        // mounts. Keep the static recovery instructions visible in that gap.
        root.append(fallback);
      }
    });
    observer.observe(root, {childList: true, subtree: true});
    entry?.addEventListener('error', failed);
    timer = setTimeout(failed, timeoutMs);
    if (!entry) failed();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
  else start();
})();
