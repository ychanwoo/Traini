"""Synthetic-only characterization of available versus exported FIT evidence."""
import importlib.util
import json
import unittest
from datetime import timedelta
from pathlib import Path
from garmin_fit_sdk import Decoder, Encoder, Profile, Stream
from traini_collector.fit import decode_activity
from traini_collector.intensity import decode_intensity
from traini_collector.upload import activity_row
from test_fit import START, LA, session

spec = importlib.util.spec_from_file_location('fit_audit', Path(__file__).resolve().parents[2] / 'scripts/lib/fit-evidence-audit.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def fixture(average=145):
    encoder = Encoder()
    encoder.on_mesg(Profile['mesg_num']['FILE_ID'], {
        'type': 'activity', 'manufacturer': 'development', 'product': 1, 'time_created': START})
    value = session(total_distance=1000, total_timer_time=300, total_elapsed_time=330,
                    max_heart_rate=180, total_training_effect=3.1)
    if average is None:
        del value['avg_heart_rate']
    else:
        value['avg_heart_rate'] = average
    encoder.on_mesg(Profile['mesg_num']['SESSION'], value)
    encoder.on_mesg(Profile['mesg_num']['LAP'], {
        'start_time': START, 'timestamp': START + timedelta(seconds=330),
        'total_distance':1000, 'total_timer_time':300, 'total_elapsed_time':330,
        'avg_heart_rate':155, 'max_heart_rate':180, 'avg_cadence':88, 'intensity':'active'})
    for i in range(3):
        encoder.on_mesg(Profile['mesg_num']['RECORD'], {
            'timestamp':START + timedelta(seconds=i), 'heart_rate':160+i,
            'speed':3.3, 'cadence':90, 'distance':i*3.3})
    return bytes(encoder.close())


class EvidenceAuditTests(unittest.TestCase):
    def test_session_and_lap_heart_rate_reach_upload_separately(self):
        data = fixture()
        normalized = decode_activity(data, '101', LA)
        row = activity_row(normalized, 'synthetic-owner', 'b'*64)
        evidence = decode_intensity(data)
        self.assertEqual(row['average_heart_rate'],145)
        self.assertEqual(evidence['laps'][0]['averageHeartRate'],155)
        self.assertEqual(row['average_cadence_steps_per_minute'],171)
        self.assertEqual(row['average_pace_seconds_per_km'],300)
        self.assertEqual(row['duration_seconds'],300)
        self.assertEqual(row['elapsed_time_seconds'],330)
        self.assertIn('paused_work_lap',evidence['warnings'])
        self.assertFalse(evidence['lapsComplete'])

    def test_records_do_not_fill_a_missing_session_average(self):
        normalized = decode_activity(fixture(None), '101', LA)
        self.assertIsNone(normalized['average_heart_rate_bpm'])
        self.assertIsNone(normalized['metric_sources']['average_heart_rate_bpm'])
        self.assertIn('missing:average_heart_rate_bpm',normalized['warnings'])

    def test_maximum_heart_rate_lap_cadence_and_record_series_are_current_gaps(self):
        data = fixture()
        messages, errors = Decoder(Stream.from_byte_array(bytearray(data))).read(
            apply_scale_and_offset=True, convert_datetimes_to_dates=True,
            convert_types_to_strings=True, enable_crc_check=True)
        self.assertFalse(errors)
        available = audit.inspect_messages(messages)
        self.assertTrue(available['sessionMaximumHeartRate'])
        self.assertEqual(available['lapCadence'],1)
        self.assertEqual(available['recordHeartRate'],3)
        normalized = decode_activity(data, '101', LA)
        evidence = decode_intensity(data)
        payload = json.dumps([normalized,evidence])
        for key in ['max_heart_rate','record_mesgs','position_lat']:
            self.assertNotIn(key,payload)
        self.assertNotIn('cadence',json.dumps(evidence).lower())
        self.assertEqual(set(evidence['laps'][0]), {
            'distanceMeters','timerSeconds','paceSecondsPerKm','averageHeartRate','intensity'})

    def test_availability_counts_distinguish_absent_and_invalid_source_values(self):
        counts = audit.inspect_messages({'session_mesgs':[{'avg_heart_rate':0}],
            'lap_mesgs':[{'avg_heart_rate':160,'max_heart_rate':180},{'avg_heart_rate':None}],
            'record_mesgs':[{'heart_rate':150,'speed':3},{'heart_rate':255},{}]})
        self.assertFalse(counts['sessionAverageHeartRate'])
        self.assertEqual(counts['lapAverageHeartRate'],1)
        self.assertEqual(counts['lapMaximumHeartRate'],1)
        self.assertEqual(counts['records'],3)
        self.assertEqual(counts['recordHeartRate'],1)
        self.assertEqual(counts['recordSpeed'],1)
