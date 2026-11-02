"""Read-only machine bridge for audit-training-evidence.mjs.

Private measurements travel only over the parent process pipe. Never run this
helper to create a committed report. No manifests or normalized files are written.
"""
import hashlib
import json
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

from garmin_fit_sdk import Decoder, Stream
from traini_collector.fit import decode_activity
from traini_collector.intensity import decode_intensity, metric
from traini_collector.parsing import read_regular
from traini_collector.storage import MAX_FIT_BYTES
from traini_collector.upload import activity_row


def inspect_messages(messages):
    session = messages['session_mesgs'][0]
    laps = messages.get('lap_mesgs', [])
    records = messages.get('record_mesgs', [])
    return {
        'sessionAverageHeartRate': metric(session.get('avg_heart_rate'), 1, 254) is not None,
        'sessionMaximumHeartRate': metric(session.get('max_heart_rate'), 1, 254) is not None,
        'sessionMovingTime': metric(session.get('total_moving_time')) is not None,
        'sessionCadence': any(metric(session.get(k)) is not None for k in ('avg_running_cadence', 'avg_cadence')),
        'laps': len(laps),
        'lapAverageHeartRate': sum(metric(l.get('avg_heart_rate'), 1, 254) is not None for l in laps),
        'lapMaximumHeartRate': sum(metric(l.get('max_heart_rate'), 1, 254) is not None for l in laps),
        'lapCadence': sum(metric(l.get('avg_cadence')) is not None for l in laps),
        'records': len(records),
        'recordHeartRate': sum(metric(r.get('heart_rate'), 1, 254) is not None for r in records),
        'recordSpeed': sum(any(metric(r.get(k)) is not None for k in ('enhanced_speed', 'speed')) for r in records),
        'recordCadence': sum(metric(r.get('cadence')) is not None for r in records),
    }


def audit_file(path, root, timezone):
    contents = read_regular(path, MAX_FIT_BYTES)
    document = decode_activity(contents, path.stem, timezone)
    document['source']['file'] = path.name
    messages, errors = Decoder(Stream.from_byte_array(bytearray(contents))).read(
        apply_scale_and_offset=True, convert_datetimes_to_dates=True,
        convert_types_to_strings=True, enable_crc_check=True,
        expand_sub_fields=True, expand_components=True, merge_heart_rates=False)
    if errors:
        raise ValueError('decode_failed')
    normalized_path = root / 'normalized' / f'{path.stem}.json'
    normalized = read_regular(normalized_path, 65536) if normalized_path.exists() else None
    row = activity_row(document, 'not-exported', hashlib.sha256(normalized or b'').hexdigest())
    del row['user_id']
    return {
        'row': row,
        'normalizedMatches': json.loads(normalized) == document if normalized else False,
        'evidence': decode_intensity(contents),
        'capabilities': inspect_messages(messages),
    }


if __name__ == '__main__':
    try:
        options = json.load(sys.stdin)
        root = Path(options['dataDir'])
        paths = sorted((root / 'activities').glob('*'))
        results = [audit_file(p, root, ZoneInfo(options['timezone'])) for p in paths if p.suffix.lower() == '.fit']
        print(json.dumps(results, allow_nan=False))
    except Exception:
        # Decoder errors may contain private data; keep the process boundary generic.
        print('FIT evidence audit failed', file=sys.stderr)
        sys.exit(1)
