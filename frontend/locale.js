export const language=(()=>{try{return localStorage.getItem('fti-language')==='en'?'en':'fa';}catch{return 'fa';}})();
export function t(value,fa){const s=String(value);if(language==='en')return s;return fa||translations[s]||dynamicText(s);}
export function initializeLanguage(){document.documentElement.lang=language;document.documentElement.dir=language==='fa'?'rtl':'ltr';}
const translations=Object.fromEntries(`
Sequential $500 steps use updated reserve/supply prices. 3% fee per step; up to 128 steps per transaction. Membership and cycle allowances apply.|خرید در پله‌های ۵۰۰ دلاری با قیمت جدید هر پله انجام می‌شود؛ کارمزد هر پله ۳٪ و حداکثر ۱۲۸ پله در تراکنش است. مجوز عضویت و چرخه اعمال می‌شود.
Connect to view your balance and allowance.|برای مشاهده موجودی و مجوز خرید، ولت را متصل کنید.
PROTOCOL|پروتکل
EXPLORE FTI|فضاهای FTI
Main website|صفحه اصلی
Member dashboard|پنل اعضا
FTI token|توکن FTI
Administration|شورا و مدیریت
Connecting…|در حال اتصال…
← Back to website|بازگشت به صفحه اصلی
Test assets only|فقط دارایی آزمایشی
Connect wallet|اتصال ولت
YOUR ON-CHAIN WORKSPACE|فضای شخصی شما روی شبکه
Everything connected.|یک ولت، یک فضای یکپارچه.
Everything in view.|همه چیز در دسترس شما.
Connect your wallet to see your balances, manage membership and trade FTI.|برای مشاهده موجودی، مدیریت جایگاه و معامله توکن، ولت خود را متصل کنید.
Trade FTI|خرید و فروش FTI
Your membership|جایگاه شما
YOUR MEMBERSHIP|عضویت شما
Not connected|ولت متصل نیست
Your rank and progression will appear here.|رنک و مسیر پیشرفت شما اینجا نمایش داده می‌شود.
— matched lifetime points|— پوینت متوازن کل
View your network|مشاهده شبکه شما
Your balances|موجودی‌های شما
Waiting for contract data|در انتظار اطلاعات قرارداد
FTI balance|موجودی FTI
FTI in your wallet|توکن‌های موجود در ولت
Manage tokens|مدیریت توکن‌ها
Available to sell|قابل فروش
Connect to view token locks|برای مشاهده موجودی، ولت را متصل کنید
View unlock schedule|بررسی موجودی قابل فروش
Test USD balance|موجودی دلار آزمایشی
MockUSD · test asset|MockUSD · دارایی آزمایشی
Get test USD|دریافت دلار آزمایشی
Claimable rewards|پاداش قابل دریافت
Test USD ready to claim|دلار آزمایشی آماده پرداخت
Claim rewards|دریافت پاداش
Your wallet|ولت شما
No wallet connected|ولتی متصل نشده است
Manual purchase allowance remaining|سقف خرید باقیمانده
Purchased membership units|واحدهای عضویت خریداری‌شده
Network|شبکه
Copy address|کپی آدرس
Manage membership|مدیریت عضویت
Getting started|شروع در سه قدم
3 STEPS|۳ قدم
Connect your wallet|ولت خود را متصل کنید
Use a test wallet on the correct network.|از ولت آزمایشی روی شبکه صحیح استفاده کنید.
Get test assets|دارایی آزمایشی بگیرید
Claim test USD here; use test BNB for gas.|دلار آزمایشی را اینجا بگیرید؛ کارمزد شبکه با BNB آزمایشی پرداخت می‌شود.
Join with a sponsor|با آدرس معرف عضو شوید
Register a position to unlock token purchases.|با ثبت جایگاه و خرید واحد، امکان خرید توکن فعال می‌شود.
Protocol snapshot|نمای زنده پروتکل
Read directly from the deployed contracts|اطلاعات مستقیم از قراردادهای نصب‌شده
Internal FTI price|قیمت داخلی FTI
Real reserve · USD|ذخیره قیمت‌گذاری · دلار
Registered positions|جایگاه‌های ثبت‌شده
Accounting check|تطابق حسابداری
MEMBERSHIP & NETWORK|عضویت و شبکه
Build your position.|جایگاه خود را فعال کنید.
Understand your branches.|شاخه‌ها را شفاف ببینید.
Each unit costs 100 test USD. Your position and branch volume are recorded on-chain.|هر واحد ۱۰۰ دلار آزمایشی است. جایگاه و حجم شاخه‌ها روی شبکه ثبت می‌شوند.
Join the network|عضویت در شبکه
100 USD / UNIT|۱۰۰ دلار / واحد
Sponsor address|آدرس ولت معرف
New positions fill the sponsor’s left slot first, then the right. Both slots must not be full.|جایگاه جدید ابتدا در شاخه چپ معرف و سپس راست قرار می‌گیرد. معرف باید جای خالی داشته باشد.
Number of units|تعداد واحدها
Total contribution|مبلغ کل
100 test USD|۱۰۰ دلار آزمایشی
Register membership|ثبت عضویت
Your wallet may request a USD approval before registration. Existing members add units to their current position.|پیش از ثبت ممکن است مجوز خرج‌کردن دلار نیاز باشد. اعضای فعلی به همان جایگاه واحد اضافه می‌کنند.
Your direct network|شبکه مستقیم شما
LEFT / RIGHT|چپ / راست
Your position|جایگاه شما
Purchased units|واحدهای خریداری‌شده
Lifetime volume · left / right|حجم کل · چپ / راست
Carried volume · left / right|حجم انتقالی · چپ / راست
This view shows your sponsor and immediate children, not the full downline.|این نما معرف و دو زیرمجموعه مستقیم را نمایش می‌دهد.
YOUR INVITATION|دعوت‌نامه شما
A direct path to registration.|یک لینک برای عضویت در شبکه شما.
Share your membership link. Registration still checks available positions on-chain.|لینک عضویت را به اشتراک بگذارید. ظرفیت جایگاه هنگام ثبت روی شبکه بررسی می‌شود.
Copy invitation link|کپی لینک دعوت
FTI EXCHANGE|خرید و فروش توکن
Your tokens.|توکن‌های شما.
Your next move.|معامله با اطلاعات روشن.
Trade against the protocol curve. Quotes reflect current contract values and can change before confirmation.|قیمت از ذخیره و عرضه قرارداد محاسبه می‌شود. نرخ پیشنهادی ممکن است پیش از تأیید تغییر کند.
Connect a registered wallet to trade.|برای خرید، ولت عضو شبکه را متصل کنید.
Buy FTI|خرید FTI
You pay · test USD|مبلغ پرداختی · دلار آزمایشی
Wallet balance and allowance appear after connection.|پس از اتصال، موجودی و سقف خرید نمایش داده می‌شوند.
Maximum slippage (%)|حداکثر تغییر قیمت مجاز (%)
Enter an amount for a live quote.|مبلغ را وارد کنید تا نرخ زنده نمایش داده شود.
Confirm FTI purchase|تأیید خرید FTI
Membership and rank purchase limits apply. V3 has no time or wallet-count locks.|سقف خرید عضویت و رنک اعمال می‌شود. در V3 قفل زمانی یا شرط تعداد ولت وجود ندارد.
Sell FTI|فروش FTI
You sell · FTI|مقدار فروش · FTI
Available: — FTI|قابل فروش: — FTI
Use available|کل موجودی
Confirm FTI sale|تأیید فروش FTI
Token availability|موجودی قابل استفاده
Total FTI|کل FTI
Available FTI|FTI قابل فروش
Locked FTI|FTI قفل‌شده
FTI amount|مقدار FTI
Wallet threshold|آستانه ولت
Time deadline (UTC)|مهلت زمانی (UTC)
Status|وضعیت
Previous locks|صفحه قبل
Next locks|صفحه بعد
Transfer FTI|انتقال FTI
Recipient address|آدرس ولت گیرنده
Enter an amount to see the recipient amount and burn.|مقدار را وارد کنید تا دریافتی گیرنده و مقدار سوزاندن مشخص شود.
REWARDS & SETTLEMENT|پاداش‌ها و تسویه
Track your allocation.|پاداش‌های شما، قابل پیگیری.
Choose your next step.|پرداخت نقدی یا خرید خودکار.
Rewards come from funded pools and eligible matched points. A membership is not a guaranteed income.|پاداش از وجوه تأمین‌شده و پوینت‌های واجد شرایط محاسبه می‌شود. عضویت تضمین درآمد نیست.
READY TO CLAIM · TEST USD|آماده دریافت · دلار آزمایشی
Allocated cash available to your connected wallet.|پاداش نقدی تخصیص‌یافته به ولت متصل شما.
Claim to wallet|پرداخت به ولت
Settlement status|وضعیت تسویه
Binary point pool · USD|صندوق پوینت باینری · دلار
Processing phase|مرحله پردازش
Protection level|سطح حفاظت پوینت
Epoch boundary (UTC)|پایان دوره (UTC)
Settlement needs on-chain processing. Reaching the time boundary alone does not allocate rewards.|تسویه با تراکنش‌های پردازش روی شبکه انجام می‌شود. رسیدن زمان پایان، به‌تنهایی پاداش تخصیص نمی‌دهد.
Reward · pay all finalized cash|پرداخت پاداش‌های نهایی‌شده
Fixed beneficiary amounts are paid in batches of up to 100 wallets. Remaining entries persist for the keeper. Optional auto-buy funds stay reserved.|مبالغ نهایی در هر تراکنش برای حداکثر ۱۰۰ ولت پرداخت می‌شوند. باقیمانده در صف Keeper می‌ماند؛ وجه اتوبای جدا نگهداری می‌شود.
Reading payout queue…|در حال خواندن صف پرداخت…
Reward · start payout batch|شروع پرداخت دسته‌ای
Auto-buy preferences|تنظیمات خرید خودکار
When enabled, 5% of eligible hourly rewards is reserved for FTI purchases. Set the highest price you are willing to pay.|با فعال‌سازی، ۵٪ پاداش ساعتی واجد شرایط برای خرید FTI کنار گذاشته می‌شود. سقف قیمت خرید را تعیین کنید.
Enable auto-buy|فعال‌سازی خرید خودکار
Maximum price · USD per FTI|حداکثر قیمت · دلار به ازای FTI
Save preference|ذخیره تنظیمات
Pending auto-buy · test USD|وجه خرید خودکار در انتظار · دلار آزمایشی
Buy with pending funds|خرید با وجه کنارگذاشته‌شده
Move funds to claimable|انتقال وجه به پاداش نقدی
How your rewards are funded|منبع تأمین پاداش شما
Retained point reserve · USD|ذخیره نگهداری‌شده پوینت · دلار
Retained builder reserve · USD|ذخیره نگهداری‌شده بیلدر · دلار
Your left / right funded credits · USD|اعتبار شاخه‌ها · چپ / راست
Retained reserves are not claimable member balances. Builder payments use attributed monthly credits, not old global carry.|ذخایر نگهداری‌شده موجودی قابل برداشت اعضا نیستند. پرداخت بیلدر بر پایه اعتبار ماهانه منتسب به شاخه‌هاست.
Protocol reserve accounts|حساب‌های ذخیره پروتکل
Trading reserve · USD|ذخیره قیمت‌گذاری · دلار
Reserve support · USD|صندوق حمایت قیمت · دلار
Floor support · USD|حمایت کف قیمت · دلار
Real FTI supply|عرضه واقعی FTI
THE FTI TOKEN · TESTNET|توکن FTI · شبکه آزمایشی
A token with|توکن با سازوکار
visible mechanics.|شفاف و قابل مشاهده.
Explore the curve, inspect reserves and manage FTI from your wallet. A dedicated space for the token economy.|ذخیره‌ها را بررسی کنید، نرخ زنده بگیرید و FTI را مستقیم از ولت مدیریت کنید.
Buy & sell FTI|خرید و فروش FTI
Understand the rules ↗|آشنایی با قوانین ↗
ON-CHAIN / BNB|روی شبکه BNB
Live token snapshot|نمای زنده توکن
Current deployed contract · test assets|قرارداد فعال · دارایی آزمایشی
Curve spot price|قیمت داخلی توکن
Test USD / FTI|دلار آزمایشی / FTI
Real reserve|ذخیره قیمت‌گذاری
Test USD · excludes virtual reserve|دلار آزمایشی ثبت‌شده در قرارداد
Real token supply|عرضه واقعی توکن
FTI minted to wallets|FTI صادرشده برای ولت‌ها
Trading state|وضعیت معاملات
Reported by the token contract|گزارش مستقیم قرارداد توکن
01 / BUY|۰۱ / خرید
Reserve in.|وجه به ذخیره می‌رود.
Tokens minted.|توکن صادر می‌شود.
Registered wallets with purchased units can buy along the curve. Review the fee, allowance and minimum output before approving.|اعضای دارای واحد می‌توانند طبق سقف رنک خرید کنند. کارمزد، سقف خرید و حداقل دریافتی را پیش از تأیید بررسی کنید.
Get a live quote|دریافت نرخ زنده
02 / HOLD|۰۲ / نگهداری
Know what|موجودی خود را
is available.|شفاف ببینید.
Check token availability|بررسی موجودی قابل فروش
03 / SELL|۰۳ / فروش
Tokens burned.|توکن سوزانده می‌شود.
Reserve paid out.|وجه به ولت می‌رود.
Review a sale|بررسی نرخ فروش
Reserve support accounts|ذخیره و صندوق حمایت
Reserve support fund · USD|صندوق حمایت قیمت · دلار
Floor support fund · USD|حمایت کف قیمت · دلار
Reserve ratio|مدل قیمت‌گذاری
Permanently locked FTI|توکن دائماً قفل‌شده
Check the deployment|بررسی قراردادهای فعال
Checking network…|در حال بررسی شبکه…
These are the currently configured contract addresses.|آدرس قراردادها از تنظیمات همین سرویس خوانده می‌شوند.
Loading token address…|در حال خواندن آدرس توکن…
Token explorer ↗|مشاهده توکن در اکسپلورر ↗
Read source ↗|مشاهده کد قرارداد ↗
Your membership opens the door.|عضویت، مسیر ورود شماست.
Manage your registration, units and rewards in the separate member dashboard.|عضویت، واحدها و پاداش‌ها را از پنل اعضا مدیریت کنید.
Open member dashboard →|ورود به پنل اعضا
ON-CHAIN RECORD|رویدادهای شبکه
Follow the activity.|فعالیت‌ها را دنبال کنید.
Recent protocol events from the latest 1,500 blocks. This is not your complete wallet history.|رویدادهای پروتکل در ۱۵۰۰ بلاک اخیر نمایش داده می‌شوند؛ این فهرست تاریخچه کامل ولت نیست.
Protocol activity|فعالیت پروتکل
Refresh events|به‌روزرسانی رویدادها
Open activity to load recent events.|برای خواندن رویدادها، این بخش را باز کنید.
PROTOCOL OPERATIONS|عملیات پروتکل
Governance.|شورا و مدیریت.
Visible and verifiable.|شفاف و قابل بررسی.
Settlement processing is permissionless. Governance actions require the roles enforced by the contracts.|پردازش تسویه برای همه آزاد است. عملیات شورا به نقش مجاز در قرارداد نیاز دارد.
READ ONLY|فقط مشاهده
Wallet-based administration|مدیریت با نقش ولت
Connect a wallet to check its council role.|ولت را متصل کنید تا نقش آن در شورا بررسی شود.
Settlement processing|پردازش تسویه
The caller pays transaction gas. Controls only succeed when the current phase permits the operation.|کارمزد شبکه را اجراکننده می‌پردازد. هر عملیات فقط در مرحله مجاز قرارداد انجام می‌شود.
Local chain time controls|کنترل زمان شبکه محلی
Advance one hour|یک ساعت جلو بردن زمان
Advance 92 days|۹۲ روز جلو بردن زمان
5-of-7 governance|شورای ۵ از ۷
Operation|نوع عملیات
Emergency registration pause|توقف اضطراری ثبت عضویت
Emergency trading pause|توقف اضطراری معاملات
Schedule registration unpause|زمان‌بندی رفع توقف عضویت
Schedule token unpause|زمان‌بندی رفع توقف معاملات
Schedule allowance multiplier increase|زمان‌بندی افزایش سقف خرید
Create proposal|ثبت پیشنهاد
Execute after timelock|اجرا پس از قفل زمانی
Scheduling proposal ID|شناسه پیشنهاد زمان‌بندی
Execute ready operation|اجرای عملیات آماده
Deployed contracts|قراردادهای فعال
Skip to workspace|رفتن به محتوای اصلی
TESTNET|شبکه آزمایشی
Test assets only. No guaranteed income, token price or repayment.|دارایی‌ها آزمایشی‌اند؛ درآمد، قیمت توکن یا بازپرداخت تضمین نمی‌شود.
Explore the protocol ↗|آشنایی با پروتکل ↗
Reading contracts…|در حال خواندن قراردادها…
View transaction ↗|مشاهده تراکنش ↗
Website|صفحه اصلی
Source code ↗|کد منبع ↗
Overview|نمای کلی
Membership|عضویت و شبکه
Rewards|پاداش‌ها
Activity|فعالیت‌ها
Token overview|نمای توکن
Buy & sell|خرید و فروش
Management|شورا و مدیریت
MEMBER WORKSPACE|پنل اعضا
FTI TOKEN|توکن FTI
PROTOCOL ADMINISTRATION|شورا و مدیریت
Member|عضو
Builder 1|بیلدر ۱
Builder 2|بیلدر ۲
Builder 3|بیلدر ۳
Builder 4|بیلدر ۴
Active|فعال
Paused|متوقف
Balanced|تطابق کامل
Review required|نیاز به بررسی
Enabled|فعال
Disabled|غیرفعال
Not registered|عضو نشده
Registered member|عضو شبکه
Add membership units|افزودن واحد به جایگاه
Add units|افزودن واحد
Sponsor|معرف
Left branch|شاخه چپ
Right branch|شاخه راست
Empty position|جایگاه خالی
Connect to view|برای مشاهده متصل شوید
No time locks|بدون قفل زمانی
Reserve / FTI|ذخیره / FTI
Real-reserve pricing|قیمت‌گذاری بر پایه ذخیره واقعی
Pricing model|مدل قیمت‌گذاری
Accepting deposits|پذیرش خرید واحد
Matching points|تطبیق پوینت‌ها
Allocating rewards|تخصیص پاداش‌ها
Processing|در حال پردازش
COUNCIL OWNER|عضو شورا
PUBLIC CALLER|اجراکننده عمومی
Approve|تأیید
Execute proposal|اجرای پیشنهاد
Pending|در انتظار
Executed|اجرا شده
No governance proposals yet.|هنوز پیشنهادی ثبت نشده است.
Connect your wallet first.|ابتدا ولت خود را متصل کنید.
Refreshing wallet data before your request…|در حال به‌روزرسانی اطلاعات ولت…
Review the request in your wallet.|درخواست را در ولت خود بررسی کنید.
Transaction confirmed on-chain.|تراکنش روی شبکه تأیید شد.
Approve test USD spending in your wallet.|مجوز خرج‌کردن دلار آزمایشی را در ولت تأیید کنید.
Request cancelled in your wallet.|درخواست در ولت لغو شد.
Contract data refreshed.|اطلاعات قرارداد به‌روزرسانی شد.
Copied to clipboard.|کپی شد.
Wallet connected. Contract data loaded.|ولت متصل شد و اطلاعات قرارداد خوانده شد.
Contract data loaded. Connect a wallet to manage your account.|اطلاعات قرارداد خوانده شد. برای مدیریت حساب، ولت را متصل کنید.
Updating quote…|در حال دریافت نرخ…
Updating transfer quote…|در حال محاسبه انتقال…
No active locks|بدون قفل فعال
V3 does not create time or wallet-count lock tranches.|در V3 قفل زمانی یا شرط تعداد ولت وجود ندارد.
Your sponsor and position stay unchanged when you add units.|با افزودن واحد، معرف و جایگاه شما تغییر نمی‌کند.
Open this site in your wallet’s browser or use a browser with a wallet extension.|این سایت را در مرورگر ولت یا مرورگر دارای افزونه ولت باز کنید.
Switch your wallet to BNB Testnet and connect again.|شبکه ولت را روی BNB Testnet قرار دهید و دوباره متصل شوید.
Permanent emergency pro-rata redemption|فعال‌سازی بازپرداخت اضطراری دائمی
Process volume|پردازش حجم شاخه‌ها
Close epoch|بستن دوره ساعتی
Process settlement|پردازش پاداش‌های ساعتی
Close month|بستن ماه بیلدر
Process monthly rewards|پردازش پاداش ماهانه
`.trim().split('\n').map(row=>{const i=row.indexOf('|');return[row.slice(0,i),row.slice(i+1)];}));
Object.assign(translations,{
 'Your next step, in one place.':'قدم بعدی، همین‌جا در دسترس شماست.',
 'Access follows your role.':'دسترسی بر اساس نقش ولت شماست.',
 'Understand the token.':'سازوکار توکن را بشناسید.',
 'START HERE':'از اینجا شروع کنید', 'WALLET ROLES':'نقش‌های ولت',
 'Council proposals require an authorized owner. Settlement calls remain permissionless.':'پیشنهادهای شورا به ولت مجاز نیاز دارند؛ پردازش تسویه برای همه آزاد است.',
 'Explore the rules, connect your wallet and review each transaction.':'قوانین را بررسی کنید، ولت را متصل کنید و هر تراکنش را پیش از تأیید بخوانید.',
 'Explore FTI token':'مشاهده توکن FTI',
 'V3 has no time locks. Your token balance is available subject to pauses, emergency state and sale limits.':'V3 قفل زمانی ندارد. موجودی شما طبق وضعیت توقف، حالت اضطراری و محدودیت‌های فروش قابل استفاده است.',
 'The live quote includes the 3% sell fee. Gross sales up to $500 and full-supply exits are exempt from ordinary limits.':'نرخ زنده کارمزد ۳٪ فروش را لحاظ می‌کند. فروش ناخالص تا ۵۰۰ دلار و خروج کل عرضه از سقف‌های عادی معاف‌اند.',
 'Transfer to any valid wallet. The recipient receives 97% and 3% is burned.':'انتقال به هر ولت معتبر ممکن است؛ گیرنده ۹۷٪ می‌گیرد و ۳٪ سوزانده می‌شود.',
 'Contract addresses and network are read from this application’s deployment configuration.':'آدرس قراردادها و شبکه از تنظیمات استقرار همین برنامه خوانده می‌شوند.',
 'Trade against the protocol reserve. Quotes reflect current contract values and can change before confirmation.':'قیمت از ذخیره و عرضه قرارداد محاسبه می‌شود. نرخ پیشنهادی ممکن است پیش از تأیید تغییر کند.',
 'Explore pricing, inspect reserves and manage FTI from your wallet. A dedicated space for the token economy.':'نرخ و ذخیره‌ها را بررسی کنید و FTI را مستقیم از ولت خود مدیریت کنید.',
 'Reserve and price support':'ذخیره و صندوق حمایت قیمت',
 '3% fee. Gross sales up to $500 and final full-supply exits are exempt from ordinary sale limits. Minimum output and deadline always apply.':'کارمزد ۳٪. فروش ناخالص تا ۵۰۰ دلار و خروج نهایی کل عرضه از محدودیت‌های عادی معاف‌اند. حداقل دریافتی و مهلت همیشه اعمال می‌شوند.',
 'V3 tokens have no time or wallet-count locks. Pauses, emergency state and sale limits still apply.':'توکن V3 قفل زمانی یا شرط تعداد ولت ندارد. توقف، حالت اضطراری و محدودیت فروش همچنان اعمال می‌شوند.',
 'Reserve / supply · $0.10 first cycle, $0.20 restarts':'ذخیره / عرضه · آغاز ۰٫۱۰، چرخه بعد ۰٫۲۰ دلار',
 'No premint or time locks. Ordinary trade fees stay in reserve. Support is used only on a price drop, with the minimum available injection. Final-exit fees and remaining support go to development. Each new cycle starts with a $0.20 bootstrap quote.':'بدون پیش‌صدور و قفل زمانی. کارمزد معاملات عادی در ذخیره می‌ماند. حمایت فقط هنگام افت قیمت و با حداقل تزریق قابل تأمین مصرف می‌شود. کارمزد خروج نهایی و مانده حمایت به توسعه می‌روند. هر چرخه جدید با نرخ آغاز ۰٫۲۰ دلار شروع می‌شود.',
 'Reserve/share quotes, 3% fee. Sales above $500 retain 5% single-sale and 20% hourly limits; final full-supply exit is exempt. Transfers burn 3%. Support may be exhausted and does not guarantee a price floor.':'نرخ ذخیره/عرضه با کارمزد ۳٪. فروش بالای ۵۰۰ دلار سقف تک‌فروش ۵٪ و خروج ساعتی ۲۰٪ دارد؛ خروج نهایی کل عرضه معاف است. انتقال ۳٪ سوزاندن دارد. حمایت محدود است و ممکن است تمام شود.',
 'Rewards use funded credits from your own branches. $20 per point is the protection target, not a reward ceiling or an unfunded guarantee. Protection adjusts hourly point caps when funding falls below that target.':'پاداش از اعتبار تأمین‌شده شاخه‌های خود شماست. ۲۰ دلار به ازای پوینت، هدف حفاظت است، نه سقف پاداش یا تضمین بدون پشتوانه. زیر این هدف، حفاظت سقف‌های پوینت ساعتی را تنظیم می‌کند.',
 'The amount entered is your total debit: the recipient receives 97% and 3% is burned. The burn rounds up to the smallest FTI unit. Recipients do not need membership.':'مقدار واردشده کل برداشت از ولت شماست؛ گیرنده ۹۷٪ دریافت می‌کند و ۳٪ با گردکردن رو به بالا سوزانده می‌شود. گیرنده به عضویت نیاز ندارد.',
 'Five guardians approve proposals. Ordinary operations pass through a 72-hour timelock; emergency pause and redemption require five approvals.':'پنج نگهبان پیشنهادها را تأیید می‌کنند. عملیات عادی قفل زمانی ۷۲ ساعته دارند؛ توقف و بازپرداخت اضطراری به پنج رأی نیاز دارند.',
 'Five guardians approve proposals. Ordinary operations pass through a 72-hour timelock.':'پنج نگهبان پیشنهادها را تأیید می‌کنند. عملیات عادی از قفل زمانی ۷۲ ساعته عبور می‌کنند.',
 'Your membership, tokens and rewards — connected to your wallet and read directly from the chain.':'عضویت، توکن‌ها و پاداش‌ها به ولت شما متصل‌اند و مستقیم از شبکه خوانده می‌شوند.',
 'Connect a wallet, get test assets and register with a sponsor to begin.':'برای شروع، ولت را متصل کنید، دارایی آزمایشی بگیرید و با آدرس معرف عضو شوید.',
 'Progress is based on your weaker lifetime branch.':'پیشرفت بر اساس شاخه ضعیف‌تر در حجم کل محاسبه می‌شود.',
 'You have reached the highest current rank.':'به بالاترین رنک فعلی رسیده‌اید.',
 'Register with a sponsor to start your membership.':'برای شروع عضویت، با آدرس معرف ثبت‌نام کنید.',
 'Register your wallet in Membership before buying FTI.':'پیش از خرید FTI، ولت خود را در بخش عضویت ثبت کنید.',
 'Add at least one membership unit before buying FTI.':'پیش از خرید FTI، حداقل یک واحد عضویت بخرید.',
 'Token trading is currently paused by the contract.':'معاملات توکن در قرارداد متوقف شده است.',
 'Buy, sell or transfer through your wallet. Every transaction requires your approval.':'خرید، فروش و انتقال از طریق ولت شما انجام می‌شود. هر تراکنش به تأیید شما نیاز دارد.',
 'Enter a positive amount and slippage between 0% and 5%.':'مبلغ مثبت و حد تغییر قیمت بین صفر و ۵٪ وارد کنید.',
 'Quote unavailable. Check the amount or refresh contract data.':'نرخ در دسترس نیست؛ مبلغ را بررسی یا اطلاعات قرارداد را به‌روزرسانی کنید.',
 'Transfer quote unavailable. Check the amount and contract connection.':'نرخ انتقال در دسترس نیست؛ مقدار و اتصال قرارداد را بررسی کنید.',
 'Register or add membership units before trading.':'پیش از خرید، ثبت عضویت یا افزودن واحد لازم است.',
 'Token trading is paused by the contract.':'معاملات توکن در قرارداد متوقف است.',
 'Not enough test USD in your wallet.':'موجودی دلار آزمایشی ولت کافی نیست.',
 'Amount exceeds your remaining manual purchase allowance.':'مبلغ از سقف خرید باقیمانده شما بیشتر است.',
 'Amount exceeds your unlocked balance. Check the unlock schedule.':'مقدار از موجودی قابل فروش شما بیشتر است.',
 'Enter a valid recipient address.':'آدرس معتبر گیرنده وارد کنید.',
 'Enter an amount within your unlocked token balance.':'مقدار را در محدوده موجودی قابل انتقال وارد کنید.',
 'Choose a different recipient wallet.':'ولت گیرنده باید با ولت فرستنده متفاوت باشد.',
 'Enter a valid sponsor address.':'آدرس معتبر معرف وارد کنید.',
 'Enter between 1 and 1,000,000 whole units.':'بین ۱ تا ۱٬۰۰۰٬۰۰۰ واحد کامل وارد کنید.',
 'Loading recent on-chain events…':'در حال خواندن رویدادهای اخیر شبکه…',
 'No events in the recent block range.':'رویدادی در بازه بلاک‌های اخیر وجود ندارد.',
 'Recent events could not be loaded. Your balances remain available. Use Refresh events to retry.':'رویدادهای اخیر خوانده نشدند. موجودی‌ها همچنان در دسترس‌اند؛ برای تلاش مجدد به‌روزرسانی رویدادها را بزنید.',
 'Emergency redemption':'بازپرداخت اضطراری',
 'Emergency redemption is not active.':'بازپرداخت اضطراری فعال نیست.',
 'Enter an amount within your token balance.':'مقدار را در محدوده موجودی توکن خود وارد کنید.',
 'Membership & network':'عضویت و شبکه', 'Your rewards':'پاداش‌های شما',
 'Governance & settlement':'شورا و تسویه',
 'Not enough test USD. Use Get test USD on Overview.':'دلار آزمایشی کافی نیست؛ از نمای کلی دلار آزمایشی بگیرید.'
});

