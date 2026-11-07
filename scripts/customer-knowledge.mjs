// Approved support material. Keep financial terms in the active contract/panel;
// this file deliberately does not quote unverified prices, returns or badges.
export const KNOWLEDGE_VERSION='2026-11-07';
export const CUSTOMER_ACTIONS=Object.freeze({
 membership:{en:'Open membership',fa:'ورود به عضویت',href:'/app/#network'},
 market:{en:'Open token market',fa:'ورود به بازار توکن',href:'/token/#trade'},
 support:{en:'Open private support',fa:'ورود به پشتیبانی خصوصی',href:'/app/#support'},
 guide:{en:'Read the protocol guide',fa:'راهنمای پروتکل',href:'/whitepaper/'},
 vpn:{en:'Explore VPN',fa:'بررسی VPN',href:'/vpn/'},
 contact:{en:'Request a team reply',fa:'درخواست پاسخ تیم',href:'#contact'},
});
export const CUSTOMER_KNOWLEDGE=Object.freeze([
 {id:'wallet',match:/wallet|connect|safepal|metamask|ولت|کیف.?پول|اتصال/i,actions:['membership','support'],
  en:'Use Connect wallet in the member workspace. Check the network shown by the workspace and your wallet. Connecting a wallet is separate from signing a transaction. If SafePal or another mobile wallet does not open, use that wallet’s own browser to open this site, then try Connect wallet again. Never enter a seed phrase or private key into FTI support.',
  fa:'در فضای اعضا، «اتصال کیف‌پول» را انتخاب کنید و شبکهٔ پنل و ولت را بررسی کنید. اتصال ولت با امضای تراکنش فرق دارد. اگر سیف‌پال یا ولت موبایلی باز نمی‌شود، سایت را در مرورگر داخل همان ولت باز کنید و دوباره اتصال را بزنید. عبارت بازیابی یا کلید خصوصی را در پشتیبانی وارد نکنید.'},
 {id:'membership',match:/member|register|join|sign.?up|start|getting started|عضو|ثبت.?نام|شروع/i,actions:['membership','guide','contact'],
  en:'Start in Membership in the member workspace. Connect your wallet, check the referral address and the placement shown, then review the current membership quote. Any required token approval and membership transaction are separate wallet confirmations. A successful transaction receipt and the refreshed on-chain membership record confirm completion; a click or submitted hash alone does not.',
  fa:'از بخش «عضویت» در فضای اعضا شروع کنید. ولت را وصل کنید، آدرس معرف و جایگاه نمایش‌داده‌شده را بررسی کنید و برآورد جاری عضویت را بخوانید. مجوز توکن و تراکنش عضویت، در صورت نیاز، تأییدهای جداگانهٔ ولت هستند. تکمیل با رسید موفق تراکنش و وضعیت به‌روز عضویت در شبکه مشخص می‌شود؛ کلیک یا هش ارسال‌شده به‌تنهایی تأیید موفقیت نیست.'},
 {id:'referral',match:/referr|invite|placement|binary|معرف|رفرال|دعوت|جای.?گاه|باینری/i,actions:['membership','support'],
  en:'Open your invitation link before connecting the wallet and review the referrer in Membership. The protocol determines placement; do not replace the referrer to work around a pending placement request. After joining, your personal invitation link appears in the member workspace. If a link loses its referrer, send the page URL and error through private support without sharing wallet secrets.',
  fa:'لینک دعوت را پیش از اتصال ولت باز کنید و معرف را در بخش عضویت بررسی کنید. جای‌گذاری طبق قوانین پروتکل انجام می‌شود؛ برای عبور از درخواست در حال انتظار، معرف را عوض نکنید. پس از عضویت، لینک دعوت شخصی در پنل نمایش داده می‌شود. اگر معرف از لینک حذف شد، نشانی صفحه و خطا را از پشتیبانی خصوصی بفرستید؛ اطلاعات محرمانهٔ ولت را نفرستید.'},
 {id:'sell',match:/sell|redeem|withdraw|فروش|برداشت|بازخرید/i,actions:['market','support'],
  en:'Open Token market, select Sell, and request a fresh quote. The active contract determines liquidity, fees, timing and transaction limits. Review the amount received and network fee in your wallet before signing. If a sale fails or remains pending, check its transaction receipt before trying again; support cannot promise an execution time or guaranteed liquidity.',
  fa:'در بازار توکن، «فروش» را انتخاب کنید و برآورد تازه بگیرید. نقدشوندگی، کارمزد، زمان و محدودیت اجرا را قرارداد فعال تعیین می‌کند. مبلغ دریافتی و کارمزد شبکه را پیش از امضا در ولت بررسی کنید. اگر فروش ناموفق یا در انتظار است، قبل از تلاش مجدد رسید تراکنش را بررسی کنید؛ پشتیبانی نمی‌تواند زمان اجرا یا نقدشوندگی را تضمین کند.'},
 {id:'token',match:/token|buy|price|quote|purchase|توکن|خرید|قیمت|برآورد/i,actions:['market','guide'],
  en:'Use the Token market for the current contract quote, supported collateral and fees. Choose the amount, review the quote, then approve only the allowance the flow requests and confirm the transaction in your own wallet. Quotes can change before execution. The assistant does not accept deposits, sign transactions or guarantee token value.',
  fa:'برای نرخ جاری قرارداد، دارایی پشتوانهٔ قابل استفاده و کارمزدها به بازار توکن بروید. مقدار را مشخص کنید، برآورد را بخوانید و سپس فقط مجوز درخواستی همان مسیر و تراکنش را در ولت خود تأیید کنید. برآورد ممکن است تا زمان اجرا تغییر کند. دستیار وجه دریافت نمی‌کند، تراکنش امضا نمی‌کند و ارزش توکن را تضمین نمی‌کند.'},
 {id:'rewards',match:/reward|profit|return|income|hour|auto.?buy|پاداش|سود|درآمد|ساعتی|خودکار/i,actions:['membership','guide','support'],
  en:'Check Rewards in your member workspace for your own on-chain balance, eligibility and auto-buy settings. Membership units, matched points and available rewards are different quantities. The active protocol rules and available funds determine payouts. No fixed or guaranteed future return is established by this assistant, a diagram or a projected calculation.',
  fa:'موجودی پاداش، شرایط حساب و تنظیم خرید خودکار را در بخش «پاداش‌ها»ی پنل خود بررسی کنید. یونیت عضویت، پوینت تعادل و پاداش قابل دریافت مفاهیم جدا هستند. پرداخت‌ها تابع قوانین فعال پروتکل و منابع موجود هستند. این دستیار، نمودار یا محاسبهٔ فرضی، سود ثابت یا تضمینی آینده را اثبات نمی‌کند.'},
 {id:'vpn',match:/vpn|nodeshield|وی.?پی.?ان|فیلتر.?شکن/i,actions:['vpn','contact'],
  en:'The VPN page shows whether the connected provider is ready to accept orders. Checkout is offered only after the configured service passes its live availability check and a delivery acceptance record is installed. Until then you can request an update without paying. For an existing paid order with missing delivery, request a team reply and include the order reference, never your VPN configuration or credentials.',
  fa:'صفحهٔ VPN نشان می‌دهد سرویس متصل آمادهٔ سفارش هست یا نه. خرید فقط پس از بررسی زندهٔ دسترس‌پذیری سرویس و ثبت آزمون موفق تحویل ارائه می‌شود. تا آن زمان می‌توانید بدون پرداخت، درخواست اطلاع‌رسانی بدهید. برای سفارش پرداخت‌شده‌ای که تحویل نشده، شمارهٔ سفارش را همراه درخواست پاسخ تیم بنویسید؛ کانفیگ یا رمز VPN را نفرستید.'},
 {id:'trust',match:/audit|certif|list|coinmarketcap|coingecko|regulat|safe|trust|ممیزی|اودیت|لیست|اعتبار|تأییدیه|مجوز/i,actions:['guide','contact'],
  en:'Source code, contract explorer verification, an independent security audit and a market-data listing are separate forms of evidence. This assistant cannot confirm an independent audit, regulatory approval or CoinMarketCap listing unless a corresponding current report or official project page is available. Ask the team for the specific report, scope, contract address and date you want to verify.',
  fa:'کد منبع، تطبیق سورس در مرورگر بلاکچین، ممیزی امنیتی مستقل و لیستینگ بازار هر کدام مدرک جداگانه دارند. بدون گزارش یا صفحهٔ رسمی جاری، این دستیار نمی‌تواند ممیزی مستقل، مجوز قانونی یا لیستینگ CoinMarketCap را تأیید کند. گزارش مشخص، دامنهٔ بررسی، آدرس قرارداد و تاریخ مورد نظر را از تیم بخواهید.'},
 {id:'support',match:/support|help|error|failed|pending|problem|human|agent|پشتیبان|خطا|مشکل|ناموفق|انسان|کمک/i,actions:['support','contact'],
  en:'For account-specific help, connect your wallet and open Help → Support tickets in the member workspace. Sign the support-access message to prove wallet control; this is not a payment approval. Include the network, transaction hash if one exists, and the exact error. If you cannot connect a wallet, request a team reply here. Replies and case status are handled by the support team.',
  fa:'برای بررسی حساب، ولت را وصل کنید و در فضای اعضا به «مرکز راهنما ← تیکت‌های پشتیبانی» بروید. پیام ورود به پشتیبانی مالکیت ولت را ثابت می‌کند و مجوز پرداخت نیست. شبکه، هش تراکنش در صورت وجود و متن دقیق خطا را بنویسید. اگر ولت وصل نمی‌شود، همین‌جا درخواست پاسخ تیم بدهید. پاسخ و وضعیت پرونده توسط تیم پشتیبانی پیگیری می‌شود.'},
 {id:'privacy',match:/privacy|data|consent|delete|حریم|اطلاعات|رضایت|حذف/i,actions:['contact'],
  en:'Guided questions are not saved as a chat history by this service. If you choose AI assistance, only that question and approved help material are sent to the configured AI provider. A contact request is saved only after your explicit consent, is restricted to the support team and expires after 30 days. You can withdraw a request using the cancellation control on its receipt. Never submit passwords, seed phrases, private keys or VPN configurations.',
  fa:'این سرویس سؤال‌های راهنمای خودکار را به‌عنوان تاریخچهٔ گفتگو ذخیره نمی‌کند. اگر کمک هوش مصنوعی را انتخاب کنید، فقط همان سؤال و راهنمای تأییدشده به ارائه‌دهندهٔ تنظیم‌شده فرستاده می‌شود. درخواست تماس فقط با رضایت صریح شما ذخیره می‌شود، در دسترس تیم پشتیبانی است و پس از ۳۰ روز منقضی می‌شود. با گزینهٔ لغو روی رسید می‌توانید درخواست را پس بگیرید. رمز، عبارت بازیابی، کلید خصوصی یا کانفیگ VPN نفرستید.'},
]);

