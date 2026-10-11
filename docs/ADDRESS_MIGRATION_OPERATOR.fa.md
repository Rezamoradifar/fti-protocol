# اجرای مهاجرت FTI به آدرس جدید — ابزار عملیاتی

این ابزار، قرارداد مهاجرت PR #20 را به فرایند اجرایی وصل می‌کند؛ جایگزین همان‌آدرس، شبکهٔ Genesis جدید یا انتقال پول به مدیر نیست. قوانین اقتصادی و قراردادهای اصلی تغییر نمی‌کنند. فقط BNB Testnet با شناسه 97 و شبکهٔ محلی 31337 پذیرفته می‌شوند. هیچ انتقال عمومی در زمان توسعه انجام نشده است.

## ورودی معتبر

از فایل deployment اصلی نصب‌شده، نه فایل با آدرس و موجودی حدسی، استفاده کنید. فایل باید chainId، آدرس باینری/توکن/USD/شورا/Timelock، codeHashes پنج قرارداد، binaryImplementation، tokenImplementation، implementationCodeHashes، daoPartners هفت‌عضوی و deployedBlock را داشته باشد. مدل‌ها باید FundedBinaryPlanUpgradeable و FTIReserveTokenUpgradeable باشند. فایل حاوی کلید خصوصی نباشد.

اجرای `npm ci` و `npm run compile` با قفل وابستگی همین نسخه لازم است. چیدمان کامپایل‌شده باید با چیدمان بازبینی‌شده در docs/storage-layout برابر باشد. RPC باید تاریخچه و storage بلوک ثابت را کامل ارائه کند؛ جایگزین‌کردن دادهٔ ناموجود با صفر یا latest مجاز نیست.

ابزار sourceFingerprint نصب قدیمی را بازنویسی نمی‌کند. بررسی اختصاصی ابزار، هش‌های قرارداد اصلی و implementation، نقش‌ها، هفت عضو شورا، تأخیر 72 ساعته و تراکنش ایجاد هماهنگ‌کننده را کنترل می‌کند. دادهٔ ایجاد هماهنگ‌کننده باید دقیقاً با artifact همین نسخه و پارامترهای همان مبدأ تطبیق کند. این بررسی به‌تنهایی ممیزی یا اثبات کامل‌بودن تمام کلیدهای تاریخی نیست؛ سند داده باید مستقل بررسی شود.

## حالت خواندنی و آماده‌سازی

```bash
export FTI_MIGRATION_RPC_URL='YOUR_ARCHIVE_TESTNET_RPC'
node scripts/migrate-addresses.mjs --help
node scripts/migrate-addresses.mjs preflight --config SOURCE.json --out preflight-01.json
node scripts/migrate-addresses.mjs deploy --config SOURCE.json --out unsigned-deploy.json
```

این فرمان‌ها امضا نمی‌کنند. فرمان deploy بدون --send فقط دادهٔ ایجاد قرارداد را می‌نویسد. برای ارسال استقرار، گزینه‌های صریح ارسالِ بخش بعد و `--confirm` برابر آدرس باینری مبدأ لازم است. نتیجهٔ استقرار، فایل COORDINATOR.json شامل address و transactionHash واقعی است. از آدرس‌های نمونهٔ تست به‌عنوان مقصد عمومی استفاده نکنید.

## مراحل حاکمیتی، نه برداشت خودکار

قبل از freeze باید پردازش ساعتی/ماهانه و کارهای حجم تمام شوند. سپس عملیات به ترتیب freeze، arm، export، configure، copy، commit، verify و reopen انجام می‌شود. plan به‌تنهایی هیچ عملیاتی اجرا نمی‌کند:

```bash
node scripts/migrate-addresses.mjs plan --action freeze --config SOURCE.json --record COORDINATOR.json --out freeze-plan.json
node scripts/migrate-addresses.mjs plan --action arm --config SOURCE.json --record COORDINATOR.json --out arm-plan.json
node scripts/migrate-addresses.mjs export --config SOURCE.json --record COORDINATOR.json --out MANIFEST.json
node scripts/migrate-addresses.mjs plan --action configure --config SOURCE.json --record COORDINATOR.json --manifest MANIFEST.json --out configure-plan.json
```

هر plan شامل councilProposal برای پیشنهاد به شورا، operation دقیق، salt و execution است. ابتدا پیشنهاد مربوط به همان مرحله باید با پنج رأی از هفت عضو در شورا تصویب و برای Timelock زمان‌بندی شود. سپس اجرای آن عملیات پس از تأخیر واقعی ممکن می‌شود. فرمان‌های بالا را پشت‌سرهم بدون تکمیل مرحلهٔ قبلی اجرا نکنید. تأخیر 72 ساعته برای هر عملیات مشمول است؛ کل مهاجرت الزاماً 72 ساعت نیست. ابزار رأی ایجاد نمی‌کند و کلید اعضای شورا را جمع‌آوری نمی‌کند.

## ارسال صریح و محدود

