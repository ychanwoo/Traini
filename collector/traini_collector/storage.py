"""Private, atomic storage and FIT integrity checks."""

import io
import json
import os
import tempfile
import zipfile
from pathlib import Path
from typing import Any

MAX_FIT_BYTES = 64 * 1024 * 1024


def private_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink():
        raise ValueError("저장 폴더는 심볼릭 링크를 사용할 수 없습니다.")
    path.chmod(0o700)


def atomic_write(path: Path, contents: bytes) -> None:
    private_directory(path.parent)
    if path.is_symlink():
        raise ValueError("저장 파일은 심볼릭 링크를 사용할 수 없습니다.")
    fd, temporary = tempfile.mkstemp(prefix=".traini-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(contents)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def write_json(path: Path, value: Any) -> None:
    atomic_write(path, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode())


def crc16(data: bytes) -> int:
    crc = 0
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ (0xA001 if crc & 1 else 0)
    return crc


def validate_fit(contents: bytes) -> None:
    if not 14 <= len(contents) <= MAX_FIT_BYTES:
        raise ValueError("FIT 파일 크기가 유효하지 않습니다.")
    header_size = contents[0]
    if header_size not in (12, 14) or contents[8:12] != b".FIT":
        raise ValueError("FIT 헤더가 유효하지 않습니다.")
    data_size = int.from_bytes(contents[4:8], "little")
    if data_size == 0 or len(contents) != header_size + data_size + 2:
        raise ValueError("FIT 파일이 비어 있거나 다운로드가 불완전합니다.")
    if header_size == 14:
        header_crc = int.from_bytes(contents[12:14], "little")
        if header_crc and crc16(contents[:12]) != header_crc:
            raise ValueError("FIT 헤더 CRC 검증에 실패했습니다.")
    if crc16(contents[:-2]) != int.from_bytes(contents[-2:], "little"):
        raise ValueError("FIT CRC 검증에 실패했습니다.")


def extract_fit(payload: bytes) -> bytes:
    if not isinstance(payload, bytes) or len(payload) > MAX_FIT_BYTES:
        raise ValueError("원본 다운로드 응답이 유효하지 않습니다.")
    if zipfile.is_zipfile(io.BytesIO(payload)):
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            files = [item for item in archive.infolist()
                     if not item.is_dir() and item.filename.lower().endswith(".fit")
                     and not item.filename.startswith("__MACOSX/")]
            if len(files) != 1:
                raise ValueError("원본 ZIP에 FIT 파일이 정확히 하나 있어야 합니다.")
            if files[0].file_size > MAX_FIT_BYTES:
                raise ValueError("압축 해제 후 FIT 파일이 너무 큽니다.")
            # Read the entry in memory; never trust or extract its supplied path.
            with archive.open(files[0]) as stream:
                contents = stream.read(MAX_FIT_BYTES + 1)
    else:
        contents = payload
    validate_fit(contents)
    return contents
