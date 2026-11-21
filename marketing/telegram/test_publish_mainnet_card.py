import io
import runpy
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch

from PIL import Image


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


class EditorialTests(unittest.TestCase):
    day = date(2026, 11, 21)
    observed = datetime(2026, 11, 21, 1, 20, tzinfo=timezone.utc)
    config = {"chainId": 56, "genesis": [f"0x{i:040x}" for i in range(31)]}
    state = {"block": 12345678, "count": 61, "price": 2345000000000000000, "reserve": 345 * 10**18,
             "supply": 234 * 10**18, "tokenPaused": False, "paused": True}

    def test_four_topics_have_rotating_copy_and_traceable_data(self):
        for hour in (9, 13, 17, 21):
            titles = set()
            for offset in range(4):
                title, panels, caption, buttons = publisher["edition"](
                    hour, self.day + timedelta(days=offset), self.state, self.config, self.observed)
                titles.add(title)
                self.assertIn("Block 12,345,678", caption)
                self.assertEqual(len(panels), 3)
                self.assertEqual(caption.count("#"), 4)
                self.assertLessEqual(len(caption.encode("utf-16-le")) // 2, 1024)
                self.assertEqual(buttons["inline_keyboard"][0][-1]["url"], "https://bscscan.com/block/12345678")
            self.assertEqual(len(titles), 4)

    def test_photo_and_looping_gif_formats(self):
        art = io.BytesIO()
        Image.new("RGB", (240, 180), "#255245").save(art, "PNG")
        for hour, animated in [(9, False), (13, True)]:
            title, panels, _, _ = publisher["edition"](hour, self.day, self.state, self.config, self.observed)
            data = publisher["render_media"](art.getvalue(), title, panels, self.state["block"], "01:20 UTC", animated)
            with Image.open(io.BytesIO(data)) as image:
                self.assertEqual(image.size, (800, 800))
                self.assertEqual(image.format, "GIF" if animated else "JPEG")
                if animated:
                    self.assertEqual(image.n_frames, 3)
                    self.assertEqual(image.info["loop"], 0)
                    self.assertGreater(image.info["duration"], 1000)

    def test_dated_request_and_scheduled_sends_share_claims(self):
        hours = publisher["requested_slots"]("2026-11-21 09,13", self.day)
        self.assertEqual(hours, [9, 13])
        self.assertEqual(publisher["requested_slots"]("2026-11-20 09,13", self.day), [])
        for invalid in ["2026-11-21 09,09", "2026-11-22 13", "2026-11-21 11", "invalid"]:
            with self.assertRaises(ValueError):
                publisher["requested_slots"](invalid, self.day)
        send = publisher["deliver"]
        claimed = set()

        def claim(day, hour):
            if (day, hour) in claimed:
                return False
            claimed.add((day, hour))
            return True

        def response(method, data, files):
            kind = next(iter(files))
            self.assertEqual(method, {"animation": "sendAnimation", "photo": "sendPhoto"}[kind])
            return {"chat": {"id": data["chat_id"]}, kind: {"file_id": "sample"}, "caption": data["caption"], "message_id": 1}

        api = Mock(side_effect=response)
        with patch.dict(send.__globals__, claim_slot=claim, telegram=api), patch("builtins.print"):
            for hour in hours + hours:
                send(self.day, hour, b"test", hour == 13, "FTI test", {})
        self.assertEqual(api.call_count, 2)

    def test_definite_rejection_can_retry_and_uncertain_delivery_retains_the_claim(self):
        send = publisher["deliver"]
        for error, should_release in [(publisher["TelegramRejected"]("rejected"), True), (RuntimeError("timeout"), False)]:
            release = Mock()
            with patch.dict(send.__globals__, claim_slot=Mock(return_value=True), telegram=Mock(side_effect=error),
                            release_rejected_slot=release), self.assertRaises(RuntimeError):
                send(self.day, 13, b"gif", True, "FTI test", {})
            self.assertEqual(release.called, should_release)
