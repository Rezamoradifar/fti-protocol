import runpy
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path


publisher = runpy.run_path(str(Path(__file__).with_name("publish-mainnet-card.py")))
scheduled_day = publisher["scheduled_day"]


class PublisherTimingTests(unittest.TestCase):
    def test_delayed_runs_keep_the_original_tehran_date(self):
        # All four runs from November 20 arrived late, including two after local midnight.
        for hour, utc_time in [(9, (14, 16)), (13, (17, 56)), (17, (21, 25)), (21, (23, 17))]:
            with self.subTest(hour=hour):
                created = datetime(2026, 11, 20, *utc_time, tzinfo=timezone.utc)
                self.assertEqual(scheduled_day(hour, created, created), date(2026, 11, 20))

    def test_on_time_and_retry_share_the_same_slot(self):
        created = datetime(2026, 11, 20, 17, 30, tzinfo=timezone.utc)
        for delay in [timedelta(), timedelta(hours=8), timedelta(days=1, seconds=-1)]:
            with self.subTest(delay=delay):
                self.assertEqual(scheduled_day(21, created, created + delay), date(2026, 11, 20))

    def test_old_rerun_cannot_claim_the_next_days_slot(self):
        created = datetime(2026, 11, 20, 23, 17, tzinfo=timezone.utc)
        next_occurrence = datetime(2026, 11, 21, 17, 30, tzinfo=timezone.utc)
        self.assertIsNone(scheduled_day(21, created, next_occurrence))
        self.assertIsNone(scheduled_day(21, created, next_occurrence + timedelta(days=3)))
        self.assertEqual(scheduled_day(21, next_occurrence, next_occurrence), date(2026, 11, 21))
