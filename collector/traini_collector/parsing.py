"""Offline batch processing with atomic outputs and an explicit run manifest."""

import fcntl
import hashlib
import json
import stat
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Callable
from zoneinfo import ZoneInfo

from .fit import PARSER_VERSION, SCHEMA_VERSION, SDK_VERSION, FitParseError, decode_activity, valid_activity_id
from .storage import MAX_FIT_BYTES, atomic_write, private_directory, write_json


class ParsingBusyError(ValueError):
    pass


@dataclass
class ParseResult:
    found: int = 0
    processed: int = 0
    skipped: int = 0
    failed: int = 0


def read_regular(path: Path, limit: int) -> bytes:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise FitParseError("unsafe_file")
    if info.st_size > limit:
        raise FitParseError("file_too_large")
    with path.open("rb") as stream:
        contents = stream.read(limit + 1)
    if len(contents) > limit:
        raise FitParseError("file_too_large")
    return contents


def parse_activities(data_dir: Path, timezone: ZoneInfo,
                     report: Callable[[str], None] = print) -> ParseResult:
    """Re-decode each file; leave identical normalized documents untouched.

    parse-state.json is the authoritative set of this run's successful results.
    A failed input keeps any older output for recovery, but is never marked as
    usable in the manifest. Re-running repairs damaged or outdated JSON too.
    """
    activity_dir = data_dir / "activities"
    if activity_dir.is_symlink() or not activity_dir.is_dir():
        raise ValueError("activities 폴더를 확인해 주세요. FIT 수집을 먼저 실행해야 합니다.")
    private_directory(data_dir)
    lock_path = data_dir / ".sync.lock"
    if lock_path.is_symlink():
        raise ValueError("동기화 잠금 경로가 유효하지 않습니다.")
    with lock_path.open("a") as lock:
        lock_path.chmod(0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ParsingBusyError("수집 또는 FIT 분석이 실행 중입니다. 완료 후 다시 실행해 주세요.") from None
        return _parse_locked(data_dir, timezone, report)


def _parse_locked(data_dir: Path, timezone: ZoneInfo, report: Callable[[str], None], *,
                  filenames: list[str] | None = None,
                  period: tuple[date, date] | None = None,
                  on_progress: Callable[[ParseResult], None] | None = None) -> ParseResult:
    """Caller must hold .sync.lock for the entire operation, including upload.

    A web import supplies only files confirmed by its own collection run. The
    standalone CLI retains its all-files behavior.
    """
    activity_dir = data_dir / "activities"
    if activity_dir.is_symlink() or not activity_dir.is_dir():
        raise ValueError("Invalid activities directory")
    if filenames is not None:
        if any(name != f"{Path(name).stem}.fit" or not valid_activity_id(Path(name).stem) for name in filenames):
            raise ValueError("Invalid selected FIT filename")
        files = [activity_dir / name for name in sorted(set(filenames))]
    else:
        files = sorted((path for path in activity_dir.iterdir()
                        if path.suffix.lower() == ".fit"), key=lambda path: path.name)
    output_dir = data_dir / "normalized"
    private_directory(output_dir)
    state_path = data_dir / "parse-state.json"
    result = ParseResult(found=len(files))
    entries = {path.name: {"status": "pending"} for path in files}
    manifest = {
        "version": 1, "schema_version": SCHEMA_VERSION, "parser_version": PARSER_VERSION,
        "decoder_version": SDK_VERSION, "training_timezone": timezone.key,
        "status": "running", "started_at": datetime.now(UTC).isoformat(),
        "finished_at": None, "counts": asdict(result), "files": entries,
    }
    # Invalidate previous eligibility before processing; interrupted runs leave
    # pending files explicitly visible instead of advertising stale successes.
    write_json(state_path, manifest)
    if on_progress is not None:
        on_progress(result)
    ids: dict[str, int] = {}
    for path in files:
        ids[path.stem] = ids.get(path.stem, 0) + 1
    for index, path in enumerate(files, 1):
        activity_id = path.stem
        entry: dict = {"activity_id": activity_id if valid_activity_id(activity_id) else None}
        label = f"활동 {activity_id}" if entry["activity_id"] else f"FIT 파일 {index}"
        try:
            if not valid_activity_id(activity_id):
                raise FitParseError("invalid_filename")
            if ids[activity_id] != 1:
                raise FitParseError("duplicate_activity_id")
            contents = read_regular(path, MAX_FIT_BYTES)
            entry["source_sha256"] = hashlib.sha256(contents).hexdigest()
            normalized = decode_activity(contents, activity_id, timezone)
            if period is not None and not period[0] <= date.fromisoformat(normalized["training_date"]) <= period[1]:
                raise FitParseError("outside_import_period")
            normalized["source"]["file"] = path.name
            output = output_dir / f"{activity_id}.json"
            encoded = (json.dumps(normalized, ensure_ascii=False, allow_nan=False, indent=2) + "\n").encode()
            existing = None
            try:
                existing = read_regular(output, 65_536)
            except FileNotFoundError:
                pass
            except FitParseError as error:
                if error.code == "unsafe_file":
                    raise
                # An oversized/corrupted derived file can be rebuilt from FIT.
            if existing == encoded:
                output.chmod(0o600)
                result.skipped += 1
                outcome = "기존 분석 확인"
            else:
                atomic_write(output, encoded)
                result.processed += 1
                outcome = "분석 완료"
            entry.update(status="complete", normalized_file=f"normalized/{output.name}",
                         normalized_sha256=hashlib.sha256(encoded).hexdigest(),
                         warnings=normalized["warnings"])
        except Exception as error:
            result.failed += 1
            if isinstance(error, FitParseError):
                code = error.code
            elif isinstance(error, OSError):
                code = "storage_error"
            else:
                code = "parser_failed"
            entry.update(status="failed", error_code=code)
            outcome = f"실패 ({code}) · 원본 유지, 다음 실행에서 재시도"
        entries[path.name] = entry
        manifest["counts"] = asdict(result)
        # A manifest write failure is fatal: never claim a checkpoint was saved.
        write_json(state_path, manifest)
        if on_progress is not None:
            on_progress(result)
        report(f"{label} · {outcome}")
    manifest["status"] = "partial" if result.failed else "complete"
    manifest["finished_at"] = datetime.now(UTC).isoformat()
    write_json(state_path, manifest)
    return result
