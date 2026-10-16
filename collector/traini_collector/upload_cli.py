"""Local upload command. Secrets come from the server environment, never argv."""

import argparse
import os
import sys
from pathlib import Path

from .upload import SupabaseActivityStore, UploadError, upload_activities

MESSAGES = {
    "invalid_configuration": "Traini Supabase 서버 설정과 관리자 UUID를 확인해 주세요.",
    "invalid_manifest": "분석 상태가 완료되지 않았거나 유효하지 않습니다. traini-parse를 다시 실행해 주세요.",
    "reparse_required": "파서 버전 또는 결과가 다릅니다. traini-parse를 다시 실행해 주세요.",
    "local_data_missing": "로컬 FIT와 분석 결과가 필요합니다. 수집 후 traini-parse를 실행해 주세요.",
    "access_denied": "Supabase 서버 키와 권한을 확인해 주세요.",
    "owner_not_found": "관리자 계정을 찾을 수 없습니다. npm run admin:setup으로 확인해 주세요.",
    "profile_missing": "관리자 프로필이 없습니다. Traini에 Google 로그인한 뒤 다시 실행해 주세요.",
    "schema_not_ready": "Supabase 활동 저장 마이그레이션을 먼저 적용해 주세요.",
    "connection_failed": "Supabase 연결에 실패했습니다. 네트워크를 확인하고 다시 실행해 주세요.",
    "temporarily_unavailable": "Supabase가 일시적으로 응답하지 않습니다. 잠시 후 다시 실행해 주세요.",
}


def main() -> int:
    cli = argparse.ArgumentParser(description="검증된 Garmin FIT 분석 결과를 Traini Supabase에 저장")
    cli.add_argument("--data-dir", type=Path, default=Path.home() / "Projects/Traini-data/garmin")
    cli.add_argument("--dry-run", action="store_true", help="로컬 검증만 수행 (네트워크·DB 쓰기 없음)")
    args = cli.parse_args()
    os.umask(0o077)
    store = None
    try:
        if not args.dry_run:
            store = SupabaseActivityStore(os.getenv("NEXT_PUBLIC_SUPABASE_URL", ""),
                                          os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""),
                                          os.getenv("TRAINI_ADMIN_USER_ID", ""))
        result = upload_activities(args.data_dir.expanduser().absolute(), store)
        if args.dry_run:
            print(f"로컬 검증 {result.validated}개 · 실패 {result.failed}개 · 분석 실패로 제외 {result.excluded}개")
        else:
            print(f"새로 저장 {result.inserted}개 · 변경 {result.updated}개 · 기존 {result.unchanged}개 · 실패 {result.failed}개 · 제외 {result.excluded}개")
        return 1 if result.failed or result.excluded else 0
    except (KeyboardInterrupt, EOFError):
        print("업로드를 중단했습니다. 같은 명령으로 안전하게 다시 실행할 수 있습니다.", file=sys.stderr)
        return 130
    except UploadError as error:
        print(MESSAGES.get(error.code, f"업로드를 진행할 수 없습니다 ({error.code})."), file=sys.stderr)
        return 1
    except ValueError:
        print("로컬 상태와 실행 잠금을 확인한 뒤 다시 실행해 주세요.", file=sys.stderr)
        return 1
    except Exception:
        print("업로드 상태를 저장하지 못했습니다. 폴더 권한과 저장 공간을 확인해 주세요. 로컬 파일은 유지됩니다.", file=sys.stderr)
        return 1
    finally:
        if store is not None:
            store.close()


if __name__ == "__main__":
    raise SystemExit(main())
