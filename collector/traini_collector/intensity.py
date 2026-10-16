"""Privacy-preserving FIT lap evidence; never exports GPS or device/user records."""
import math
from datetime import datetime
from garmin_fit_sdk import Decoder, Stream
from .fit import FitParseError


def metric(value, minimum=0, maximum=math.inf):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not minimum <= value <= maximum:
        return None
    return round(float(value), 6)


def normalize_intensity(messages):
    sessions = messages.get('session_mesgs', [])
    if len(sessions) != 1 or sessions[0].get('sport') != 'running':
        raise FitParseError('unsupported_session_count')
    session = sessions[0]
    laps = messages.get('lap_mesgs', [])
    warnings = []
    normalized = []
    previous_end = None
    for lap in laps[:160]:
        start = lap.get('start_time')
        elapsed = metric(lap.get('total_elapsed_time'))
        distance = metric(lap.get('total_distance'))
        timer = metric(lap.get('total_timer_time'))
        valid_time = isinstance(start, datetime) and start.utcoffset() is not None
        if valid_time and previous_end is not None and start.timestamp() < previous_end - 1:
            warnings.append('overlapping_laps')
        if valid_time and elapsed is not None:
            previous_end = start.timestamp() + elapsed
        pace = round(timer / distance * 1000, 3) if distance and timer and 60 <= timer / distance * 1000 <= 3600 else None
        kind = lap.get('intensity')
        normalized.append({'distanceMeters': distance, 'timerSeconds': timer, 'paceSecondsPerKm': pace,
                           'averageHeartRate': metric(lap.get('avg_heart_rate'), 1, 254),
                           'intensity': kind if kind in {'warmup', 'cooldown', 'active', 'rest', 'recovery', 'interval'} else None})
    if len(laps) > 160:
        warnings.append('laps_truncated')
    distance = metric(session.get('total_distance'))
    if distance is not None and normalized and all(l['distanceMeters'] is not None for l in normalized):
        if abs(sum(l['distanceMeters'] for l in normalized) - distance) > max(20, distance * .01):
            warnings.append('lap_distance_mismatch')
    return {'version': 1, 'aerobicTrainingEffect': metric(session.get('total_training_effect'), 0, 5),
            'anaerobicTrainingEffect': metric(session.get('total_anaerobic_training_effect'), 0, 5),
            'lapCount': len(laps), 'lapsComplete': not warnings and len(normalized) == len(laps) and bool(laps),
            'laps': normalized, 'warnings': sorted(set(warnings))}


def decode_intensity(contents):
    messages, errors = Decoder(Stream.from_byte_array(bytearray(contents))).read(
        apply_scale_and_offset=True, convert_datetimes_to_dates=True, convert_types_to_strings=True,
        enable_crc_check=True, expand_sub_fields=True, expand_components=True, merge_heart_rates=False)
    if errors:
        raise FitParseError('decode_failed')
    return normalize_intensity(messages)
