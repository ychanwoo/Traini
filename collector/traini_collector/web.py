"""Non-interactive local worker for the authenticated Traini web server."""

import argparse
import contextlib
import fcntl
import json
import os
import signal
from dataclasses import asdict
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

from .auth import authenticate
from .parsing import ParseResult, _parse_locked
from .upload import UploadError, UploadResult, SupabaseActivityStore, _upload_locked, read_manifest
from .periods import CollectionPeriod, select_period, today_in_zone, training_week, previous_training_week
from .storage import private_directory, write_json
from .sync import SyncResult, sync_activities

TIMEOUT_SECONDS = 300


class WorkerStopped(BaseException):
    """Bypass network-library retries and per-activity exception handling."""


def error_code(error: BaseException) -> str:
    name = type(error).__name__
    if isinstance(error, WorkerStopped):
        return "timeout"
    if isinstance(error, UploadError):
        if error.code == "invalid_configuration":
            return "upload_setup_required"
        if error.code in {"connection_failed", "temporarily_unavailable"}:
            return "upload_connection"
        return "upload_failed"
    if "Authentication" in name or "MFA" in name:
        return "auth_required"
    if "TooManyRequests" in name:
        return "rate_limited"
    if "Connection" in name:
        return "connection"
    if isinstance(error, OSError):
        return "storage"
    return "collector_failed"


def notify(kind: str, **fields: object) -> None:
    print(json.dumps({"kind": kind, **fields}), flush=True)


def create_store() -> SupabaseActivityStore:
    return SupabaseActivityStore(os.environ.get("NEXT_PUBLIC_SUPABASE_URL", ""),
                                 os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
                                 os.environ.get("TRAINI_ADMIN_USER_ID", ""))


def web_period(today: date, start: date | None = None, end: date | None = None) -> CollectionPeriod:
    if start is None and end is None:
        return select_period(today)
    # The server fixes the range before spawning us. Accept today's selections
    # and yesterday's selections for a worker starting across local midnight.
    allowed = set()
    for request_day in (today, today - timedelta(days=1)):
        allowed.add(previous_training_week(request_day))
        allowed.add((training_week(request_day)[0], request_day))
    if start is None or end is None or (start, end) not in allowed or end > today:
        raise ValueError("Invalid web collection period")
    current = training_week(today)
    return CollectionPeriod(start, end, "current_week" if start == current[0] else "previous_week")



def run_worker(data_dir: Path, token_dir: Path, timezone: ZoneInfo,
               start: date | None = None, end: date | None = None) -> int:
    private_directory(data_dir)
    lock_path = data_dir / ".sync.lock"
    if lock_path.is_symlink():
        raise ValueError("Invalid lock path")
    with lock_path.open("a") as lock:
        lock_path.chmod(0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            notify("busy")
            return 1
        period = web_period(today_in_zone(timezone), start, end)
        job_path = data_dir / "web-sync.json"
        job = {
            "version": 2, "id": str(uuid4()), "pid": os.getpid(), "status": "running",
            "stage": "authenticating", "startedAt": datetime.now(UTC).isoformat(),
            "finishedAt": None, "errorCode": None,
            "period": {"start": period.start.isoformat(), "end": period.end.isoformat(),
                       "timezone": timezone.key}, "counts": asdict(SyncResult()),
            "parsing": asdict(ParseResult()), "upload": asdict(UploadResult()),
            "uploadStarted": False, "failedStage": None,
        }
        write_json(job_path, job)
        notify("started")

        def progress(result: SyncResult) -> None:
            job["counts"] = asdict(result)
            write_json(job_path, job)

        selected: list[str] = []

        def collected(entry: dict) -> None:
            if entry["status"] == "complete":
                selected.append(entry["file"])

        def parsed(result: ParseResult) -> None:
            job["parsing"] = asdict(result)
            write_json(job_path, job)

        def uploaded(result: UploadResult) -> None:
            job["upload"] = asdict(result)
            write_json(job_path, job)

        store = None
        try:
            store = create_store()
            # Do not let third-party diagnostics enter the HTTP process pipe.
            with open(os.devnull, "w") as quiet, contextlib.redirect_stdout(quiet):
                client = authenticate(token_dir, non_interactive=True)
                job["stage"] = "collecting"
                write_json(job_path, job)
                from garminconnect import Garmin
                result = sync_activities(
                    client, period.start, period.end, data_dir,
                    Garmin.ActivityDownloadFormat.ORIGINAL, lambda _: None,
                    timezone=timezone, period_mode=period.mode, on_progress=progress,
                    on_activity=collected,
                )
            job["counts"] = asdict(result)
            job["stage"] = "parsing"
            write_json(job_path, job)
            parsed_result = _parse_locked(data_dir, timezone, lambda _: None,
                                          filenames=selected, period=(period.start, period.end),
                                          on_progress=parsed)
            job["parsing"] = asdict(parsed_result)
            job["stage"] = "uploading"
            # Even a lost RPC response may mean a committed write. The UI must
            # refresh after any terminal run that entered upload, including failures.
            job["uploadStarted"] = True
            write_json(job_path, job)
            store.verify_owner()
            manifest, manifest_hash = read_manifest(data_dir)
            uploaded_result = _upload_locked(data_dir, store, manifest, manifest_hash,
                                             lambda _: None, on_progress=uploaded)
            job["upload"] = asdict(uploaded_result)
            failures = [(result.failed, "partial_download", "collecting"),
                        (parsed_result.failed, "partial_parse", "parsing"),
                        (uploaded_result.failed, "partial_upload", "uploading")]
            job["status"] = "succeeded"
            for count, code, stage in failures:
                if count:
                    job["status"] = "partial"
                    job["errorCode"] = code
                    job["failedStage"] = stage
                    break
        except (Exception, WorkerStopped, KeyboardInterrupt) as error:
            job["status"] = "failed"
            job["errorCode"] = error_code(error)
            if job["errorCode"] == "collector_failed" and job["stage"] == "parsing":
                job["errorCode"] = "parse_failed"
            job["failedStage"] = job["stage"]
        finally:
            try:
                job["stage"] = "finished"
                job["finishedAt"] = datetime.now(UTC).isoformat()
                write_json(job_path, job)
            finally:
                if store is not None:
                    store.close()
        return 0 if job["status"] == "succeeded" else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Traini local web collector")
    parser.add_argument("--timezone", default="America/Los_Angeles")
    parser.add_argument("--start", type=date.fromisoformat)
    parser.add_argument("--end", type=date.fromisoformat)
    args = parser.parse_args()
    os.umask(0o077)

    def stop(_signum: int, _frame: object) -> None:
        raise WorkerStopped()

    signal.signal(signal.SIGALRM, stop)
    signal.signal(signal.SIGTERM, stop)
    signal.alarm(TIMEOUT_SECONDS)
    try:
        return run_worker(Path.home() / "Projects/Traini-data/garmin",
                          Path.home() / "Library/Application Support/Traini/auth",
                          ZoneInfo(args.timezone), args.start, args.end)
    except (Exception, WorkerStopped) as error:
        notify("error", code=error_code(error))
        return 1
    finally:
        signal.alarm(0)


if __name__ == "__main__":
    raise SystemExit(main())
