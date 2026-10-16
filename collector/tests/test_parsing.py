import contextlib
import fcntl
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

from traini_collector.parse_cli import main
from traini_collector.parsing import ParsingBusyError, parse_activities
from traini_collector.storage import atomic_write, write_json
from test_fit import LA, encoded_fit, session


class ParsingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.data = Path(self.temp.name) / "garmin"
        self.activities = self.data / "activities"
        self.activities.mkdir(parents=True)
        self.source = self.activities / "101.fit"
        self.source.write_bytes(encoded_fit())
        self.output = self.data / "normalized/101.json"
        self.state = self.data / "parse-state.json"
        self.logs = []

    def tearDown(self):
        self.temp.cleanup()

    def parse(self, timezone=LA):
        return parse_activities(self.data, timezone, self.logs.append)

    def read_state(self):
        return json.loads(self.state.read_text())

    def test_offline_parse_repeat_preserves_original_and_output_mtime(self):
        original = self.source.read_bytes()
        source_time = self.source.stat().st_mtime_ns
        sync_state = self.data / "sync-state.json"
        sync_state.write_text('{"unrelated":true}')
        result = self.parse()
        self.assertEqual((result.processed, result.skipped, result.failed), (1, 0, 0))
        output = self.output.read_bytes()
        output_time = self.output.stat().st_mtime_ns
        result = self.parse()
        self.assertEqual((result.processed, result.skipped, result.failed), (0, 1, 0))
        self.assertEqual(self.output.read_bytes(), output)
        self.assertEqual(self.output.stat().st_mtime_ns, output_time)
        self.assertEqual(self.source.read_bytes(), original)
        self.assertEqual(self.source.stat().st_mtime_ns, source_time)
        self.assertEqual(sync_state.read_text(), '{"unrelated":true}')
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.output.parent.stat().st_mode & 0o777, 0o700)
        state = self.read_state()
        self.assertEqual(state["status"], "complete")
        self.assertEqual(state["files"]["101.fit"]["normalized_sha256"], hashlib.sha256(output).hexdigest())
        self.assertEqual(len(list(self.output.parent.glob("*.json"))), 1)

    def test_corrupted_derived_document_is_repaired(self):
        self.parse()
        expected = self.output.read_bytes()
        self.output.write_text('{"broken":true}')
        self.assertEqual(self.parse().processed, 1)
        self.assertEqual(self.output.read_bytes(), expected)

    def test_changed_source_and_timezone_are_reprocessed(self):
        self.parse()
        old_hash = json.loads(self.output.read_text())["source"]["sha256"]
        self.source.write_bytes(encoded_fit([session(total_distance=10000)]))
        self.assertEqual(self.parse().processed, 1)
        value = json.loads(self.output.read_text())
        self.assertNotEqual(value["source"]["sha256"], old_hash)
        self.assertEqual(value["distance_meters"], 10000)
        self.assertEqual(self.parse(ZoneInfo("Asia/Seoul")).processed, 1)
        value = json.loads(self.output.read_text())
        self.assertEqual(value["training_week_starts_on"], "2026-10-12")
        self.assertEqual(self.parse(ZoneInfo("Asia/Seoul")).skipped, 1)

    def test_one_invalid_file_does_not_stop_others_and_is_retried(self):
        (self.activities / "102.fit").write_bytes(b"broken")
        (self.activities / "103.fit").write_bytes(encoded_fit([session(sport="cycling")]))
        (self.activities / "104.fit").write_bytes(encoded_fit())
        result = self.parse()
        self.assertEqual((result.found, result.processed, result.failed), (4, 2, 2))
        state = self.read_state()
        self.assertEqual(state["status"], "partial")
        self.assertEqual(state["files"]["102.fit"]["error_code"], "invalid_fit")
        self.assertEqual(state["files"]["103.fit"]["error_code"], "unsupported_sport")
        (self.activities / "102.fit").write_bytes(encoded_fit())
        result = self.parse()
        self.assertEqual((result.processed, result.skipped, result.failed), (1, 2, 1))

    def test_failed_input_preserves_last_output_but_removes_eligibility(self):
        self.parse()
        old = self.output.read_bytes()
        self.source.write_bytes(b"truncated")
        self.assertEqual(self.parse().failed, 1)
        self.assertEqual(self.output.read_bytes(), old)
        entry = self.read_state()["files"]["101.fit"]
        self.assertEqual(entry["status"], "failed")
        self.assertNotIn("normalized_file", entry)

    def test_invalid_filename_is_reported_without_parsing(self):
        for name in ("01.fit", "0.fit", "copy.fit", "１２.fit"):
            (self.activities / name).write_bytes(encoded_fit())
        (self.activities / "unrelated.txt").write_text("ignored")
        result = self.parse()
        self.assertEqual((result.found, result.processed, result.failed), (5, 1, 4))
        self.assertEqual(self.read_state()["files"]["copy.fit"]["error_code"], "invalid_filename")

    def test_uppercase_extension_has_accurate_provenance(self):
        self.source.rename(self.activities / "101.FIT")
        self.parse()
        self.assertEqual(json.loads(self.output.read_text())["source"]["file"], "101.FIT")

    def test_duplicate_ids_are_rejected_before_overwriting(self):
        # Some macOS volumes cannot contain both names. Simulate the inventory
        # so both occurrences are rejected before any read, on every platform.
        with patch.object(Path, "iterdir", return_value=iter([self.source, self.activities / "101.FIT"])):
            result = self.parse()
        self.assertEqual((result.processed, result.failed), (0, 2))
        self.assertFalse(self.output.exists())
        self.assertEqual(self.read_state()["files"]["101.fit"]["error_code"], "duplicate_activity_id")

    def test_symlink_source_or_output_never_reads_or_modifies_target(self):
        outside = Path(self.temp.name) / "outside"
        outside.write_bytes(encoded_fit())
        self.source.unlink()
        self.source.symlink_to(outside)
        self.assertEqual(self.parse().failed, 1)
        self.assertEqual(self.read_state()["files"]["101.fit"]["error_code"], "unsafe_file")
        self.source.unlink()
        self.source.write_bytes(encoded_fit())
        self.output.symlink_to(outside)
        before = outside.read_bytes()
        self.assertEqual(self.parse().failed, 1)
        self.assertEqual(outside.read_bytes(), before)

    def test_non_regular_and_oversized_sources_are_rejected(self):
        (self.activities / "102.fit").mkdir()
        with patch("traini_collector.parsing.MAX_FIT_BYTES", 10):
            result = self.parse()
        self.assertEqual(result.failed, 2)
        files = self.read_state()["files"]
        self.assertEqual(files["101.fit"]["error_code"], "file_too_large")
        self.assertEqual(files["102.fit"]["error_code"], "unsafe_file")

    def test_missing_input_directory_does_not_report_empty_success(self):
        with self.assertRaisesRegex(ValueError, "activities"):
            parse_activities(self.data / "missing", LA)
        self.assertFalse((self.data / "missing").exists())

    def test_empty_existing_directory_is_explicitly_empty(self):
        self.source.unlink()
        self.assertEqual(self.parse().found, 0)
        self.assertEqual(self.read_state()["status"], "complete")
        self.assertEqual(self.read_state()["files"], {})

    def test_collection_lock_prevents_any_output_write(self):
        with (self.data / ".sync.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(ParsingBusyError):
                self.parse()
        self.assertFalse(self.state.exists())
        self.assertEqual(self.parse().processed, 1)

    def test_storage_failure_isolated_and_error_details_not_persisted(self):
        (self.activities / "102.fit").write_bytes(encoded_fit())
        def fail_one(path, contents):
            if path.name == "101.json":
                raise OSError("private-path-or-diagnostic")
            atomic_write(path, contents)
        with patch("traini_collector.parsing.atomic_write", side_effect=fail_one):
            result = self.parse()
        self.assertEqual((result.processed, result.failed), (1, 1))
        self.assertNotIn("private-path", self.state.read_text() + str(self.logs))
        self.assertEqual(self.parse().processed, 1)

    def test_manifest_failure_aborts_instead_of_claiming_success(self):
        def fail_checkpoint(path, value):
            if value["counts"]["processed"]:
                raise OSError("disk full")
            write_json(path, value)
        with patch("traini_collector.parsing.write_json", side_effect=fail_checkpoint):
            with self.assertRaises(OSError):
                self.parse()
        self.assertEqual(self.logs, [])
        self.assertEqual(self.read_state()["files"]["101.fit"]["status"], "pending")
        self.assertEqual(self.parse().skipped, 1)

    def test_interruption_keeps_pending_state_and_releases_lock(self):
        (self.activities / "102.fit").write_bytes(encoded_fit())
        with patch("traini_collector.parsing.decode_activity", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.parse()
        self.assertEqual(self.read_state()["status"], "running")
        self.assertEqual(self.read_state()["files"]["101.fit"]["status"], "pending")
        self.assertEqual(self.parse().processed, 2)

    def test_removed_input_not_advertised_from_previous_manifest(self):
        self.parse()
        self.source.unlink()
        self.parse()
        self.assertTrue(self.output.exists())
        self.assertEqual(self.read_state()["files"], {})

    def cli(self, *arguments):
        output = io.StringIO()
        with patch("sys.argv", ["traini-parse", "--data-dir", str(self.data), *arguments]), \
             contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            return main(), output.getvalue()

    def test_cli_success_partial_failure_timezone_and_busy_exit_codes(self):
        self.assertEqual(self.cli()[0], 0)
        self.source.write_bytes(b"bad")
        self.assertEqual(self.cli()[0], 1)
        code, output = self.cli("--timezone", "invalid/timezone")
        self.assertEqual(code, 1)
        self.assertIn("훈련 시간대", output)
        with (self.data / ".sync.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            code, output = self.cli()
        self.assertEqual(code, 1)
        self.assertIn("실행 중", output)


if __name__ == "__main__":
    unittest.main()