function dynamicText(s){
 const parts=[['Transaction submitted. Waiting for confirmation… ','تراکنش ارسال شد؛ در انتظار تأیید… '],['Updated ','به‌روزرسانی '],['Epoch ','دوره '],['Balance: ','موجودی: '],[' · Allowance: ',' · سقف خرید: '],['Available: ','قابل فروش: '],['Estimated output: ','دریافتی برآوردی: '],['Net proceeds: ','دریافتی خالص: '],['Minimum accepted: ','حداقل دریافتی: '],['Recipient receives: ','دریافتی گیرنده: '],[' · Burned: ',' · سوزانده‌شده: '],[' · Fee 3%',' · کارمزد ۳٪'],[' test USD',' دلار آزمایشی'],[' wallets awaiting cash payout',' ولت در صف پرداخت نقدی'],[' lifetime points',' پوینت کل'],['Next: ','رنک بعد: '],['Top rank','بالاترین رنک'],[' FTI locked',' FTI قفل‌شده'],['Connection unavailable: ','اتصال در دسترس نیست: '],['Volume queue: ','صف حجم شاخه‌ها: '],['Settlement phase: ','مرحله تسویه: '],[' · Member cursor: ',' · شاخص اعضا: ']];
 let value=s;for(const[from,to]of parts)value=value.replaceAll(from,to);return value;
}
