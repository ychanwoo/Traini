"""Synthetic FIT fixtures exercise the real Garmin encoder and decoder.

No personal activity files, coordinates, tokens, or network calls are needed.
"""

import copy
import json
import math
import unittest
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from garmin_fit_sdk import Encoder, Profile

from traini_collector.fit import FitParseError, decode_activity, normalize_messages, valid_activity_id
from traini_collector.storage import crc16

LA = ZoneInfo("America/Los_Angeles")
START = datetime(2026, 10, 12, 6, 50, tzinfo=UTC)  # Sunday 23:50 in LA


def session(**changes):
    return {"sport": "running", "sub_sport": "generic", "start_time": START,
            "timestamp": datetime(2026, 10, 12, 7, 30, tzinfo=UTC),
            "total_distance": 5000.25, "total_elapsed_time": 2000,
            "total_timer_time": 1800, "avg_heart_rate": 145,
            "avg_cadence": 85, "avg_fractional_cadence": 0.5, **changes}


def encoded_fit(sessions=None, file_type="activity"):
    encoder = Encoder()
    encoder.on_mesg(Profile["mesg_num"]["FILE_ID"], {
        "type": file_type, "manufacturer": "development", "product": 1,
        "time_created": START,
    })
    for value in sessions if sessions is not None else [session()]:
        encoder.on_mesg(Profile["mesg_num"]["SESSION"], value)
    return bytes(encoder.close())


def messages(value=None):
    return {"file_id_mesgs": [{"type": "activity"}],
            "session_mesgs": [session() if value is None else value]}


