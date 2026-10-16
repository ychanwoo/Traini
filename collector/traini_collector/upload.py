"""Verified, idempotent uploads to the existing Traini activities table."""

import fcntl
import hashlib
import json
import time
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse
from uuid import UUID
from zoneinfo import ZoneInfo

import requests

from .fit import PARSER_VERSION, SCHEMA_VERSION, SDK_VERSION, decode_activity, valid_activity_id
from .parsing import ParsingBusyError, read_regular
from .storage import MAX_FIT_BYTES, private_directory, write_json

PROJECT_REF = "kmmutfcgshellvjgpick"


class UploadError(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass
class UploadResult:
    found: int = 0
    eligible: int = 0
    validated: int = 0
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0
    failed: int = 0
    excluded: int = 0


def read_manifest(data_dir: Path) -> tuple[dict[str, Any], str]:
    contents = read_regular(data_dir / "parse-state.json", 8 * 1024 * 1024)
    try:
        manifest = json.loads(contents)
        files = manifest["files"]
        counts = manifest["counts"]
        if (type(manifest["version"]) is not int or manifest["version"] != 1
                or manifest["status"] not in {"complete", "partial"}
                or not isinstance(manifest["finished_at"], str)
                or datetime.fromisoformat(manifest["finished_at"]).utcoffset() is None
                or not isinstance(files, dict) or len(files) > 10000
                or any(not isinstance(entry, dict) or entry.get("status") not in {"complete", "failed"}
                       for entry in files.values())):
            raise ValueError
        if any(type(counts[key]) is not int or counts[key] < 0
               for key in ("found", "processed", "skipped", "failed")):
            raise ValueError
        complete = sum(entry["status"] == "complete" for entry in files.values())
        failed = len(files) - complete
        if (counts["found"] != len(files) or counts["processed"] + counts["skipped"] != complete
                or counts["failed"] != failed or (manifest["status"] == "complete" and failed)):
            raise ValueError
        ZoneInfo(manifest["training_timezone"])
        if (type(manifest["schema_version"]) is not int or manifest["schema_version"] != SCHEMA_VERSION
                or type(manifest["parser_version"]) is not int or manifest["parser_version"] != PARSER_VERSION
                or manifest["decoder_version"] != SDK_VERSION):
            raise UploadError("reparse_required")
    except UploadError:
        raise
    except (ValueError, KeyError, TypeError):
        raise UploadError("invalid_manifest") from None
    return manifest, hashlib.sha256(contents).hexdigest()


def verified_document(data_dir: Path, filename: str, entry: dict, timezone: ZoneInfo) -> dict:
    activity_id = entry.get("activity_id")
    if (not isinstance(activity_id, str) or not valid_activity_id(activity_id)
            or filename not in {f"{activity_id}.fit", f"{activity_id}.FIT"}
            or entry.get("normalized_file") != f"normalized/{activity_id}.json"):
        raise UploadError("invalid_manifest_entry")
    contents = read_regular(data_dir / "activities" / filename, MAX_FIT_BYTES)
    if hashlib.sha256(contents).hexdigest() != entry.get("source_sha256"):
        raise UploadError("source_changed")
    normalized = read_regular(data_dir / "normalized" / f"{activity_id}.json", 65_536)
    if hashlib.sha256(normalized).hexdigest() != entry.get("normalized_sha256"):
        raise UploadError("normalized_changed")
    # Reproduce the parser's complete schema from the original, not just hashes
    # supplied by a potentially stale/edited manifest. No untrusted JSON fields
    # can reach Supabase (including owner IDs or extra private record data).
    expected = decode_activity(contents, activity_id, timezone)
    expected["source"]["file"] = filename
    encoded = (json.dumps(expected, ensure_ascii=False, allow_nan=False, indent=2) + "\n").encode()
    if normalized != encoded:
        raise UploadError("reparse_required")
    return expected


def activity_row(document: dict, owner_id: str, normalized_sha256: str) -> dict:
    return {
        "user_id": owner_id, "garmin_activity_id": document["activity_id"],
        "activity_type": document["sport"], "sub_sport": document["sub_sport"],
        "started_at": document["started_at"], "distance_meters": document["distance_meters"],
        "duration_seconds": document["timer_time_seconds"],
        "elapsed_time_seconds": document["elapsed_time_seconds"],
        "moving_time_seconds": document["moving_time_seconds"],
        "average_heart_rate": document["average_heart_rate_bpm"],
        "average_pace_seconds_per_km": document["average_pace_seconds_per_km"],
        "average_cadence_steps_per_minute": document["average_cadence_steps_per_minute"],
        "training_date": document["training_date"], "training_timezone": document["training_timezone"],
        "source": "garmin_fit", "source_file": document["source"]["file"],
        "source_sha256": document["source"]["sha256"], "normalized_sha256": normalized_sha256,
        "normalized_schema_version": document["schema_version"], "parser_version": document["parser_version"],
        "decoder_name": document["decoder"]["name"], "decoder_version": document["decoder"]["version"],
        "metric_sources": document["metric_sources"], "warnings": document["warnings"],
    }


class SupabaseActivityStore:
    """Service credentials are used only by the local upload process."""

    def __init__(self, url: str, key: str, owner_id: str):
        parsed = urlparse(url)
        if (parsed.scheme != "https" or parsed.netloc != f"{PROJECT_REF}.supabase.co"
                or parsed.path not in {"", "/"} or parsed.query or parsed.fragment
                or not key or not owner_id):
            raise UploadError("invalid_configuration")
        try:
            if str(UUID(owner_id)) != owner_id:
                raise ValueError
        except ValueError:
            raise UploadError("invalid_configuration") from None
        self.url = url.rstrip("/")
        self.owner_id = owner_id
        self.session = requests.Session()
        self.session.headers.update({"apikey": key, "Authorization": f"Bearer {key}"})

    def close(self) -> None:
        self.session.close()

    def request(self, method: str, path: str, **options: Any) -> Any:
        # Never follow redirects carrying service credentials. Each retry is safe:
        # GETs are read-only and the import RPC is transactionally idempotent.
        for attempt in range(3):
            try:
                response = self.session.request(method, self.url + path, timeout=(5, 30),
                                                allow_redirects=False, **options)
            except requests.RequestException:
                if attempt == 2:
                    raise UploadError("connection_failed") from None
            else:
                if response.status_code not in {408, 429} and response.status_code < 500:
                    if not 200 <= response.status_code < 300:
                        code = "access_denied" if response.status_code in {401, 403} else "database_rejected"
                        if response.status_code == 404:
                            code = "schema_not_ready"
                        raise UploadError(code)
                    try:
                        return response.json()
                    except ValueError:
                        raise UploadError("invalid_response") from None
                if attempt == 2:
                    raise UploadError("temporarily_unavailable")
            time.sleep(2**attempt)
        raise UploadError("connection_failed")  # Defensive; the bounded loop always returns/raises.

    def verify_owner(self) -> None:
        user = self.request("GET", f"/auth/v1/admin/users/{self.owner_id}")
        profile = self.request("GET", "/rest/v1/profiles", params={"id": f"eq.{self.owner_id}", "select": "id"})
        if not isinstance(user, dict) or user.get("id") != self.owner_id:
            raise UploadError("owner_not_found")
        if (not isinstance(profile, list) or len(profile) != 1
                or not isinstance(profile[0], dict) or profile[0].get("id") != self.owner_id):
            raise UploadError("profile_missing")

    def save(self, row: dict) -> str:
        if row.get("user_id") != self.owner_id:
            raise UploadError("owner_mismatch")
        outcome = self.request("POST", "/rest/v1/rpc/import_garmin_activity", json={"p_activity": row})
        if not isinstance(outcome, str) or outcome not in {"inserted", "updated", "unchanged"}:
            raise UploadError("invalid_response")
        return outcome


def upload_activities(data_dir: Path, store: SupabaseActivityStore | None,
                      report: Callable[[str], None] = print) -> UploadResult:
    for name in ("activities", "normalized"):
        directory = data_dir / name
        if directory.is_symlink() or not directory.is_dir():
            raise UploadError("local_data_missing")
    private_directory(data_dir)
    lock_path = data_dir / ".sync.lock"
    if lock_path.is_symlink():
        raise UploadError("unsafe_lock")
    with lock_path.open("a") as lock:
        lock_path.chmod(0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ParsingBusyError("수집·분석·업로드가 실행 중입니다. 완료 후 다시 실행해 주세요.") from None
        manifest, manifest_hash = read_manifest(data_dir)
        if store is not None:
            store.verify_owner()
        return _upload_locked(data_dir, store, manifest, manifest_hash, report)


def _upload_locked(data_dir: Path, store: SupabaseActivityStore | None, manifest: dict,
                   manifest_hash: str, report: Callable[[str], None], *,
                   on_progress: Callable[[UploadResult], None] | None = None) -> UploadResult:
    """Caller must hold .sync.lock; each acknowledged RPC is checkpointed."""
    result = UploadResult(found=len(manifest["files"]))
    result.eligible = sum(entry["status"] == "complete" for entry in manifest["files"].values())
    result.excluded = result.found - result.eligible
    state = {
        "version": 1, "mode": "upload" if store is not None else "validate",
        "owner_id": store.owner_id if store is not None else None,
        "source_manifest_sha256": manifest_hash, "status": "running",
        "started_at": datetime.now(UTC).isoformat(), "finished_at": None,
        "counts": asdict(result),
        "files": {name: {"status": "pending" if entry["status"] == "complete" else "excluded"}
                  for name, entry in manifest["files"].items()},
    }
    state_path = data_dir / ("upload-state.json" if store is not None else "upload-validation.json")
    write_json(state_path, state)
    if on_progress is not None:
        on_progress(result)
    timezone = ZoneInfo(manifest["training_timezone"])
    labels = {"inserted": "새로 저장", "updated": "변경 갱신", "unchanged": "기존 기록 확인", "validated": "검증 완료"}
    for filename, entry in manifest["files"].items():
        if entry["status"] != "complete":
            continue
        activity_id = entry.get("activity_id")
        label = f"활동 {activity_id}" if isinstance(activity_id, str) and valid_activity_id(activity_id) else "FIT 파일"
        try:
            document = verified_document(data_dir, filename, entry, timezone)
            if store is None:
                result.validated += 1
                outcome = "validated"
            else:
                outcome = store.save(activity_row(document, store.owner_id, entry["normalized_sha256"]))
                setattr(result, outcome, getattr(result, outcome) + 1)
            state["files"][filename] = {"status": "complete", "outcome": outcome,
                                       "normalized_sha256": entry["normalized_sha256"]}
            message = labels[outcome]
        except Exception as error:
            result.failed += 1
            if isinstance(error, UploadError):
                code = error.code
            elif isinstance(error, OSError):
                code = "storage_error"
            else:
                code = "validation_failed"
            state["files"][filename] = {"status": "failed", "error_code": code}
            message = f"실패 ({code}) · 로컬 원본 유지, 재실행 시 재시도"
        state["counts"] = asdict(result)
        write_json(state_path, state)
        if on_progress is not None:
            on_progress(result)
        report(f"{label} · {message}")
    state["status"] = "partial" if result.failed or result.excluded else "complete"
    state["finished_at"] = datetime.now(UTC).isoformat()
    write_json(state_path, state)
    return result
