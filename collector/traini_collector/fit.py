"""Decode one running session into a deterministic, unit-explicit activity.

Only session summaries are exported. GPS, device IDs, and record messages never
enter the normalized document. Missing metrics are not reconstructed from samples.
"""

import hashlib
import math
import re
from datetime import UTC, datetime
from importlib.metadata import version
from typing import Any
from zoneinfo import ZoneInfo

from garmin_fit_sdk import Decoder, Stream

from .periods import training_week
from .storage import validate_fit

SCHEMA_VERSION = 1
PARSER_VERSION = 1
SDK_VERSION = version("garmin-fit-sdk")


class FitParseError(ValueError):
    """Stable error code, safe to persist without SDK diagnostics."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def valid_activity_id(value: str) -> bool:
    return bool(re.fullmatch(r"[1-9][0-9]{0,19}", value)) and int(value) <= 2**64 - 1


def decode_activity(contents: bytes, activity_id: str, timezone: ZoneInfo) -> dict[str, Any]:
    if not valid_activity_id(activity_id):
        raise FitParseError("invalid_activity_id")
    try:
        validate_fit(contents)
    except ValueError:
        raise FitParseError("invalid_fit") from None
    try:
        messages, errors = Decoder(Stream.from_byte_array(bytearray(contents))).read(
            apply_scale_and_offset=True, convert_datetimes_to_dates=True,
            convert_types_to_strings=True, enable_crc_check=True,
            expand_sub_fields=True, expand_components=True, merge_heart_rates=False,
        )
    except Exception:
        raise FitParseError("decode_failed") from None
    if errors:
        raise FitParseError("decode_failed")
    normalized = normalize_messages(messages, activity_id, timezone)
    return {
        "schema_version": SCHEMA_VERSION, "parser_version": PARSER_VERSION,
        "decoder": {"name": "garmin-fit-sdk", "version": SDK_VERSION},
        "source": {"file": f"{activity_id}.fit", "sha256": hashlib.sha256(contents).hexdigest()},
        **normalized,
    }


def normalize_messages(messages: dict[str, Any], activity_id: str, timezone: ZoneInfo) -> dict[str, Any]:
    file_ids = messages.get("file_id_mesgs", [])
    if len(file_ids) != 1 or file_ids[0].get("type") != "activity":
        raise FitParseError("unsupported_file_type")
    sessions = messages.get("session_mesgs", [])
    # Do not silently drop, combine, or double-count multisport sessions.
    if len(sessions) != 1:
        raise FitParseError("unsupported_session_count")
    session = sessions[0]
    if session.get("sport") != "running":
        raise FitParseError("unsupported_sport")
    started = session.get("start_time")
    if not isinstance(started, datetime) or started.utcoffset() is None:
        raise FitParseError("missing_start_time")
    started = started.astimezone(UTC)
    local = started.astimezone(timezone)
    monday, sunday = training_week(local.date())
    sources: dict[str, str | None] = {}
    warnings: list[str] = []

    def number(field: str, minimum: float = 0, maximum: float = math.inf) -> float | None:
        value = session.get(field)
        if value is None:
            return None
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or not math.isfinite(value) or not minimum <= value <= maximum):
            warnings.append(f"invalid:{field}")
            return None
        return float(value)

    def metric(name: str, field: str, minimum: float = 0, maximum: float = math.inf) -> float | None:
        value = number(field, minimum, maximum)
        sources[name] = f"session.{field}" if value is not None else None
        if value is None:
            warnings.append(f"missing:{name}")
        return value

    distance = metric("distance_meters", "total_distance")
    elapsed = metric("elapsed_time_seconds", "total_elapsed_time")
    timer = metric("timer_time_seconds", "total_timer_time")
    moving = metric("moving_time_seconds", "total_moving_time")
    heart_rate = metric("average_heart_rate_bpm", "avg_heart_rate", 1, 254)
    if timer is not None and elapsed is not None and timer > elapsed + 0.01:
        warnings.append("inconsistent:timer_time_seconds")
        timer = None
        sources["timer_time_seconds"] = None
    moving_limit = timer if timer is not None else elapsed
    if moving is not None and moving_limit is not None and moving > moving_limit + 0.01:
        warnings.append("inconsistent:moving_time_seconds")
        moving = None
        sources["moving_time_seconds"] = None

    cadence_field = "avg_running_cadence" if session.get("avg_running_cadence") is not None else "avg_cadence"
    cadence = number(cadence_field, 0, 254)
    fraction = number("avg_fractional_cadence", 0, 127 / 128)
    sources["average_cadence_steps_per_minute"] = None
    if cadence is not None:
        # FIT running cadence is strides/minute; Garmin Connect displays steps/minute.
        cadence = (cadence + (fraction or 0)) * 2
        fields = cadence_field + ("+avg_fractional_cadence" if fraction is not None else "")
        sources["average_cadence_steps_per_minute"] = f"2*(session.{fields})"
    else:
        warnings.append("missing:average_cadence_steps_per_minute")

    pace = None
    sources["average_pace_seconds_per_km"] = None
    if distance is not None and distance > 0 and timer is not None and timer > 0:
        pace = timer * 1000 / distance
        sources["average_pace_seconds_per_km"] = "timer_time_seconds/distance_meters*1000"
    elif timer is None and (distance is None or distance > 0):
        for field in ("enhanced_avg_speed", "avg_speed"):
            speed = number(field)
            if speed is not None and speed > 0:
                pace = 1000 / speed
                sources["average_pace_seconds_per_km"] = f"1000/session.{field}"
                break
    if pace is None:
        warnings.append("missing:average_pace_seconds_per_km")

    def rounded(value: float | None) -> float | None:
        return round(value, 6) if value is not None else None

    sub_sport = session.get("sub_sport")
    return {
        "activity_id": activity_id, "sport": "running",
        "sub_sport": sub_sport if isinstance(sub_sport, str) else None,
        "started_at": started.isoformat(), "started_at_local": local.isoformat(),
        "training_date": local.date().isoformat(), "training_timezone": timezone.key,
        "training_week_starts_on": monday.isoformat(), "training_week_ends_on": sunday.isoformat(),
        "distance_meters": rounded(distance), "elapsed_time_seconds": rounded(elapsed),
        "timer_time_seconds": rounded(timer), "moving_time_seconds": rounded(moving),
        "average_pace_seconds_per_km": rounded(pace),
        "average_heart_rate_bpm": rounded(heart_rate),
        "average_cadence_steps_per_minute": rounded(cadence),
        "metric_sources": sources, "warnings": warnings,
    }