copy فقط صفحات داده و فهرست دارنده‌ها را وارد می‌کند؛ انتقال پشتوانه فقط با اجرای حاکمیتی commit است. تمام فرمان‌های ارسال به --send، شبکهٔ صریح، تأیید آدرس، فایل کلید خصوصیِ 0600، بودجهٔ کل کارمزد همان اجرا و سقف قیمت gas نیاز دارند. کلید هرگز در آرگومان، گزارش یا چت قرار نگیرد. تنها مسیر فایل خصوصی ارائه شود.

```bash
node scripts/migrate-addresses.mjs copy \
  --config SOURCE.json --record COORDINATOR.json --manifest MANIFEST.json \
  --send --expected-chain 97 --confirm ACTUAL_COORDINATOR_ADDRESS \
  --key-file /private/test-gas-wallet.key \
  --max-fee-wei YOUR_APPROVED_FEE_BUDGET_WEI \
  --max-gas-price-wei YOUR_APPROVED_GAS_PRICE_CEILING_WEI \
  --max-pages 10 --max-transactions 10 --confirmations 2 \
  --journal copy-01.jsonl --out copy-01.json
```

برای ادامه، همان manifest و coordinator و فایل‌های خروجی جدید به کار می‌روند. شمارندهٔ قرارداد تعیین می‌کند از کدام صفحه ادامه یابد؛ گزارش محلی منبع حقیقت نیست. COPY_PAUSED یعنی سقف تعداد صفحات رسیده، نه شکست یا تکمیل مهاجرت. COPY_COMPLETE یعنی داده‌ها آماده‌اند، نه اینکه پول منتقل شده است. ارسال‌ها پشت‌سرهم و با انتظار رسید انجام می‌شوند. وجود تراکنش pending در کیف‌پول، اجرای دوباره را متوقف می‌کند. بعد از قطع برنامه باید ابتدا تکلیف تراکنش pending روشن شود؛ ابزار آن را کورکورانه دوباره ارسال نمی‌کند.

بودجه برای هر فراخوانی جداست و تمام سقف هزینهٔ تراکنش پیش از امضا رزرو می‌شود. اجرای مجدد، بودجهٔ جدید و صریح است؛ سقف تجمیعی مادام‌العمر ادعا نمی‌شود. فایل lock کنار config/record از دو اجرای محلی هم‌زمان جلوگیری می‌کند. پس از kill شدید، قفل ممکن است باقی بماند؛ فقط پس از بررسی عدم اجرای فرایند و تراکنش pending رفع شود.

بعد از کپی و بررسی مستقل:

```bash
node scripts/migrate-addresses.mjs plan --action commit --config SOURCE.json --record COORDINATOR.json --manifest MANIFEST.json --out commit-plan.json
```

پس از تصویب و آماده‌شدن همان operation در Timelock، فرمان execute با --action commit و --operation برابر شناسهٔ ثبت‌شده در plan و گزینه‌های ارسال بالا استفاده می‌شود. ابزار calldata دلخواه فایل را امضا نمی‌کند؛ عملیات را از وضعیت معتبر فعلی بازسازی و شناسهٔ آن را تطبیق می‌دهد. isOperationReady و شبیه‌سازی executeBatch نیز باید موفق باشند.

```bash
node scripts/migrate-addresses.mjs verify --config SOURCE.json --record COORDINATOR.json --manifest MANIFEST.json --out verified-after.json
node scripts/migrate-addresses.mjs plan --action reopen --config SOURCE.json --record COORDINATOR.json --manifest MANIFEST.json --out reopen-plan.json
```

reopen مرحله‌ای جدا با تأیید و تأخیر خودش است؛ پیش از پیشنهاد و دوباره پیش از اجرا، مقایسهٔ کامل انجام می‌شود. بعد از commit پول در مقصد است ولی قراردادها همچنان recoveryFrozen هستند. قبل از commit، abort حاکمیتی ممکن است؛ بعد از commit برگشت مبدأ به حالت قابل‌خرج مجاز نیست.

## حدود تحویل و آزمون

۱۳ آزمون سیاست ورودی، اعداد، کلید خصوصی، بودجه و ادامه در محیط توسعه اجرا و موفق شدند. آزمون EVM جدید خود ابزار را از ایجاد هماهنگ‌کننده، پیشنهاد/اجرای حاکمیتی و قطع‌و‌ادامهٔ copy تا commit، بررسی و پرداخت یک‌باره اجرا می‌کند. این آزمون کنار آزمون قرارداد مهاجرت در workflow اختصاصی اجرا می‌شود؛ نتیجهٔ همان commit در Actions منبع وضعیت موفقیت است، نه صرف وجود فایل آزمون.

قراردادهای قدیمیِ بدون پروکسی، موجودی BNB در خود مبدأ، FTI متعلق به آدرس‌های مبدأ، دیتابیس/فایل‌های خارج از زنجیره و تعویض سایت/Keeper همچنان در محدودهٔ این ابزار نیستند. کنترل صحت نسخهٔ وب/Keeper نباید برای اتصال مقصد دور زده شود. مجوزهای برداشت قبلی در آدرس جدید رضایت محسوب نمی‌شوند؛ کاربران به مجوز تازه نیاز دارند. هش تراکنش‌های قدیمی در آرشیو مبدأ باقی می‌ماند. موفقیت CI تأیید شبکهٔ اصلی یا ممیزی مستقل نیست.
