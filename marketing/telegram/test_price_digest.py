import unittest
from datetime import date, datetime, timedelta
from unittest.mock import Mock, patch

from price_digest import TOKEN, USDT, TEHRAN, INITIAL, checked, current_sample, daily_history, record_day, table
from channel_languages import translations


class DailyPrices(unittest.TestCase):
    def test_verified_initial_history_has_seven_distinct_anchored_days(self):
        self.assertEqual(len(INITIAL), 7)
        for day, observation in INITIAL.items():
            checked(observation, date.fromisoformat(day))
            self.assertRegex(observation["blockHash"], r"^0x[a-f0-9]{64}$")

    def test_receipt_retry_retains_the_original_daily_quote(self):
        previous = next(iter(INITIAL.values()))
        session = Mock()
        session.post.side_effect = [Mock(json=lambda: {"sha": "f"*40}), Mock(status_code=422)]
        with patch("price_digest.read_day", return_value=previous):
            self.assertEqual(record_day(session, date(2026,11,14), {}, "f"*40), previous)

    def test_daily_quote_matches_the_reserve_and_uses_observed_tehran_time(self):
        cfg = {"chainId": 56, "token": TOKEN, "usd": USDT}
        stamp = int(datetime(2026,11,21,6,0,tzinfo=TEHRAN).timestamp())
        state = {"price": 10**17, "supply": 10**19, "reserve": 10**18, "timestamp": stamp, "block": 123}
        quote = current_sample(cfg, state)
        self.assertEqual(quote["priceWei"], str(10**17))
        self.assertIn("06:00", table({date(2026,11,21): quote}))
        with self.assertRaises(ValueError):
            current_sample(cfg, {**state, "price": 1})

    def test_increase_loss_flat_missing_and_zero_comparator(self):
        start = date(2026, 11, 10)
        data = {start + timedelta(days=i): {"priceWei": v * 10**16, "timestamp": 1795227908} if v else None
                for i, v in enumerate((100, 110, 99, 99, None, 123))}
        rows = table(data).splitlines()
        self.assertIn("+10.00%", rows[2])
        self.assertIn("-10.00%", rows[3])
        self.assertIn("0.00%", rows[4])
        self.assertIn("—", rows[5])
        self.assertTrue(rows[6].endswith("—"))
        self.assertLessEqual(len(rows), 8)

    def test_wrong_asset_cannot_supply_channel_prices(self):
        with self.assertRaises(ValueError):
            daily_history({"chainId": 97}, {})
        with self.assertRaises(ValueError):
            daily_history({"chainId": 56, "token": "0xwrong"}, {})

    def test_every_edition_has_six_translated_lines_alongside_english(self):
        for hour in [9, 13, 17, 21]:
            lines = translations(hour, count=63, added=32, price="0.115", token=True, member=False).splitlines()
            self.assertEqual(len(lines), 6)
            for name in ["فارسی", "العربية", "Türkçe", "中文", "Русский", "Español"]:
                self.assertTrue(any(line.startswith(name) for line in lines))
