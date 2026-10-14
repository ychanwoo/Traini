import io
import json
import tempfile
import unittest
import zipfile
from datetime import date
from pathlib import Path
from unittest.mock import patch

from garminconnect import GarminConnectAuthenticationError

from traini_collector.auth import authenticate
from traini_collector.cli import date_range
from traini_collector.storage import crc16, extract_fit, validate_fit
from traini_collector.sync import sync_activities


def fit_bytes(header_size=14):
    # A valid file envelope; decoding activity messages is a later stage.
    header = bytes([header_size, 0x20, 0, 0]) + (3).to_bytes(4, "little") + b".FIT"
    if header_size == 14:
        header += crc16(header).to_bytes(2, "little")
    contents = header + b"\x00\x01\x02"
    return contents + crc16(contents).to_bytes(2, "little")


def zipped(contents, name="original.fit"):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr(name, contents)
    return output.getvalue()


def activity(activity_id=101, day="2026-10-13", kind="running"):
    return {"activityId": activity_id, "startTimeLocal": f"{day} 08:00:00",
            "activityType": {"typeKey": kind}, "distance": 5100, "duration": 1800}


class FakeClient:
    def __init__(self, activities, fail_once=None):
        self.activities = activities
        self.fail_once = set(fail_once or [])
        self.downloads = []
        self.query = None

    def get_activities_by_date(self, startdate, enddate, activitytype, sortorder):
        self.query = (startdate, enddate, activitytype, sortorder)
        return self.activities

    def download_activity(self, activity_id, dl_fmt):
        self.downloads.append(activity_id)
        if activity_id in self.fail_once:
            self.fail_once.remove(activity_id)
            raise ConnectionError("private-token-must-not-be-logged")
        return zipped(fit_bytes())


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.data = Path(self.temp.name) / "garmin"
        self.start, self.end = date(2026, 10, 7), date(2026, 10, 13)
        self.messages = []

    def tearDown(self):
        self.temp.cleanup()

    def sync(self, client):
        return sync_activities(client, self.start, self.end, self.data,
                               "original", self.messages.append)

    def test_seven_days_includes_today_and_crosses_year_boundary(self):
        self.assertEqual(date_range(date(2027, 1, 2), 7), (date(2026, 12, 27), date(2027, 1, 2)))

    def test_invalid_ranges(self):
        for days in (0, -1, 367):
            with self.assertRaises(ValueError):
                date_range(self.end, days)
        with self.assertRaises(ValueError):
            date_range(self.end, 7, date(2026, 10, 14))

    def test_accepts_zip_and_raw_fit_for_both_header_sizes(self):
        for size in (12, 14):
            payload = fit_bytes(size)
            self.assertEqual(extract_fit(payload), payload)
            self.assertEqual(extract_fit(zipped(payload)), payload)

    def test_rejects_truncated_corrupt_and_non_fit(self):
        for contents in (b"<html>login required</html>", fit_bytes()[:-1],
                         fit_bytes()[:-2] + b"\x01\x02"):
            with self.assertRaises(ValueError):
                extract_fit(contents)

    def test_zip_entry_path_is_never_extracted(self):
        self.assertEqual(extract_fit(zipped(fit_bytes(), "../../outside.fit")), fit_bytes())
        self.assertFalse((Path(self.temp.name) / "outside.fit").exists())

    def test_rejects_zip_without_fit_or_with_multiple_fits(self):
        with self.assertRaises(ValueError):
            extract_fit(zipped(b"anything", "file.gpx"))
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as archive:
            archive.writestr("a.fit", fit_bytes())
            archive.writestr("b.fit", fit_bytes())
        with self.assertRaises(ValueError):
            extract_fit(output.getvalue())

    def test_repeat_sync_skips_download_and_filters_range_duplicates(self):
        client = FakeClient([activity(), activity(), activity(102, "2026-10-06"),
                             activity(103, kind="trail_running")])
        first, second = self.sync(client), self.sync(client)
        self.assertEqual((first.found, first.downloaded), (2, 2))
        self.assertEqual((second.downloaded, second.skipped), (0, 2))
        self.assertEqual(client.downloads, ["101", "103"])
        self.assertEqual(client.query, ("2026-10-07", "2026-10-13", "running", "asc"))
        self.assertEqual((self.data / "activities/101.fit").stat().st_mode & 0o777, 0o600)

    def test_partial_failure_is_persisted_and_retried_without_secret_logging(self):
        client = FakeClient([activity(), activity(102)], fail_once=["102"])
        first = self.sync(client)
        state = json.loads((self.data / "sync-state.json").read_text())
        self.assertEqual(first.failed, 1)
        self.assertEqual(state["activities"]["102"]["status"], "failed")
        self.assertNotIn("last_successful_run", state)
        self.assertNotIn("private-token", " ".join(self.messages) + json.dumps(state))
        second = self.sync(client)
        self.assertEqual((second.skipped, second.downloaded, second.failed), (1, 1, 0))
        self.assertEqual(client.downloads, ["101", "102", "102"])

    def test_corrupt_existing_fit_is_replaced_after_successful_download(self):
        self.sync(FakeClient([activity()]))
        path = self.data / "activities/101.fit"
        path.write_bytes(b"incomplete")
        client = FakeClient([activity()])
        self.assertEqual(self.sync(client).downloaded, 1)
        validate_fit(path.read_bytes())

    def test_empty_week_is_successful(self):
        result = self.sync(FakeClient([]))
        self.assertEqual(result.found, 0)
        self.assertIn("last_successful_run", json.loads((self.data / "sync-state.json").read_text()))

    def test_invalid_activity_id_cannot_escape_output_directory(self):
        with self.assertRaises(ValueError):
            self.sync(FakeClient([activity("../../bad")]))

    def test_malformed_state_is_not_silently_overwritten(self):
        self.data.mkdir()
        state_path = self.data / "sync-state.json"
        state_path.write_text("broken")
        with self.assertRaises(ValueError):
            self.sync(FakeClient([]))
        self.assertEqual(state_path.read_text(), "broken")

    def test_cached_login_does_not_prompt_for_password(self):
        token_dir = Path(self.temp.name) / "auth"
        token_dir.mkdir()
        (token_dir / "garmin_tokens.json").write_text("{}")
        with patch("traini_collector.auth.Garmin") as factory, patch("getpass.getpass") as password:
            authenticate(token_dir, non_interactive=True)
            factory.return_value.login.assert_called_once_with(str(token_dir))
            password.assert_not_called()

    def test_non_interactive_without_token_does_not_prompt(self):
        with patch("builtins.input") as prompt:
            with self.assertRaises(GarminConnectAuthenticationError):
                authenticate(Path(self.temp.name) / "auth", non_interactive=True)
            prompt.assert_not_called()

    def test_force_login_does_not_reuse_old_token(self):
        token_dir = Path(self.temp.name) / "auth"
        token_dir.mkdir()
        token_file = token_dir / "garmin_tokens.json"
        token_file.write_text("old-token")
        with patch("traini_collector.auth.Garmin") as factory, \
             patch("sys.stdin.isatty", return_value=True), \
             patch("builtins.input", return_value="runner@example.com"), \
             patch("getpass.getpass", return_value="not-logged"):
            def login(store):
                if store != str(token_dir):
                    (Path(store) / "garmin_tokens.json").write_text("new-token")
            factory.return_value.login.side_effect = login
            authenticate(token_dir, force_login=True)
            self.assertEqual(token_file.read_text(), "new-token")
            self.assertNotEqual(factory.return_value.login.call_args_list[0].args[0], str(token_dir))

    def test_failed_force_login_preserves_existing_token(self):
        token_dir = Path(self.temp.name) / "auth"
        token_dir.mkdir()
        token_file = token_dir / "garmin_tokens.json"
        token_file.write_text("old-token")
        with patch("traini_collector.auth.Garmin") as factory, \
             patch("sys.stdin.isatty", return_value=True), \
             patch("builtins.input", return_value="runner@example.com"), \
             patch("getpass.getpass", return_value="not-logged"):
            factory.return_value.login.side_effect = GarminConnectAuthenticationError("denied")
            with self.assertRaises(GarminConnectAuthenticationError):
                authenticate(token_dir, force_login=True)
            self.assertEqual(token_file.read_text(), "old-token")

    def test_virtual_running_is_supported(self):
        self.assertEqual(self.sync(FakeClient([activity(kind="virtual_run")])).downloaded, 1)


if __name__ == "__main__":
    unittest.main()
