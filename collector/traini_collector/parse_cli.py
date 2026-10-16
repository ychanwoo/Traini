"""Offline FIT parser; never authenticates or calls Garmin Connect."""

import argparse
import os
import sys
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def parser() -> argparse.ArgumentParser:
    cli = argparse.ArgumentParser(description="다운로드한 Garmin 러닝 FIT 분석 (네트워크 사용 없음)")
    cli.add_argument("--data-dir", type=Path, default=Path.home() / "Projects/Traini-data/garmin",
                     help="activities 폴더가 있는 Garmin 데이터 경로")
    cli.add_argument("--timezone", default=os.getenv("TRAINI_TIMEZONE", "America/Los_Angeles"),
                     help="활동 날짜와 월~일 훈련 주간을 계산할 IANA 시간대")
    return cli


def main() -> int:
    args = parser().parse_args()
    os.umask(0o077)
    try:
        timezone = ZoneInfo(args.timezone)
        from .parsing import parse_activities
        data_dir = args.data_dir.expanduser().absolute()
        result = parse_activities(data_dir, timezone)
        print(f"FIT {result.found}개 · 분석 {result.processed}개 · 기존 {result.skipped}개 · 실패 {result.failed}개")
        print(f"훈련 시간대: {timezone.key}")
        print(f"분석 저장 위치: {data_dir / 'normalized'}")
        return 1 if result.failed else 0
    except ImportError:
        print("수집기 의존성을 설치해 주세요: python -m pip install -r collector/requirements.lock -e ./collector", file=sys.stderr)
        return 1
    except (KeyboardInterrupt, EOFError):
        print("분석을 중단했습니다. 원본은 유지되며 다음 실행에서 다시 확인합니다.", file=sys.stderr)
        return 130
    except ZoneInfoNotFoundError:
        print("훈련 시간대를 확인해 주세요 (예: America/Los_Angeles).", file=sys.stderr)
        return 1
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1
    except OSError:
        print("FIT 분석 상태를 저장하지 못했습니다. 폴더 권한과 저장 공간을 확인한 뒤 다시 실행해 주세요.", file=sys.stderr)
        return 1
    except Exception:
        # Do not expose paths or SDK diagnostics in unexpected exceptions.
        print("FIT 분석에 실패했습니다. 원본은 유지됩니다. 의존성과 파일 형식을 확인해 주세요.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
