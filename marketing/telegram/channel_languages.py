"""Concise captions for the seven languages offered by the FTI workspace."""


def translations(hour, *, count=None, added=None, price=None, token=None, member=None):
    if hour == 9:
        return "\n".join([
            f"فارسی · {count} ولت ثبت‌شده، {added} ولت پس از راه‌اندازی",
            f"العربية · {count} محفظة مسجلة، منها {added} بعد الإطلاق",
            f"Türkçe · {count} kayıtlı cüzdan, açılıştan sonra {added} yeni cüzdan",
            f"中文 · 已注册 {count} 个钱包，其中 {added} 个在上线后加入",
            f"Русский · {count} кошельков, из них {added} после запуска",
            f"Español · {count} carteras registradas, {added} desde el lanzamiento"])
    if hour == 13:
        return "\n".join([
            f"فارسی · نرخ قرارداد برای هر FTI برابر {price} تتر است.",
            f"العربية · سعر العقد لكل FTI هو {price} USDT.",
            f"Türkçe · Sözleşme fiyatı: 1 FTI = {price} USDT.",
            f"中文 · 合约报价：每枚 FTI 为 {price} USDT。",
            f"Русский · Котировка контракта: {price} USDT за FTI.",
            f"Español · Precio del contrato: {price} USDT por FTI."])
    if hour == 17:
        return "\n".join([
            "فارسی · قیمت هر FTI به تتر و تغییر نسبت به روز قبل، به وقت تهران",
            "العربية · سعر العقد والتغيّر اليومي",
            "Türkçe · Sözleşme fiyatı ve günlük değişim",
            "中文 · 合约价格及每日变动",
            "Русский · Цена контракта и изменение за день",
            "Español · Precio del contrato y variación diaria"])
    words = [
        ("فارسی · توکن {}، عضویت {}", "متوقف", "فعال"),
        ("العربية · حالة تداول الرمز {}، وحالة العضوية {}", "متوقفة", "نشطة"),
        ("Türkçe · Token {}, üyelik {}", "duraklatıldı", "açık"),
        ("中文 · 代币{}，会员合约{}", "已暂停", "运行中"),
        ("Русский · Статус токена / членства: {} / {}", "пауза", "активен"),
        ("Español · Token {}, membresía {}", "en pausa", "en servicio")]
    return "\n".join(line.format(paused if token else active, paused if member else active)
                     for line, paused, active in words)
