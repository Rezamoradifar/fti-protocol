import unittest
from datetime import date, timedelta

from price_digest import block_at, daily_history, table
from channel_languages import translations


class DailyPrices(unittest.TestCase):
    def test_final_block_in_a_repeated_second(self):
        header = lambda n: (1000 + n // 3, "hash")
        self.assertEqual(block_at(1050, 0, 600, header), 152)
        self.assertIsNone(block_at(900, 0, 600, header))

    def test_increase_loss_flat_missing_and_zero_comparator(self):
        start = date(2026, 11, 10)
        data = {start + timedelta(days=i): {"priceWei": v * 10**16} if v else None
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
