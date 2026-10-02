"""Opt-in service smoke; generates a fresh synthetic native_smoke fixture.

This is not part of automatic unit discovery. It accepts no existing document
path and never enumerates or opens personal documents.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import uuid

from one_hwp.service import HwpService


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--all-formats", action="store_true", help="Opt in to HWPX/PDF/DOCX exports; default is HWP only")
    args = parser.parse_args()
    generated = subprocess.run(
        [sys.executable, "-X", "utf8", str(Path(__file__).with_name("native_smoke.py")), "--format", "HWP"],
        capture_output=True, text=True, encoding="utf-8", timeout=60, check=True,
    )
    fixture_directory = Path(json.loads(generated.stdout)["directory"])
    service = HwpService(fixture_directory)
    snapshot = service.inspect("source-fixture.hwp")
    if "한글 편집 연결 자동 검증" not in snapshot["text"] or snapshot["text"].count("원문") != 3:
        raise RuntimeError("This script accepts only the known synthetic native_smoke fixture")
    field = next(value for value in snapshot["fields"] if value["name"].startswith("성명"))
    if field["value"] != "홍길동":
        raise RuntimeError("Synthetic field precondition does not match")
    name = "service-" + uuid.uuid4().hex[:8]
    result = service.edit(
        "source-fixture.hwp", name + ".hwp",
        [
            {"kind": "replace_text", "old": "원문", "new": "연결 검증", "expected_count": 3},
            {"kind": "set_field", "name": field["name"], "value": "박검증\n다중행", "expected_old": field["value"]},
        ],
        exports=[{"output": name + "." + format, "format": format} for format in ("hwpx", "pdf", "docx")] if args.all_formats else [],
        expected_sha256=snapshot["source_sha256"],
    )
    assert result["source_unchanged"]
    assert {value["format"] for value in result["outputs"]} == ({"hwp", "hwpx", "pdf", "docx"} if args.all_formats else {"hwp"})
    assert all(value["size_bytes"] > 0 and value["container_valid"] for value in result["outputs"])
    assert all(value["text_verified"] for value in result["outputs"] if value["format"] != "pdf")
    if not args.all_formats:
        assert all(value.suffix.lower() == ".hwp" for value in fixture_directory.iterdir())
        assert not any("DOCX" in warning for warning in result["warnings"])
    print(json.dumps({"fixture_directory": str(fixture_directory), "result": result}, ensure_ascii=False))


if __name__ == "__main__":
    main()
