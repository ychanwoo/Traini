"""Garmin authentication; secrets are entered locally and never logged."""

import getpass
import logging
import sys
import tempfile
from pathlib import Path

from garminconnect import Garmin, GarminConnectAuthenticationError

from .storage import atomic_write, private_directory


def authenticate(token_dir: Path, *, email: str | None = None,
                 force_login: bool = False, non_interactive: bool = False) -> Garmin:
    # Third-party exception logs can contain account or session details.
    logging.getLogger("garminconnect").disabled = True
    logging.getLogger("garminconnect.client").disabled = True
    private_directory(token_dir)
    token_file = token_dir / "garmin_tokens.json"
    if token_file.exists() and not force_login:
        if token_file.is_symlink():
            raise ValueError("인증 토큰은 심볼릭 링크를 사용할 수 없습니다.")
        token_file.chmod(0o600)
        client = Garmin()
        try:
            client.login(str(token_dir))
            return client
        except GarminConnectAuthenticationError:
            if non_interactive:
                raise GarminConnectAuthenticationError("저장된 인증이 만료되었습니다.") from None
            print("Garmin 인증이 만료되었습니다. 다시 로그인해 주세요.")
    if non_interactive or not sys.stdin.isatty():
        raise GarminConnectAuthenticationError("터미널에서 최초 로그인이 필요합니다.")

    email = email or input("Garmin 이메일: ").strip()
    if not email:
        raise ValueError("Garmin 이메일을 입력해 주세요.")
    password = getpass.getpass("Garmin 비밀번호 (화면에 표시되지 않음): ")
    if not password:
        raise ValueError("Garmin 비밀번호를 입력해 주세요.")

    def prompt_mfa() -> str:
        code = getpass.getpass("Garmin 2단계 인증 코드: ").strip()
        if not code:
            raise ValueError("2단계 인증 코드를 입력해 주세요.")
        return code

    # Authenticate in a fresh store even for --login. Keep the old token intact
    # if the new login fails, and do not let the library reuse it silently.
    client = Garmin(email, password, prompt_mfa=prompt_mfa)
    with tempfile.TemporaryDirectory(prefix=".login-", dir=token_dir) as temporary:
        client.login(temporary)
        fresh_token = Path(temporary) / "garmin_tokens.json"
        if not fresh_token.is_file():
            raise OSError("Garmin 인증 토큰 저장에 실패했습니다.")
        atomic_write(token_file, fresh_token.read_bytes())
    client.login(str(token_dir))
    return client