export function knowledgeAnswer(message,language='en',topic){
 const locale=language==='fa'?'fa':'en';
 const requested=CUSTOMER_KNOWLEDGE.find(item=>item.id===topic);
 // Explicit topic buttons take precedence; free text prefers specific VPN,
 // privacy and support issues over generic phrases such as "buy" or "wallet".
 const order=['privacy','vpn','trust','sell','referral','rewards','support','wallet','membership','token'];
 const match=requested||order.map(id=>CUSTOMER_KNOWLEDGE.find(item=>item.id===id)).find(item=>item.match.test(message));
 if(!match)return {topic:'general',answer:locale==='fa'?'من دستیار خودکار FTI هستم. برای عضویت، بازار توکن، اتصال ولت، VPN یا پشتیبانی، یکی از موضوع‌ها را انتخاب کنید یا سؤال مشخصی بنویسید. برای موضوع حساب یا سفارش، می‌توانید درخواست پاسخ تیم بدهید.':'I’m FTI’s automated assistant. Choose a topic or ask a specific question about membership, the token market, wallets, VPN or support. For an account or order issue, you can request a team reply.',actions:['membership','market','vpn','contact'],sources:['guide'],language:locale};
 return {topic:match.id,answer:match[locale],actions:match.actions,sources:match.actions.filter(id=>['guide','market','membership','vpn','support'].includes(id)),language:locale};
}

export function publicActions(ids,language='en'){
 return [...new Set(ids)].filter(id=>Object.hasOwn(CUSTOMER_ACTIONS,id)).slice(0,4).map(id=>({id,label:CUSTOMER_ACTIONS[id][language==='fa'?'fa':'en'],href:CUSTOMER_ACTIONS[id].href}));
}
