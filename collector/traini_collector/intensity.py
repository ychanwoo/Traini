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
    previous_start = None
    previous_lap = None
    for lap in laps[:160]:
        start = lap.get('start_time')
        elapsed = metric(lap.get('total_elapsed_time'))
        distance = metric(lap.get('total_distance'))
        timer = metric(lap.get('total_timer_time'))
        valid_time = isinstance(start, datetime) and start.utcoffset() is not None
        if not valid_time or elapsed is None or timer is None or distance is None or timer <= 0 or distance <= 0:
            warnings.append('missing_lap_measurements')
        if elapsed is not None and timer is not None and timer > elapsed + 1:
            warnings.append('invalid_lap_duration')
        if elapsed is not None and timer is not None and elapsed - timer > 3:
            warnings.append('paused_non_work_lap' if lap.get('intensity') in {'warmup', 'cooldown', 'rest', 'recovery'} else 'paused_work_lap')
        if valid_time and previous_end is not None:
            overlap = previous_end - start.timestamp()
            # Some Garmin workout transitions include a <10m tail lap whose
            # millisecond duration overlaps the next second-resolution start.
            # Tolerate only this bounded, forward-moving warmup/cooldown edge.
            transition = (previous_lap is not None and previous_start < start.timestamp()
                          and previous_lap.get('intensity') in {'warmup', 'cooldown'}
                          and previous_lap.get('intensity') != lap.get('intensity')
                          and 0 < (metric(previous_lap.get('total_distance')) or 0) <= 10
                          and 0 < (metric(previous_lap.get('total_elapsed_time')) or 0) <= 5
                          and overlap <= 2)
            if overlap > 1:
                warnings.append('transition_time_tolerance' if transition else 'overlapping_laps')
            if overlap < -3:
                warnings.append('lap_time_gap')
        if valid_time and elapsed is not None:
            previous_end = start.timestamp() + elapsed
            previous_start = start.timestamp()
            previous_lap = lap
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
            'lapCount': len(laps), 'lapsComplete': not (set(warnings) - {'transition_time_tolerance', 'paused_non_work_lap'}) and len(normalized) == len(laps) and bool(laps),
            'laps': normalized, 'warnings': sorted(set(warnings))}


def decode_intensity(contents):
    messages, errors = Decoder(Stream.from_byte_array(bytearray(contents))).read(
        apply_scale_and_offset=True, convert_datetimes_to_dates=True, convert_types_to_strings=True,
        enable_crc_check=True, expand_sub_fields=True, expand_components=True, merge_heart_rates=False)
    if errors:
        raise FitParseError('decode_failed')
    return normalize_intensity(messages)
