import contextlib
import io
import json
import tempfile
import unittest
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

from traini_collector.cli import main, parser
from traini_collector.periods import (
    previous_training_week, select_period, today_in_zone, training_week,
)
from traini_collector.sync import activity_training_date, sync_activities
from test_collector import FakeClient, activity


class PeriodTests(unittest.TestCase):
    def test_each_weekday_selects_the_same_completed_week(self):
        monday = date(2026, 10, 12)
        for offset in range(7):
            with self.subTest(offset=offset):
                period = select_period(monday + timedelta(days=offset))
                self.assertEqual((period.start, period.end), (date(2026, 10, 5), date(2026, 10, 11)))
                self.assertEqual(period.mode, "previous_week")
        self.assertEqual(previous_training_week(date(2026, 10, 19)), (date(2026, 10, 12), date(2026, 10, 18)))

    def test_month_year_and_leap_year_boundaries(self):
        cases = [
            (date(2027, 1, 2), date(2026, 12, 21), date(2026, 12, 27)),
            (date(2027, 1, 4), date(2026, 12, 28), date(2027, 1, 3)),
            (date(2024, 3, 4), date(2024, 2, 26), date(2024, 3, 3)),
            (date(2026, 11, 2), date(2026, 10, 26), date(2026, 11, 1)),
        ]
        for today, start, end in cases:
            with self.subTest(today=today):
                self.assertEqual(previous_training_week(today), (start, end))

    def test_configured_timezone_controls_the_calendar_week(self):
        instant = datetime(2026, 10, 12, 0, 30, tzinfo=UTC)
        la = select_period(today_in_zone(ZoneInfo("America/Los_Angeles"), instant))
        seoul = select_period(today_in_zone(ZoneInfo("Asia/Seoul"), instant))
        self.assertEqual((la.start, la.end), (date(2026, 9, 28), date(2026, 10, 4)))
        self.assertEqual((seoul.start, seoul.end), (date(2026, 10, 5), date(2026, 10, 11)))

    def test_dst_week_still_has_seven_calendar_dates(self):
        for instant, expected in [
            (datetime(2026, 3, 9, 8, tzinfo=UTC), (date(2026, 3, 2), date(2026, 3, 8))),
            (datetime(2026, 11, 2, 8, tzinfo=UTC), (date(2026, 10, 26), date(2026, 11, 1))),
        ]:
            period = select_period(today_in_zone(ZoneInfo("America/Los_Angeles"), instant))
            self.assertEqual((period.start, period.end), expected)
            self.assertEqual((period.end - period.start).days, 6)

    def test_explicit_days_and_dates_preserve_custom_collection(self):
        today = date(2026, 10, 14)
        recent = select_period(today, days=7)
        self.assertEqual((recent.start, recent.end, recent.mode), (date(2026, 10, 8), today, "recent"))
        self.assertEqual(select_period(today, start=date(2026, 10, 5), end=date(2026, 10, 11)).end, date(2026, 10, 11))
        self.assertEqual(select_period(today, start=date(2026, 10, 1)).end, today)
        end_only = select_period(today, end=date(2026, 10, 11))
        self.assertEqual((end_only.start, end_only.end), (date(2026, 10, 5), date(2026, 10, 11)))
        self.assertEqual((select_period(today, days=56).end - select_period(today, days=56).start).days, 55)

    def test_ambiguous_options_and_invalid_ranges_are_rejected(self):
        today = date(2026, 10, 14)
        for options in [
            {"previous_week": True, "end": today},
            {"previous_week": True, "days": 7},
            {"start": today, "days": 7},
            {"start": today, "end": date(2026, 10, 13)},
            {"days": 0},
        ]:
            with self.subTest(options=options), self.assertRaises(ValueError):
                select_period(today, **options)
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            parser().parse_args(["--previous-week", "--days", "7"])

    def test_explicit_previous_week_matches_default(self):
        today = date(2026, 10, 14)
        self.assertEqual(select_period(today), select_period(today, previous_week=True))

    def test_naive_reference_time_is_not_assigned_an_implicit_host_timezone(self):
        with self.assertRaises(ValueError):
            today_in_zone(ZoneInfo("Asia/Seoul"), datetime(2026, 10, 14))


