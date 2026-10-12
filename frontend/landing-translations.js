const codes=['fa','ar','tr','zh-CN','ru','es'];
export const landingTranslations=Object.fromEntries(codes.map(code=>[code,Object.create(null)]));
for(const row of `
Protocol|پروتکل|البروتوكول|Protokol|协议|Протокол|Protocolo
Binary plan|پلن باینری|الخطة الثنائية|İkili plan|二叉计划|Бинарный план|Plan binario
Token|توکن|الرمز|Token|代币|Токен|Token
Development|توسعه|التطوير|Geliştirme|开发|Разработка|Desarrollo
Council|شورا|المجلس|Konsey|委员会|Совет|Consejo
Members|اعضا|الأعضاء|Üyeler|会员|Участники|Miembros
Explore testnet|مشاهده تست‌نت|استكشف شبكة الاختبار|Test ağını keşfet|探索测试网|Открыть тестовую сеть|Explorar la red de prueba
Explore the testnet|مشاهده تست‌نت|استكشف شبكة الاختبار|Test ağını keşfet|探索测试网|Открыть тестовую сеть|Explorar la red de prueba
Explore FTI testnet|مشاهده تست‌نت FTI|استكشف شبكة FTI التجريبية|FTI test ağını keşfet|探索 FTI 测试网|Открыть тестовую сеть FTI|Explorar la red de prueba FTI
Built on logic.|ساخته‌شده بر پایه منطق.|مبني على المنطق.|Mantık üzerine kurulu.|基于逻辑构建。|Построено на логике.|Construido sobre la lógica.
Open to|در دسترس|متاح لـ|Herkese|向所有人|Открыто для|Abierto a
 everyone.| همه.| الجميع.| açık.|开放。| всех.| todos.
everyone.|همه.|الجميع.|açık.|开放。|всех.|todos.
A connected system for membership, binary rewards and reserve-based token mechanics. Explore the rules. Understand the flow.|سامانه‌ای متصل برای عضویت، پاداش باینری و توکن مبتنی بر ذخیره. قوانین و جریان وجوه را بررسی کنید.|نظام مترابط للعضوية والمكافآت الثنائية وآليات رمز قائم على الاحتياطي. استكشف القواعد وافهم تدفق الأموال.|Üyelik, ikili ödüller ve rezerve dayalı token mekanizmasını birleştiren sistem. Kuralları ve fon akışını inceleyin.|连接会员、二叉奖励与储备支持代币机制的系统。探索规则，了解资金流向。|Единая система участия, бинарных наград и резервного токена. Изучите правила и движение средств.|Un sistema que conecta membresía, recompensas binarias y un token basado en reservas. Explora las reglas y comprende el flujo de fondos.
How it works|نحوه کار|كيف يعمل|Nasıl çalışır|运作方式|Как это работает|Cómo funciona
Experimental protocol · Test assets only · Not independently audited|پروتکل آزمایشی · فقط دارایی آزمایشی · فاقد حسابرسی مستقل|بروتوكول تجريبي · أصول تجريبية فقط · دون تدقيق مستقل|Deneysel protokol · Yalnızca test varlıkları · Bağımsız denetim yapılmadı|实验性协议 · 仅限测试资产 · 未经独立审计|Экспериментальный протокол · Только тестовые активы · Нет независимого аудита|Protocolo experimental · Solo activos de prueba · Sin auditoría independiente
Skip to content|رفتن به محتوا|انتقل إلى المحتوى|İçeriğe geç|跳至内容|Перейти к содержимому|Saltar al contenido
Main navigation|ناوبری اصلی|التنقل الرئيسي|Ana gezinme|主导航|Основная навигация|Navegación principal
Open menu|بازکردن منو|فتح القائمة|Menüyü aç|打开菜单|Открыть меню|Abrir menú
Close menu|بستن منو|إغلاق القائمة|Menüyü kapat|关闭菜单|Закрыть меню|Cerrar menú
Menu|منو|القائمة|Menü|菜单|Меню|Menú
Close|بستن|إغلاق|Kapat|关闭|Закрыть|Cerrar
Read the whitepaper|مطالعه وایت‌پیپر|اقرأ الورقة البيضاء|Teknik dokümanı oku|阅读白皮书|Читать белую книгу|Leer el libro blanco
Open council panel|بازکردن پنل شورا|فتح لوحة المجلس|Konsey panelini aç|打开委员会面板|Открыть панель совета|Abrir panel del consejo
View the roadmap|مشاهده نقشه راه|عرض خارطة الطريق|Yol haritasını görüntüle|查看路线图|Открыть дорожную карту|Ver hoja de ruta
Open testnet application|بازکردن برنامه تست‌نت|فتح تطبيق شبكة الاختبار|Test ağı uygulamasını aç|打开测试网应用|Открыть приложение тестовой сети|Abrir aplicación de prueba
Token site|سایت توکن|موقع الرمز|Token sitesi|代币网站|Сайт токена|Sitio del token
Explorer|کاوشگر|المستكشف|Gezgin|区块浏览器|Обозреватель|Explorador
Copied|کپی شد|نُسخ|Kopyalandı|已复制|Скопировано|Copiado
Member dashboard and landing share the selected language.|زبان انتخابی بین پنل اعضا و لندینگ مشترک است.|لغة العرض المختارة مشتركة بين لوحة الأعضاء والصفحة الرئيسية.|Seçilen dil üye paneli ve ana sayfada ortaktır.|会员面板和落地页使用同一所选语言。|Выбранный язык используется в кабинете и на главной странице.|El panel de miembros y la página de inicio comparten el idioma seleccionado.
Auto-buy uses eligible hourly binary income, not monthly Builder funds. The installed contract determines whether 5% or a selectable 5–100% applies.|اتوبای از درآمد ساعتی واجد شرایط باینری تأمین می‌شود، نه صندوق ماهانه بیلدر. قرارداد نصب‌شده مشخص می‌کند سهم ثابت ۵٪ یا سهم انتخابی ۵ تا ۱۰۰٪ اعمال شود.|يُموّل الشراء التلقائي من الدخل الثنائي الساعي المؤهل، لا من صناديق Builder الشهرية. يحدد العقد المنشور ما إذا كانت النسبة ثابتة 5% أو اختيارية بين 5 و100%.|Otomatik alım aylık Builder fonlarından değil, uygun saatlik ikili gelirden karşılanır. Sabit %5 veya seçilebilir %5–100 uygulanacağını dağıtılmış sözleşme belirler.|自动购买使用符合条件的每小时二叉收益，而非 Builder 月度资金。已部署合约决定适用固定 5% 还是可选 5–100%。|Автопокупка использует допустимый часовой бинарный доход, а не месячные фонды Builder. Установленный контракт определяет фиксированные 5% или настраиваемые 5–100%.|La compra automática usa ingresos binarios por hora elegibles, no fondos mensuales Builder. El contrato instalado determina si se aplica un 5% fijo o un 5–100% configurable.
The price curve uses observed contract prices. Recent trade volume is shown separately; neither is a forecast or complete 24-hour market history.|منحنی از قیمت‌های مشاهده‌شده قرارداد ساخته می‌شود. حجم معاملات اخیر جداست؛ هیچ‌کدام پیش‌بینی یا تاریخچه کامل ۲۴ ساعته نیستند.|يستخدم المنحنى أسعار العقد المرصودة. يُعرض حجم الصفقات الحديثة منفصلًا؛ لا يمثل أي منهما توقعًا أو سجلًا كاملًا لـ24 ساعة.|Fiyat eğrisi gözlemlenen sözleşme fiyatlarını kullanır. Son işlem hacmi ayrıdır; bunlar tahmin veya eksiksiz 24 saatlik piyasa geçmişi değildir.|价格曲线使用观测到的合约价格。近期交易量单独显示；两者均非预测或完整的 24 小时市场历史。|Кривая использует наблюдаемые цены контракта. Объём недавних сделок показан отдельно; это не прогноз и не полная история за 24 часа.|La curva usa precios observados del contrato. El volumen reciente se muestra por separado; ninguno es un pronóstico ni un historial completo de 24 horas.
`.trim().split('\n')){const[key,...values]=row.split('|');if(values.length!==codes.length)throw Error('Invalid landing translation');codes.forEach((code,i)=>{landingTranslations[code][key]=values[i];});}
