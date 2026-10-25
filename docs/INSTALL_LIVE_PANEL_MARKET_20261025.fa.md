# نصب به‌روزرسانی پنل و ربات رسمی FTI

روی همان VPS پروژه FTI، در ترمینال تعاملی و با کاربر root اجرا شود. وب و تلگرام دو مرحله مستقل دارند؛ خطای دسترسی تلگرام یا RPC پیش‌نمایش ربات نباید نصب وب را متوقف کند. خروجی `ROLLBACK_COMMAND` را نگه دارید.

نسخه کد هر دو فایل: `e10a37a4a227666df4b821ee68ff27baed97ee87`. هر فایل با SHA256 بررسی می‌شود.

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
    'https://raw.githubusercontent.com/Rezamoradifar/fti-protocol/e10a37a4a227666df4b821ee68ff27baed97ee87/tools/install-panel-completion-release.py' \
    --output "$fti_panel_fix"
  printf '%s  %s\n' \
    '92bd4e7171d300ed47a3ca93ae097b917701c5fc035441460107208aa00e1ffd' \
    "$fti_panel_fix" | sha256sum --check -
  python3 "$fti_panel_fix"
  python3 "$fti_panel_fix" --apply
)
```

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
