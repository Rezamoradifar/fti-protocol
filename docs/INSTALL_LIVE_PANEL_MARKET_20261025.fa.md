# نصب به‌روزرسانی پنل و ربات رسمی FTI

روی همان VPS پروژه FTI، در ترمینال تعاملی و با کاربر root اجرا شود. هر دو فایل پیش از تغییر سرویس دانلود و با SHA256 بررسی می‌شوند. خروجی `ROLLBACK_COMMAND` را نگه دارید.

نسخه کد: `e10a37a4a227666df4b821ee68ff27baed97ee87`.

```bash
(
  set -euo pipefail
  if [ "$(id -u)" -ne 0 ]; then
    printf 'Run on the FTI VPS as root.\n' >&2
    exit 1
  fi

  fti_market_dir="$(mktemp -d /tmp/fti-live-panel.XXXXXX)"
  trap 'rm -f -- "$fti_market_dir/panel.py" "$fti_market_dir/bot.py"; rmdir -- "$fti_market_dir"' EXIT
  fti_market_base='https://raw.githubusercontent.com/Rezamoradifar/fti-protocol/e10a37a4a227666df4b821ee68ff27baed97ee87'

  curl --fail --silent --show-error --location --connect-timeout 10 --max-time 90 \
    "$fti_market_base/tools/install-panel-completion-release.py" --output "$fti_market_dir/panel.py"
  curl --fail --silent --show-error --location --connect-timeout 10 --max-time 60 \
    "$fti_market_base/tools/fti-official-bot.py" --output "$fti_market_dir/bot.py"

  printf '%s  %s\n' \
    '92bd4e7171d300ed47a3ca93ae097b917701c5fc035441460107208aa00e1ffd' "$fti_market_dir/panel.py" \
    '0bcf23121c266be8dd8536142105a484abae0d94710e242cca06eca76e209e92' "$fti_market_dir/bot.py" | sha256sum --check -

  python3 "$fti_market_dir/panel.py"
  python3 "$fti_market_dir/bot.py" --price-preview
  python3 "$fti_market_dir/panel.py" --apply
  python3 "$fti_market_dir/bot.py" --install
  python3 "$fti_market_dir/bot.py" --publish-price --post-id price-20261025
  systemctl is-active fti-continuity-web.service fti-official-bot.service
)
```

اگر تنظیم خصوصی ربات از قبل روی سرور نباشد، نصب‌کننده توکن را به‌صورت مخفی در همان ترمینال درخواست می‌کند. توکن را داخل چت یا دستور بالا قرار ندهید. ربات و کانال باید همان هویت رسمی باشند و ربات مجوز انتشار کانال داشته باشد.

وب پس از پیش‌بررسی یک بار ری‌استارت می‌شود. علامت موفقیت وب `FTI_PANEL_COMPLETION_INSTALLED_WEB_RESTARTED` است؛ اجرای دوباره `FTI_PANEL_COMPLETION_ALREADY_INSTALLED` می‌دهد. نصب ربات پس از اولین polling معتبر و ثبات سرویس، `OFFICIAL_MULTILINGUAL_BOT_ACTIVE` را اعلام می‌کند. جدول انگلیسی کانال یک بار با شناسه `price-20261025` منتشر می‌شود؛ اجرای دوباره پست تکراری نمی‌سازد. این دستور زمان‌بندی انتشار روزانه ایجاد نمی‌کند.

در صورت وجود webhook فعال، ربات آن را حذف نمی‌کند و نصب برای بررسی متوقف می‌شود. نصب وب و ربات، تراکنش خرید، فروش، انتقال یا تغییر قرارداد انجام نمی‌دهد. پس از اجرا، خروجی را برای بررسی نسخه عمومی سایت و پاسخ واقعی ربات نگه دارید.
