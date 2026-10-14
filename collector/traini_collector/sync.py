"""Incremental, resumable collection of Garmin running originals."""

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, Callable, Protocol

from .storage import atomic_write, extract_fit, private_directory, validate_fit, write_json


class ActivityClient(Protocol):
    def get_activities_by_date(self, startdate: str, enddate: str,
                              activitytype: str, sortorder: str) -> list[dict[str, Any]]: ...
    def download_activity(self, activity_id: str, dl_fmt: Any) -> bytes: ...


@dataclass
class SyncResult:
    found: int = 0
    downloaded: int = 0
    skipped: int = 0
    failed: int = 0


def read_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "activities": {}}
    if path.is_symlink():
        raise ValueError("동기화 기록은 심볼릭 링크를 사용할 수 없습니다.")
    try:
        state = json.loads(path.read_text())
    except (ValueError, OSError):
        raise ValueError("sync-state.json을 읽을 수 없습니다. 원본 FIT는 유지됩니다.") from None
    if not isinstance(state, dict) or state.get("version") != 1 or not isinstance(state.get("activities"), dict):
        raise ValueError("동기화 기록 형식을 확인해 주세요.")
    return state


def sync_activities(client: ActivityClient, start: date, end: date, data_dir: Path,
                    original_format: Any, report: Callable[[str], None] = print) -> SyncResult:
    if start > end:
        raise ValueError("시작일은 종료일보다 늦을 수 없습니다.")
    private_directory(data_dir)
    activity_dir = data_dir / "activities"
    private_directory(activity_dir)
    state_path = data_dir / "sync-state.json"
    state = read_state(state_path)
    # Garmin applies its running category filter, including running subtypes.
    activities = client.get_activities_by_date(start.isoformat(), end.isoformat(),
                                               activitytype="running", sortorder="asc")
    if not isinstance(activities, list):
        raise ValueError("Garmin 활동 목록 응답이 유효하지 않습니다.")
    result = SyncResult()
    seen: set[str] = set()
    for activity in activities:
        if not isinstance(activity, dict):
            raise ValueError("Garmin 활동 항목이 유효하지 않습니다.")
        activity_id = str(activity.get("activityId", ""))
        if not activity_id.isascii() or not activity_id.isdecimal() or int(activity_id) <= 0:
            raise ValueError("Garmin 활동 ID가 유효하지 않습니다.")
        if activity_id in seen:
            continue
        seen.add(activity_id)
        local_start = activity.get("startTimeLocal")
        try:
            activity_date = date.fromisoformat(str(local_start)[:10])
        except ValueError:
            raise ValueError("Garmin 활동 시작 날짜가 유효하지 않습니다.") from None
        if not start <= activity_date <= end:
            continue
        kind = activity.get("activityType", {}).get("typeKey", "")
        if kind not in {"running", "virtual_run", "ultra_run", "obstacle_run"} and not kind.endswith("_running"):
            raise ValueError("러닝 조회 결과에 다른 종목이 포함되어 있습니다.")
        result.found += 1
        path = activity_dir / f"{activity_id}.fit"
        entry = {"activity_id": activity_id, "started_at_local": local_start,
                 "activity_type": kind, "distance_meters": activity.get("distance"),
                 "duration_seconds": activity.get("duration"),
                 "average_heart_rate": activity.get("averageHR"), "file": path.name}
        try:
            if path.is_symlink():
                raise ValueError("FIT 경로가 심볼릭 링크입니다.")
            existing = None
            if path.exists():
                try:
                    if path.stat().st_size <= 64 * 1024 * 1024:
                        existing = path.read_bytes()
                        validate_fit(existing)
                except ValueError:
                    existing = None
            if existing is not None:
                contents = existing
                result.skipped += 1
                label = "기존 파일 확인"
            else:
                contents = extract_fit(client.download_activity(activity_id, dl_fmt=original_format))
                atomic_write(path, contents)
                result.downloaded += 1
                label = "다운로드 완료"
            entry.update(status="complete", sha256=hashlib.sha256(contents).hexdigest(),
                         synced_at=datetime.now(UTC).isoformat())
            report(f"{activity_date} · 활동 {activity_id} · {label}")
        except Exception as error:
            # Persist the type, not a third-party error message that may expose tokens.
            result.failed += 1
            entry.update(status="failed", error_type=type(error).__name__)
            report(f"{activity_date} · 활동 {activity_id} · 실패 ({type(error).__name__}), 재실행 시 재시도")
        state["activities"][activity_id] = entry
        write_json(state_path, state)
    state["last_run"] = {"started_on": start.isoformat(), "ended_on": end.isoformat(),
                         "finished_at": datetime.now(UTC).isoformat(), **asdict(result)}
    if result.failed == 0:
        state["last_successful_run"] = state["last_run"]
    write_json(state_path, state)
    return result
