#!/usr/bin/env python3
"""Decrypt TNGENC01 AES-256-GCM files (same format as lib/file-encryption.server.ts).

Layout:
  [0..7]   MAGIC b"TNGENC01"
  [8..19]  IV (12 bytes)
  [20..35] Auth Tag (16 bytes)
  [36..]   Ciphertext (AES-256-GCM)

Dependencies:
  pip install cryptography

Examples:
  set FILE_ENCRYPTION_KEY=...
  python scripts/decrypt_tngenc.py a.bin b.bin c.bin -o ./out

  python scripts/decrypt_tngenc.py *.bin -o ./out -k "<base64-or-hex-key>"
"""

from __future__ import annotations

import argparse
import base64
import binascii
import os
import re
import sys
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC = b"TNGENC01"
IV_LENGTH = 12
TAG_LENGTH = 16
KEY_LENGTH = 32
HEADER_LENGTH = len(MAGIC) + IV_LENGTH + TAG_LENGTH
HEX_KEY_RE = re.compile(r"^[0-9a-fA-F]{64}$")


def load_key(raw: str) -> bytes:
    value = raw.strip()
    if not value:
        raise ValueError("FILE_ENCRYPTION_KEY가 비어 있습니다.")

    if HEX_KEY_RE.fullmatch(value):
        key = binascii.unhexlify(value)
    else:
        key = base64.b64decode(value, validate=False)

    if len(key) != KEY_LENGTH:
        raise ValueError(
            "FILE_ENCRYPTION_KEY는 32바이트여야 합니다. "
            "openssl rand -base64 32 로 생성하세요."
        )
    return key


def decrypt_payload(payload: bytes, key: bytes) -> bytes:
    if len(payload) < HEADER_LENGTH or payload[: len(MAGIC)] != MAGIC:
        raise ValueError("암호화된 파일 형식이 아닙니다. (MAGIC TNGENC01 없음)")

    iv_start = len(MAGIC)
    tag_start = iv_start + IV_LENGTH
    data_start = tag_start + TAG_LENGTH

    iv = payload[iv_start:tag_start]
    tag = payload[tag_start:data_start]
    ciphertext = payload[data_start:]

    # cryptography AESGCM expects ciphertext || tag
    return AESGCM(key).decrypt(iv, ciphertext + tag, None)


def default_output_path(input_path: Path, out_dir: Path) -> Path:
    stem = input_path.name
    for suffix in (".enc", ".bin", ".encrypted"):
        if stem.lower().endswith(suffix):
            stem = stem[: -len(suffix)]
            break
    if not Path(stem).suffix:
        stem = f"{stem}.pdf"
    elif not stem.lower().endswith(".pdf"):
        stem = f"{Path(stem).stem}.decrypted.pdf"
    else:
        stem = f"{Path(stem).stem}.decrypted.pdf"
    return out_dir / stem


def decrypt_file(input_path: Path, output_path: Path, key: bytes) -> None:
    payload = input_path.read_bytes()
    plain = decrypt_payload(payload, key)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(plain)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="TNGENC01(AES-256-GCM) 암호화 파일을 여러 개 복호화합니다."
    )
    parser.add_argument(
        "inputs",
        nargs="+",
        type=Path,
        help="복호화할 파일 경로 (여러 개 가능)",
    )
    parser.add_argument(
        "-o",
        "--outdir",
        type=Path,
        default=Path("."),
        help="복호화 결과 저장 디렉터리 (기본: 현재 디렉터리)",
    )
    parser.add_argument(
        "-k",
        "--key",
        default=None,
        help="FILE_ENCRYPTION_KEY (미지정 시 환경변수 사용)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    raw_key = args.key or os.environ.get("FILE_ENCRYPTION_KEY", "")
    if not raw_key.strip():
        print(
            "오류: -k/--key 또는 환경변수 FILE_ENCRYPTION_KEY가 필요합니다.",
            file=sys.stderr,
        )
        return 2

    try:
        key = load_key(raw_key)
    except Exception as exc:  # noqa: BLE001
        print(f"오류: 키 파싱 실패 - {exc}", file=sys.stderr)
        return 2

    out_dir = args.outdir
    ok = 0
    failed = 0

    for input_path in args.inputs:
        if not input_path.is_file():
            print(f"[SKIP] 파일 없음: {input_path}", file=sys.stderr)
            failed += 1
            continue

        output_path = default_output_path(input_path, out_dir)
        try:
            decrypt_file(input_path, output_path, key)
        except Exception as exc:  # noqa: BLE001
            print(f"[FAIL] {input_path} -> {exc}", file=sys.stderr)
            failed += 1
            continue

        print(f"[OK]   {input_path} -> {output_path}")
        ok += 1

    print(f"완료: 성공 {ok}건, 실패 {failed}건")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
