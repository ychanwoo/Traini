import contextlib
import fcntl
import io
import json
import tempfile
import unittest
from datetime import UTC, date, datetime
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

from garminconnect import GarminConnectAuthenticationError
from traini_collector.periods import CollectionPeriod
from traini_collector.web import WorkerStopped, run_worker
from traini_collector.upload import UploadError
from test_fit import encoded_fit, session
from test_upload import MemoryStore
from test_collector import FakeClient, activity, fit_bytes


class PipelineClient(FakeClient):
    def download_activity(self, activity_id, dl_fmt):
        super().download_activity(activity_id, dl_fmt)
        return encoded_fit()


class PipelineStore(MemoryStore):
    def close(self):
        self.closed = True


class WebWorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.data = Path(self.temp.name) / "garmin"
        self.tokens = Path(self.temp.name) / "auth"
        self.timezone = ZoneInfo("America/Los_Angeles")
        self.store = PipelineStore()
        self.period = CollectionPeriod(date(2026, 10, 5), date(2026, 10, 11), "previous_week")

    def tearDown(self):
        self.temp.cleanup()

    def run_worker(self, client):
        output = io.StringIO()
        with patch("traini_collector.web.select_period", return_value=self.period), \
             patch("traini_collector.web.authenticate", return_value=client), \
             patch("traini_collector.web.create_store", return_value=self.store), \
             contextlib.redirect_stdout(output):
            result = run_worker(self.data, self.tokens, self.timezone)
        state = json.loads((self.data / "web-sync.json").read_text())
        self.assertEqual(json.loads(output.getvalue()), {"kind": "started"})
        return result, state

    def test_success_and_repeat_download_are_recorded_without_exposing_paths(self):
        client = PipelineClient([activity(day="2026-10-11")])
        code, job = self.run_worker(client)
        self.assertEqual(code, 0)
        self.assertEqual(job["status"], "succeeded")
        self.assertEqual(job["counts"]["downloaded"], 1)
        self.assertEqual(job["parsing"]["processed"], 1)
        self.assertEqual(job["upload"]["inserted"], 1)
        self.assertTrue(job["uploadStarted"])
        self.assertEqual(self.store.rows["101"]["distance_meters"], 5000.25)
        self.assertTrue(self.store.closed)
        self.assertEqual(job["period"]["start"], "2026-10-05")
        self.assertNotIn("token", json.dumps(job))
        code, job = self.run_worker(client)
        self.assertEqual(job["counts"]["skipped"], 1)
        self.assertEqual(job["parsing"]["skipped"], 1)
        self.assertEqual(job["upload"]["unchanged"], 1)
        self.assertEqual(len(self.store.rows), 1)
        self.assertEqual(client.downloads, ["101"])

    def test_expired_auth_is_safe_and_lock_is_released(self):
        self.data.mkdir()
        output = io.StringIO()
        with patch("traini_collector.web.authenticate", side_effect=GarminConnectAuthenticationError("secret-example")), \
             patch("traini_collector.web.create_store", return_value=self.store), \
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
        client = PipelineClient([activity(day="2026-10-11")], fail_once=["101"])
        code, job = self.run_worker(client)
        self.assertEqual(code, 1)
        self.assertEqual(job["status"], "partial")
        self.assertEqual(job["counts"]["failed"], 1)
        self.assertEqual(job["errorCode"], "partial_download")
        self.assertNotIn("private-token", json.dumps(job))

    def test_deadline_can_interrupt_activity_error_handling(self):
        client = PipelineClient([activity(day="2026-10-11")])
        client.download_activity = lambda *_args, **_kwargs: (_ for _ in ()).throw(WorkerStopped())
        code, job = self.run_worker(client)
        self.assertEqual(code, 1)
        self.assertEqual(job["status"], "failed")
        self.assertEqual(job["errorCode"], "timeout")
        self.assertIsNotNone(job["finishedAt"])

    def test_only_files_confirmed_this_run_are_parsed_and_uploaded(self):
        (self.data / "activities").mkdir(parents=True)
        (self.data / "activities/999.fit").write_bytes(b"unrelated broken history")
        code, job = self.run_worker(PipelineClient([activity(day="2026-10-11")]))
        self.assertEqual(code, 0)
        self.assertEqual(job["parsing"]["found"], 1)
        self.assertEqual(set(self.store.rows), {"101"})
        self.assertFalse((self.data / "normalized/999.json").exists())

    def test_partial_download_still_uploads_good_files_and_retry_recovers(self):
        client = PipelineClient([activity(101, "2026-10-11"), activity(102, "2026-10-11")], fail_once=["101"])
        code, job = self.run_worker(client)
        self.assertEqual(code, 1)
        self.assertEqual(job["upload"]["inserted"], 1)
        self.assertEqual(set(self.store.rows), {"102"})
        code, job = self.run_worker(client)
        self.assertEqual(code, 0)
        self.assertEqual(job["upload"]["inserted"], 1)
        self.assertEqual(job["upload"]["unchanged"], 1)
        self.assertEqual(len(self.store.rows), 2)

    def test_invalid_fit_does_not_stop_other_files_or_upload_old_output(self):
        client = PipelineClient([activity(101, "2026-10-11"), activity(102, "2026-10-11")])
        self.run_worker(client)
        # Valid FIT envelope, invalid activity payload: collection accepts it,
        # parser rejects it, and its previously normalized document is excluded.
        (self.data / "activities/101.fit").write_bytes(fit_bytes())
        self.store.rows.clear()
        code, job = self.run_worker(client)
        self.assertEqual(job["status"], "partial")
        self.assertEqual(job["errorCode"], "partial_parse")
        self.assertEqual(job["parsing"]["failed"], 1)
        self.assertEqual(job["upload"]["excluded"], 1)
        self.assertEqual(set(self.store.rows), {"102"})
        self.assertTrue((self.data / "normalized/101.json").exists())

    def test_fit_start_outside_selected_week_is_not_uploaded(self):
        client = PipelineClient([activity(day="2026-10-11")])
        client.download_activity = lambda *a, **k: encoded_fit([session(start_time=datetime(2026, 10, 12, 8, tzinfo=UTC))])
        code, job = self.run_worker(client)
        self.assertEqual(code, 1)
        self.assertEqual(job["parsing"]["failed"], 1)
        self.assertFalse(self.store.rows)
        manifest = json.loads((self.data / "parse-state.json").read_text())
        self.assertEqual(manifest["files"]["101.fit"]["error_code"], "outside_import_period")

    def test_upload_partial_then_retry_has_no_duplicates(self):
        self.store.fail.add("101")
        client = PipelineClient([activity(101, "2026-10-11"), activity(102, "2026-10-11")])
        code, job = self.run_worker(client)
        self.assertEqual(job["errorCode"], "partial_upload")
        self.assertEqual(job["upload"]["failed"], 1)
        self.assertEqual(job["upload"]["inserted"], 1)
        self.store.fail.clear()
        code, job = self.run_worker(client)
        self.assertEqual(code, 0)
        self.assertEqual(job["upload"]["inserted"], 1)
        self.assertEqual(job["upload"]["unchanged"], 1)
        self.assertEqual(len(self.store.rows), 2)

    def test_empty_week_does_not_reuse_previous_parse_manifest(self):
        self.run_worker(PipelineClient([activity(day="2026-10-11")]))
        self.store.rows.clear()
        code, job = self.run_worker(PipelineClient([]))
        self.assertEqual(code, 0)
        self.assertEqual(job["counts"]["found"], 0)
        self.assertEqual(job["parsing"]["found"], 0)
        self.assertEqual(job["upload"]["found"], 0)
        self.assertFalse(self.store.rows)

    def test_owner_verification_failure_preserves_local_data_and_is_retryable(self):
        client = PipelineClient([activity(day="2026-10-11")])
        with patch.object(self.store, "verify_owner", side_effect=UploadError("profile_missing")):
            code, job = self.run_worker(client)
        self.assertEqual(job["errorCode"], "upload_failed")
        self.assertEqual(job["failedStage"], "uploading")
        self.assertTrue(job["uploadStarted"])
        self.assertFalse(self.store.rows)
        self.assertTrue((self.data / "normalized/101.json").exists())
        self.assertEqual(self.run_worker(client)[0], 0)

    def test_lock_held_through_upload_and_termination_is_checkpointed(self):
        original = self.store.save
        def save(row, details=None):
            with (self.data / ".sync.lock").open("a") as lock:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if row["garmin_activity_id"] == "102":
                raise WorkerStopped()
            return original(row, details)
        client = PipelineClient([activity(101, "2026-10-11"), activity(102, "2026-10-11")])
        with patch.object(self.store, "save", side_effect=save):
            code, job = self.run_worker(client)
        self.assertEqual(job["errorCode"], "timeout")
        self.assertEqual(job["failedStage"], "uploading")
        self.assertEqual(job["upload"]["inserted"], 1)
        self.assertEqual(self.run_worker(client)[0], 0)
        self.assertEqual(len(self.store.rows), 2)

    def test_auth_failure_never_reuses_previous_upload_inputs(self):
        client = PipelineClient([activity(day="2026-10-11")])
        self.run_worker(client)
        self.store.rows.clear()
        with patch("traini_collector.web.authenticate", side_effect=GarminConnectAuthenticationError("private")):
            # run_worker helper patches authenticate, so call the real worker.
            with patch("traini_collector.web.create_store", return_value=self.store), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(run_worker(self.data, self.tokens, self.timezone), 1)
        self.assertFalse(self.store.rows)
        job = json.loads((self.data / "web-sync.json").read_text())
        self.assertFalse(job["uploadStarted"])

    def test_committed_write_with_lost_response_is_safe_to_retry(self):
        original = self.store.save
        def lost_response(row, details=None):
            original(row, details)
            raise UploadError("connection_failed")
        client = PipelineClient([activity(day="2026-10-11")])
        with patch.object(self.store, "save", side_effect=lost_response):
            code, job = self.run_worker(client)
        self.assertEqual(job["status"], "partial")
        self.assertEqual(job["upload"]["failed"], 1)
        self.assertTrue(job["uploadStarted"])
        code, job = self.run_worker(client)
        self.assertEqual(code, 0)
        self.assertEqual(job["upload"]["unchanged"], 1)
        self.assertEqual(len(self.store.rows), 1)

    def test_checkpoint_failure_after_remote_commit_does_not_create_duplicate(self):
        from traini_collector.storage import write_json
        failed_once = False
        def checkpoint(path, value):
            nonlocal failed_once
            if path.name == "upload-state.json" and value["counts"]["inserted"] and not failed_once:
                failed_once = True
                raise OSError("private disk details")
            write_json(path, value)
        client = PipelineClient([activity(day="2026-10-11")])
        with patch("traini_collector.upload.write_json", side_effect=checkpoint):
            code, job = self.run_worker(client)
        self.assertEqual(job["status"], "failed")
        self.assertEqual(job["errorCode"], "storage")
        self.assertTrue(job["uploadStarted"])
        self.assertNotIn("private disk", json.dumps(job))
        self.assertEqual(len(self.store.rows), 1)
        code, job = self.run_worker(client)
        self.assertEqual(code, 0)
        self.assertEqual(job["upload"]["unchanged"], 1)


if __name__ == "__main__":
    unittest.main()
