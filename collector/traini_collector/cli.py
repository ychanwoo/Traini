"""Traini collector command line; no credentials in arguments or state."""

import argparse
import fcntl
import os
import sys
from datetime import date
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .storage import private_directory
from .periods import select_period, today_in_zone


def parser() -> argparse.ArgumentParser:
    cli = argparse.ArgumentParser(description="Garmin 러닝 FIT 수집 (기본: 지난 월요일~일요일)")
    mode = cli.add_mutually_exclusive_group()
    mode.add_argument("--previous-week", action="store_true", help="완료된 지난 월요일~일요일 수집 (기본 동작)")
    mode.add_argument("--days", type=int, help="오늘 포함 최근 N일 수집 (예: --days 7)")
    cli.add_argument("--start", type=date.fromisoformat, help="시작일 YYYY-MM-DD")
    cli.add_argument("--end", type=date.fromisoformat, help="종료일 YYYY-MM-DD (단독 지정 시 종료일 포함 7일)")
    cli.add_argument("--timezone", default=os.getenv("TRAINI_TIMEZONE", "America/Los_Angeles"),
                     help="훈련 주간과 활동 날짜를 계산할 IANA 시간대")
    cli.add_argument("--data-dir", type=Path,
                     default=Path.home() / "Projects/Traini-data/garmin")
    cli.add_argument("--token-dir", type=Path,
                     default=Path.home() / "Library/Application Support/Traini/auth")
    cli.add_argument("--login", action="store_true", help="저장된 토큰 대신 다시 로그인")
    cli.add_argument("--non-interactive", action="store_true", help="토큰으로만 인증, 입력 요청 없이 종료")
    return cli


def main() -> int:
    args = parser().parse_args()
    os.umask(0o077)
    try:
        timezone = ZoneInfo(args.timezone)
        period = select_period(today_in_zone(timezone), start=args.start, end=args.end,
                               days=args.days, previous_week=args.previous_week)
        data_dir = args.data_dir.expanduser().absolute()
        token_dir = args.token_dir.expanduser().absolute()
        private_directory(data_dir)
        lock_path = data_dir / ".sync.lock"
        if lock_path.is_symlink():
            raise ValueError("동기화 잠금 경로가 유효하지 않습니다.")
        with lock_path.open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                print("이미 수집기가 실행 중입니다.", file=sys.stderr)
                return 1
            try:
                from garminconnect import Garmin
                from .auth import authenticate
                from .sync import sync_activities
            except ImportError:
                print("수집기 의존성을 설치해 주세요: python -m pip install -e ./collector", file=sys.stderr)
                return 1
            label = "지난 훈련 주간 (월~일)" if period.mode == "previous_week" else "조회 기간"
            print(f"{label}: {period.start} ~ {period.end} · {timezone.key}")
            client = authenticate(token_dir, force_login=args.login,
                                  non_interactive=args.non_interactive)
            print("Garmin 인증 성공")
            result = sync_activities(client, period.start, period.end, data_dir,
                                     Garmin.ActivityDownloadFormat.ORIGINAL,
                                     timezone=timezone, period_mode=period.mode)
            print(f"러닝 {result.found}개 · 다운로드 {result.downloaded}개 · 기존 {result.skipped}개 · 실패 {result.failed}개")
            print(f"FIT 저장 위치: {data_dir / 'activities'}")
            return 1 if result.failed else 0
    except (KeyboardInterrupt, EOFError):
        print("수집을 중단했습니다. 저장된 파일은 다음 실행에서 재사용됩니다.", file=sys.stderr)
        return 130
    except (ValueError, ZoneInfoNotFoundError) as error:
        print(str(error), file=sys.stderr)
        return 1
    except Exception as error:
        name = type(error).__name__
        if "Authentication" in name or "MFA" in name:
            message = "Garmin 인증이 필요합니다. 터미널에서 --login으로 실행해 주세요."
        elif "TooManyRequests" in name:
            message = "Garmin 요청 제한에 걸렸습니다. 잠시 후 다시 실행해 주세요."
        elif "Connection" in name:
            message = "Garmin 연결에 실패했습니다. 네트워크를 확인하고 다시 실행해 주세요."
        elif isinstance(error, OSError):
            message = "로컬 폴더 접근 또는 파일 저장에 실패했습니다. 경로와 권한을 확인해 주세요."
        else:
            message = "수집에 실패했습니다. 저장된 파일은 유지됩니다."
        print(f"{message} ({name})", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
