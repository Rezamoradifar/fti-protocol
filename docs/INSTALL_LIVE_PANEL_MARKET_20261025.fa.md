# نصب به‌روزرسانی پنل و ربات رسمی FTI

روی همان VPS پروژه FTI، در ترمینال تعاملی و با کاربر root اجرا شود. وب و تلگرام دو مرحله مستقل دارند؛ خطای دسترسی تلگرام یا RPC پیش‌نمایش ربات نباید نصب وب را متوقف کند. خروجی `ROLLBACK_COMMAND` را نگه دارید.

نسخه نصب‌کننده وب: `5f82f09a519ead7ec03263ba47cfa15dcfbcf28e`؛ نسخه ربات: `e10a37a4a227666df4b821ee68ff27baed97ee87`. هر فایل با SHA256 بررسی می‌شود.

## ۱. نصب مستقل وب

این مرحله به دانلود ربات، توکن تلگرام یا پیش‌نمایش قیمت ربات وابسته نیست. پیش‌بررسی خود نصب‌کننده قبل از اعمال اجرا می‌شود؛ در صورت خطا، مرحله اعمال اجرا نمی‌شود.

```bash
(
  set -euo pipefail
  [ "$(id -u)" -eq 0 ] || { printf 'Run on the FTI VPS as root.\n' >&2; exit 1; }
  fti_panel_fix="$(mktemp /tmp/fti-live-panel.XXXXXX)"
  trap 'rm -f -- "$fti_panel_fix"' EXIT
  curl --fail --silent --show-error --location \
    --connect-timeout 10 --max-time 90 \
    'https://raw.githubusercontent.com/Rezamoradifar/fti-protocol/5f82f09a519ead7ec03263ba47cfa15dcfbcf28e/tools/install-panel-completion-release.py' \
    --output "$fti_panel_fix"
  printf '%s  %s\n' \
    'aeb26f34f6ca3d28b30d666f663f8c6c15f6ff4c77fd0fe1d34aed90366a31e8' \
    "$fti_panel_fix" | sha256sum --check -
  python3 "$fti_panel_fix"
  python3 "$fti_panel_fix" --apply
)
```

اصلاح ۲۶ اکتبر: سقف قدیمی ۱۰۰ مگابایت یا ۴۰۰۰ فایل برای هر پوشه، به بودجه کلی محدود ۱ گیگابایت و ۱۲۰۰۰ فایل و پوشه تبدیل شده است. نصب‌کننده پیش از هر نوشتن، مسیرهای عمومی را شمارش و فضای آزاد و inode لازم را از حجم واقعی و حاشیه ۶۴ مگابایت محاسبه می‌کند. خطوط `FTI_PANEL_COMPLETION_PUBLIC_COPY_PLAN` حجم و تعداد هر مسیر را نشان می‌دهند. فایل‌های نسخه‌های پیشین حذف نمی‌شوند؛ کنترل لینک، فایل پنهان، اندازه تک‌فایل و تغییر هم‌زمان منبع پابرجاست. این اصلاح فایل‌های برنامه، قرارداد و هویت نسخه را تغییر نمی‌دهد.

علامت موفقیت `FTI_PANEL_COMPLETION_INSTALLED_WEB_RESTARTED` است؛ اجرای دوباره `FTI_PANEL_COMPLETION_ALREADY_INSTALLED` می‌دهد. نسخه عمومی باید entry زیر را ارائه کند:

`/fti-panel-completion-13aa86ae47e035b4e23f/entry.js`

## ۲. نصب مستقل ربات و انتشار جدول

پس از پایان مرحله وب، این دستور جداگانه اجرا شود. خطای این مرحله وب را برنمی‌گرداند. برای انتشار جدول، خود ربات قیمت تازه و معتبر را از قرارداد بررسی می‌کند؛ پیش‌نمایش جداگانه پیش‌شرط نصب وب نیست.

```bash
(
  set -euo pipefail
  [ "$(id -u)" -eq 0 ] || { printf 'Run on the FTI VPS as root.\n' >&2; exit 1; }
  fti_bot_fix="$(mktemp /tmp/fti-official-bot.XXXXXX)"
  trap 'rm -f -- "$fti_bot_fix"' EXIT
  curl --fail --silent --show-error --location \
    --connect-timeout 10 --max-time 60 \
    'https://raw.githubusercontent.com/Rezamoradifar/fti-protocol/e10a37a4a227666df4b821ee68ff27baed97ee87/tools/fti-official-bot.py' \
    --output "$fti_bot_fix"
  printf '%s  %s\n' \
    '0bcf23121c266be8dd8536142105a484abae0d94710e242cca06eca76e209e92' \
    "$fti_bot_fix" | sha256sum --check -
  python3 "$fti_bot_fix" --install
  python3 "$fti_bot_fix" --publish-price --post-id price-20261025
  systemctl is-active fti-official-bot.service
)
```

اگر تنظیم خصوصی ربات از قبل روی سرور نباشد، نصب‌کننده توکن را به‌صورت مخفی در همان ترمینال درخواست می‌کند. توکن را داخل چت یا دستور بالا قرار ندهید. ربات و کانال باید همان هویت رسمی باشند و ربات مجوز انتشار کانال داشته باشد.

نصب ربات پس از اولین polling معتبر و ثبات سرویس، `OFFICIAL_MULTILINGUAL_BOT_ACTIVE` را اعلام می‌کند. جدول انگلیسی کانال یک بار با شناسه `price-20261025` منتشر می‌شود؛ اجرای دوباره پست تکراری نمی‌سازد. این دستور زمان‌بندی انتشار روزانه ایجاد نمی‌کند.

در صورت وجود webhook فعال، ربات آن را حذف نمی‌کند و نصب برای بررسی متوقف می‌شود. نصب وب و ربات، تراکنش خرید، فروش، انتقال یا تغییر قرارداد انجام نمی‌دهد. اگر هر مرحله متوقف شد، خروجی نهایی همان مرحله برای تشخیص لازم است؛ هیچ بررسی هویت یا fingerprint را دور نزنید.
