"""Non-interactive local worker for the authenticated Traini web server."""

import argparse
import contextlib
import fcntl
import json
import os
import signal
import sys
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

from .auth import authenticate
from .periods import select_period, today_in_zone
from .storage import private_directory, write_json
from .sync import SyncResult, sync_activities

TIMEOUT_SECONDS = 300


class WorkerStopped(BaseException):
    """Bypass network-library retries and per-activity exception handling."""


def error_code(error: BaseException) -> str:
    name = type(error).__name__
    if isinstance(error, WorkerStopped):
        return "timeout"
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


def run_worker(data_dir: Path, token_dir: Path, timezone: ZoneInfo) -> int:
    private_directory(data_dir)
    lock_path = data_dir / ".sync.lock"
    if lock_path.is_symlink():
        raise ValueError("Invalid lock path")
    with lock_path.open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            notify("busy")
            return 1
        period = select_period(today_in_zone(timezone))
        job_path = data_dir / "web-sync.json"
        job = {
            "id": str(uuid4()), "pid": os.getpid(), "status": "running",
            "stage": "authenticating", "startedAt": datetime.now(UTC).isoformat(),
            "finishedAt": None, "errorCode": None,
            "period": {"start": period.start.isoformat(), "end": period.end.isoformat(),
                       "timezone": timezone.key}, "counts": asdict(SyncResult()),
        }
        write_json(job_path, job)
        notify("started")

        def progress(result: SyncResult) -> None:
            job["counts"] = asdict(result)
            write_json(job_path, job)

        try:
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
                )
            job["counts"] = asdict(result)
            job["status"] = "partial" if result.failed else "succeeded"
            job["errorCode"] = "partial_download" if result.failed else None
        except (Exception, WorkerStopped, KeyboardInterrupt) as error:
            job["status"] = "failed"
            job["errorCode"] = error_code(error)
        finally:
            job["stage"] = "finished"
            job["finishedAt"] = datetime.now(UTC).isoformat()
            write_json(job_path, job)
        return 0 if job["status"] == "succeeded" else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Traini local web collector")
    parser.add_argument("--timezone", default="America/Los_Angeles")
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
                          ZoneInfo(args.timezone))
    except (Exception, WorkerStopped) as error:
        notify("error", code=error_code(error))
        return 1
    finally:
        signal.alarm(0)


if __name__ == "__main__":
    raise SystemExit(main())