class WeeklySyncTests(unittest.TestCase):
    def test_sunday_midnight_and_adjacent_weeks_are_classified_by_training_timezone(self):
        runs = [
            {**activity(201, "2026-10-12"), "startTimeGMT": "2026-10-12 06:59:59"},
            {**activity(202, "2026-10-11"), "startTimeGMT": "2026-10-12T07:00:00Z"},
            {**activity(203, "2026-10-05"), "startTimeGMT": "2026-10-05T06:59:59+00:00"},
            {**activity(204, "2026-10-04"), "startTimeGMT": "2026-10-05T07:00:00Z"},
        ]
        timezone = ZoneInfo("America/Los_Angeles")
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            client = FakeClient(runs)
            first = sync_activities(client, date(2026, 10, 5), date(2026, 10, 11),
                                    data, "original", lambda _: None, timezone=timezone,
                                    period_mode="previous_week")
            self.assertEqual((first.found, first.downloaded), (2, 2))
            self.assertEqual(client.downloads, ["201", "204"])
            self.assertEqual(client.query[:2], ("2026-10-03", "2026-10-13"))
            state = json.loads((data / "sync-state.json").read_text())
            self.assertEqual(state["activities"]["201"]["training_date"], "2026-10-11")
            self.assertEqual(state["activities"]["204"]["training_date"], "2026-10-05")
            for entry in state["activities"].values():
                self.assertEqual(entry["training_week_starts_on"], "2026-10-05")
                self.assertEqual(entry["training_week_ends_on"], "2026-10-11")
                self.assertEqual(entry["date_source"], "utc")
            self.assertEqual(state["last_run"]["timezone"], timezone.key)
            self.assertEqual(state["last_run"]["period_mode"], "previous_week")
            second = sync_activities(client, date(2026, 10, 5), date(2026, 10, 11),
                                     data, "original", lambda _: None, timezone=timezone)
            self.assertEqual((second.downloaded, second.skipped), (0, 2))

    def test_sunday_run_stays_on_its_start_date_even_if_it_ends_on_monday(self):
        run = {**activity(), "startTimeGMT": "2026-10-12T06:30:00Z", "duration": 7200}
        day, source = activity_training_date(run, ZoneInfo("America/Los_Angeles"))
        self.assertEqual(day, date(2026, 10, 11))
        self.assertEqual(training_week(day), (date(2026, 10, 5), date(2026, 10, 11)))
        self.assertEqual(source, "utc")

    def test_missing_utc_uses_local_start_with_visible_provenance(self):
        messages = []
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            sync_activities(FakeClient([activity(day="2026-10-11")]),
                            date(2026, 10, 5), date(2026, 10, 11), data,
                            "original", messages.append, timezone=ZoneInfo("Asia/Seoul"))
            entry = json.loads((data / "sync-state.json").read_text())["activities"]["101"]
            self.assertEqual(entry["date_source"], "garmin_local")
            self.assertTrue(any("UTC 시작 시각 없음" in message for message in messages))

    def test_explicit_offset_is_respected(self):
        run = {**activity(), "startTimeLocal": "2026-10-12T08:00:00+09:00"}
        self.assertEqual(activity_training_date(run, ZoneInfo("America/Los_Angeles")),
                         (date(2026, 10, 11), "local_offset"))

    def test_malformed_utc_does_not_silently_fall_back_to_local_time(self):
        with self.assertRaises(ValueError):
            activity_training_date({**activity(), "startTimeGMT": "invalid"}, ZoneInfo("Asia/Seoul"))

    def test_cli_default_collects_completed_week_and_preserves_retry_behavior(self):
        with tempfile.TemporaryDirectory() as folder:
            client = FakeClient([activity(day="2026-10-11")])
            output = io.StringIO()
            arguments = ["traini-collect", "--data-dir", folder, "--token-dir", folder + "/auth"]
            with patch("sys.argv", arguments), \
                 patch("traini_collector.cli.today_in_zone", return_value=date(2026, 10, 14)), \
                 patch("traini_collector.auth.authenticate", return_value=client), \
                 contextlib.redirect_stdout(output):
                self.assertEqual(main(), 0)
                self.assertEqual(main(), 0)
            self.assertEqual(client.downloads, ["101"])
            self.assertIn("2026-10-05 ~ 2026-10-11", output.getvalue())
            self.assertIn("러닝 1개", output.getvalue())
            self.assertIn("기존 1개", output.getvalue())


if __name__ == "__main__":
    unittest.main()