class FitTests(unittest.TestCase):
    def test_real_decoder_units_fractional_cadence_and_timer_pace(self):
        parsed = decode_activity(encoded_fit(), "101", LA)
        self.assertEqual(parsed["distance_meters"], 5000.25)
        self.assertEqual(parsed["elapsed_time_seconds"], 2000)
        self.assertEqual(parsed["timer_time_seconds"], 1800)
        self.assertIsNone(parsed["moving_time_seconds"])
        self.assertEqual(parsed["average_heart_rate_bpm"], 145)
        self.assertEqual(parsed["average_cadence_steps_per_minute"], 171)
        self.assertAlmostEqual(parsed["average_pace_seconds_per_km"], 1800 / 5.00025, places=6)
        self.assertEqual(parsed["training_date"], "2026-10-11")
        self.assertEqual(parsed["training_week_starts_on"], "2026-10-05")
        self.assertEqual(parsed["training_week_ends_on"], "2026-10-11")
        self.assertEqual(parsed["started_at_local"], "2026-10-11T23:50:00-07:00")
        self.assertIn("missing:moving_time_seconds", parsed["warnings"])
        self.assertEqual(parsed, decode_activity(encoded_fit(), "101", LA))

    def test_missing_metrics_stay_null_and_no_record_averages_are_invented(self):
        parsed = decode_activity(encoded_fit([{"sport": "running", "start_time": START}]), "101", LA)
        for field in ("distance_meters", "elapsed_time_seconds", "timer_time_seconds", "moving_time_seconds",
                      "average_pace_seconds_per_km", "average_heart_rate_bpm", "average_cadence_steps_per_minute"):
            self.assertIsNone(parsed[field])
            self.assertIsNone(parsed["metric_sources"][field])

    def test_explicit_moving_time_and_speed_fallback(self):
        value = session(total_moving_time=1700)
        self.assertEqual(decode_activity(encoded_fit([value]), "101", LA)["moving_time_seconds"], 1700)
        del value["total_timer_time"]
        value["enhanced_avg_speed"] = 4.0
        parsed = decode_activity(encoded_fit([value]), "101", LA)
        self.assertEqual(parsed["average_pace_seconds_per_km"], 250)
        self.assertEqual(parsed["metric_sources"]["average_pace_seconds_per_km"], "1000/session.enhanced_avg_speed")

    def test_zero_distance_or_zero_timer_never_divides_by_zero(self):
        for values in ({"total_distance": 0}, {"total_timer_time": 0}):
            parsed = decode_activity(encoded_fit([session(**values)]), "101", LA)
            self.assertIsNone(parsed["average_pace_seconds_per_km"])

    def test_invalid_numbers_and_missing_sensor_data_are_not_zero(self):
        for invalid in (math.nan, math.inf, -1, True, "145"):
            parsed = normalize_messages(messages(session(total_distance=invalid, avg_heart_rate=invalid)), "101", LA)
            self.assertIsNone(parsed["distance_meters"])
            self.assertIsNone(parsed["average_heart_rate_bpm"])
            json.dumps(parsed, allow_nan=False)
        parsed = normalize_messages(messages(session(avg_heart_rate=255, avg_fractional_cadence=1)), "101", LA)
        self.assertIsNone(parsed["average_heart_rate_bpm"])
        self.assertEqual(parsed["average_cadence_steps_per_minute"], 170)
        self.assertIn("invalid:avg_fractional_cadence", parsed["warnings"])

    def test_inconsistent_durations_are_flagged_and_excluded(self):
        parsed = normalize_messages(messages(session(total_timer_time=2100, total_moving_time=2200)), "101", LA)
        self.assertIsNone(parsed["timer_time_seconds"])
        self.assertIsNone(parsed["moving_time_seconds"])
        self.assertIn("inconsistent:timer_time_seconds", parsed["warnings"])

    def test_cadence_alias_and_fractional_zero(self):
        parsed = normalize_messages(messages(session(avg_running_cadence=90, avg_fractional_cadence=0)), "101", LA)
        self.assertEqual(parsed["average_cadence_steps_per_minute"], 180)
        self.assertIn("avg_running_cadence", parsed["metric_sources"]["average_cadence_steps_per_minute"])

    def test_start_time_required_and_never_substituted_with_end_timestamp(self):
        for start in (None, "2026-10-11", START.replace(tzinfo=None)):
            with self.assertRaisesRegex(FitParseError, "missing_start_time"):
                normalize_messages(messages(session(start_time=start)), "101", LA)

    def test_non_activity_non_running_and_multiple_sessions_are_rejected(self):
        cases = [(encoded_fit(file_type="workout"), "unsupported_file_type"),
                 (encoded_fit([session(sport="cycling")]), "unsupported_sport"),
                 (encoded_fit([]), "unsupported_session_count"),
                 (encoded_fit([session(), session()]), "unsupported_session_count")]
        for payload, code in cases:
            with self.assertRaisesRegex(FitParseError, code):
                decode_activity(payload, "101", LA)

    def test_crc_valid_but_undecodable_fit_is_not_partially_accepted(self):
        header = bytes([14, 0x20, 0, 0]) + (3).to_bytes(4, "little") + b".FIT"
        header += crc16(header).to_bytes(2, "little")
        data = header + b"\x00\x01\x02"
        payload = data + crc16(data).to_bytes(2, "little")
        with self.assertRaisesRegex(FitParseError, "decode_failed"):
            decode_activity(payload, "101", LA)

    def test_corrupted_truncated_and_non_fit_inputs(self):
        payload = encoded_fit()
        for data in (b"not fit", payload[:-1], payload[:-2] + b"\x00\x00"):
            with self.assertRaisesRegex(FitParseError, "invalid_fit"):
                decode_activity(data, "101", LA)

    def test_training_week_crosses_year_and_dst_uses_actual_offsets(self):
        cases = [
            (datetime(2027, 1, 1, 8, tzinfo=UTC), "2027-01-01", "2026-12-28", "-08:00"),
            (datetime(2026, 3, 8, 9, 30, tzinfo=UTC), "2026-03-08", "2026-03-02", "-08:00"),
            (datetime(2026, 3, 8, 10, 30, tzinfo=UTC), "2026-03-08", "2026-03-02", "-07:00"),
            (datetime(2026, 11, 1, 8, 30, tzinfo=UTC), "2026-11-01", "2026-10-26", "-07:00"),
            (datetime(2026, 11, 1, 9, 30, tzinfo=UTC), "2026-11-01", "2026-10-26", "-08:00"),
        ]
        for start, day, monday, offset in cases:
            parsed = normalize_messages(messages(session(start_time=start)), "101", LA)
            self.assertEqual(parsed["training_date"], day)
            self.assertEqual(parsed["training_week_starts_on"], monday)
            self.assertTrue(parsed["started_at_local"].endswith(offset))

    def test_timezone_changes_classification_without_changing_instant(self):
        payload = encoded_fit()
        la = decode_activity(payload, "101", LA)
        seoul = decode_activity(payload, "101", ZoneInfo("Asia/Seoul"))
        self.assertEqual(la["started_at"], seoul["started_at"])
        self.assertEqual(seoul["training_week_starts_on"], "2026-10-12")

    def test_projection_excludes_sensitive_or_unknown_fields(self):
        value = session(position_lat=1234, position_long=5678, serial_number=999, unknown="private")
        original = copy.deepcopy(value)
        parsed = normalize_messages(messages(value), "101", LA)
        self.assertEqual(value, original)
        for field in ("position_lat", "position_long", "serial_number", "unknown"):
            self.assertNotIn(field, json.dumps(parsed))

    def test_activity_ids_are_canonical_positive_uint64(self):
        for value in ("0", "001", "-1", "../1", "１２", str(2**64), "a"):
            self.assertFalse(valid_activity_id(value))
            with self.assertRaisesRegex(FitParseError, "invalid_activity_id"):
                decode_activity(encoded_fit(), value, LA)
        self.assertTrue(valid_activity_id(str(2**64 - 1)))
