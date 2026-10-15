import contextlib
import fcntl
import io
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

from garminconnect import GarminConnectAuthenticationError
from traini_collector.periods import CollectionPeriod
from traini_collector.web import WorkerStopped, run_worker
from test_collector import FakeClient, activity


class WebWorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.data = Path(self.temp.name) / "garmin"
        self.tokens = Path(self.temp.name) / "auth"
        self.timezone = ZoneInfo("America/Los_Angeles")
        self.period = CollectionPeriod(date(2026, 10, 5), date(2026, 10, 11), "previous_week")

    def tearDown(self):
        self.temp.cleanup()

    def run_worker(self, client):
        output = io.StringIO()
        with patch("traini_collector.web.select_period", return_value=self.period), \
             patch("traini_collector.web.authenticate", return_value=client), \
             contextlib.redirect_stdout(output):
            result = run_worker(self.data, self.tokens, self.timezone)
        state = json.loads((self.data / "web-sync.json").read_text())
        self.assertEqual(json.loads(output.getvalue()), {"kind": "started"})
        return result, state

    def test_success_and_repeat_download_are_recorded_without_exposing_paths(self):
        client = FakeClient([activity(day="2026-10-11")])
        code, job = self.run_worker(client)
        self.assertEqual(code, 0)
        self.assertEqual(job["status"], "succeeded")
        self.assertEqual(job["counts"]["downloaded"], 1)
        self.assertEqual(job["period"]["start"], "2026-10-05")
        self.assertNotIn("token", json.dumps(job))
        code, job = self.run_worker(client)
        self.assertEqual(job["counts"]["skipped"], 1)
        self.assertEqual(client.downloads, ["101"])

    def test_expired_auth_is_safe_and_lock_is_released(self):
        self.data.mkdir()
        output = io.StringIO()
        with patch("traini_collector.web.authenticate", side_effect=GarminConnectAuthenticationError("secret-example")), \
             contextlib.redirect_stdout(output):
            self.assertEqual(run_worker(self.data, self.tokens, self.timezone), 1)
        text = (self.data / "web-sync.json").read_text()
        self.assertEqual(json.loads(text)["errorCode"], "auth_required")
        self.assertNotIn("secret-example", text + output.getvalue())
        with (self.data / ".sync.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def test_existing_cli_lock_prevents_authentication_and_preserves_job(self):
        self.data.mkdir()
        (self.data / "web-sync.json").write_text('{"previous":true}')
        with (self.data / ".sync.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            output = io.StringIO()
            with patch("traini_collector.web.authenticate") as authenticate, contextlib.redirect_stdout(output):
                self.assertEqual(run_worker(self.data, self.tokens, self.timezone), 1)
                authenticate.assert_not_called()
            self.assertEqual(json.loads(output.getvalue())["kind"], "busy")
        self.assertEqual((self.data / "web-sync.json").read_text(), '{"previous":true}')

    def test_partial_download_keeps_counts_and_retry_instruction(self):
        client = FakeClient([activity(day="2026-10-11")], fail_once=["101"])
        code, job = self.run_worker(client)
        self.assertEqual(code, 1)
        self.assertEqual(job["status"], "partial")
        self.assertEqual(job["counts"]["failed"], 1)
        self.assertEqual(job["errorCode"], "partial_download")
        self.assertNotIn("private-token", json.dumps(job))

    def test_deadline_can_interrupt_activity_error_handling(self):
        client = FakeClient([activity(day="2026-10-11")])
        client.download_activity = lambda *_args, **_kwargs: (_ for _ in ()).throw(WorkerStopped())
        code, job = self.run_worker(client)
        self.assertEqual(code, 1)
        self.assertEqual(job["status"], "failed")
        self.assertEqual(job["errorCode"], "timeout")
        self.assertIsNotNone(job["finishedAt"])


if __name__ == "__main__":
    unittest.main()
