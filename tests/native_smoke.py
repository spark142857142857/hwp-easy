"""Opt-in real Hancom fixture smoke, never an existing user document.

Run only with the task's bundled-runtime-derived Python and pywin32. Output
artifacts stay in a fresh temporary directory for independent visual inspection.
The supervising process times out but never kills all Hancom processes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from one_hwp.hancom import HancomBackend


def insert_text(app, text):
    parameters = app.HParameterSet.HInsertText
    app.HAction.GetDefault("InsertText", parameters.HSet)
    parameters.Text = text
    if not app.HAction.Execute("InsertText", parameters.HSet):
        raise RuntimeError("fixture text insertion failed")


def make_fixture(backend):
    app = backend._app
    insert_text(app, "한글 편집 연결 자동 검증\r\n본문 원문 원문\r\nliteral [한글].* [한글].*\r\n성명: ")
    if not app.CreateField("성명 입력", "테스트 전용 누름틀", "성명"):
        raise RuntimeError("fixture field creation failed")
    app.PutFieldText("성명", "홍길동")
    app.HAction.Run("MoveDocEnd")
    insert_text(app, "\r\n표 형식은 변경하지 않습니다.\r\n")
    parameters = app.HParameterSet.HTableCreation
    app.HAction.GetDefault("TableCreate", parameters.HSet)
    parameters.Rows = 2
    parameters.Cols = 2
    parameters.WidthType = 0
    parameters.HeightType = 0
    parameters.CreateItemArray("ColWidth", 2)
    for index in range(2):
        parameters.ColWidth.SetItem(index, app.MiliToHwpUnit(60))
    if not app.HAction.Execute("TableCreate", parameters.HSet):
        raise RuntimeError("fixture table creation failed")
    for index, value in enumerate(["항목", "내용", "원문", "표 본문"]):
        if index:
            if not app.HAction.Run("TableRightCell"):
                raise RuntimeError("fixture table navigation failed")
        insert_text(app, value)
    app.HAction.Run("CloseEx")
    app.HAction.Run("MoveDocBegin")


def child(folder, format, preview_pdf=False):
    folder = Path(folder)
    report = {"directory": str(folder), "format": format, "verified": [], "unverified": ["layout fidelity", "existing real-world forms", "all Hancom versions"]}
    with HancomBackend() as backend:
        make_fixture(backend)
        before = backend.get_text()
        fields_before = backend.get_fields()
        report["source_page_count"] = backend.page_count()
        source = folder / "source-fixture.hwp"
        backend.save_as(source, "HWP")
        if preview_pdf:
            source_pdf = folder / "source-fixture.pdf"
            backend.save_as(source_pdf, "PDF")
            report["source_pdf"] = str(source_pdf)
        report["source"] = str(source)
        source_digest = hashlib.sha256(source.read_bytes()).hexdigest()
        report["source_sha256"] = source_digest
        report["source_text"] = before
        report["source_fields"] = fields_before
        report["verified"].append("native fixture creation with paragraphs/table/named field")
    # Both instances belong to this test. No existing user's document is opened.
    with HancomBackend() as holder:
        holder.open(source)
        with HancomBackend() as other:
            other.open(source)
            other.replace_text("원문", "격리", before.count("원문"))
        if holder.get_text() != before or holder.get_field("성명") != "홍길동":
            raise RuntimeError("second-instance editing/closing damaged the first instance")
        report["verified"].append("two live private instances: editing/closing B left A text/field intact")
    with HancomBackend() as backend:
        backend.open(source)
        if backend.get_text() != before or backend.get_fields() != fields_before:
            raise RuntimeError("fixture HWP reopen changed source text/fields")
        report["verified"].append("HWP save/reopen text and field enumeration")
        backend.put_field("성명", "첫 줄\n다음 줄")
        if backend.get_field("성명") != "첫 줄\r\n다음 줄":
            raise RuntimeError("native multiline field readback differed")
        backend.put_field("성명", "홍길동")
        if backend.get_text() != before:
            raise RuntimeError("restoring the multiline field altered surrounding fixture text")
        report["verified"].append("multiline field LF input/CRLF readback and exact surrounding-text restoration")
        body_count = before.count("원문")
        backend.replace_text("원문", "수정", body_count)
        backend.replace_text("[한글].*", "[수정].*", 2)
        backend.put_field("성명", "김검증")
        expected = before.replace("원문", "수정").replace("[한글].*", "[수정].*").replace("홍길동", "김검증")
        if backend.get_text() != expected:
            raise RuntimeError("combined text/field edit violated fixture expectation")
        report["verified"].append("exact Korean literal edits including table body and punctuation")
        report["verified"].append("named field read/edit/read")
        report["edited_text"] = expected
        suffix = {"HWP": "hwp", "HWPX": "hwpx", "PDF": "pdf", "OOXML": "docx"}[format]
        edited = folder / ("edited-fixture." + suffix)
        backend.save_as(edited, format)
        report["output"] = str(edited)
        report["output_bytes"] = edited.stat().st_size
        report["edited_page_count"] = backend.page_count()
        report["verified"].append(format + " nonempty native SaveAs")
        if preview_pdf and format != "PDF":
            edited_pdf = folder / "edited-preview.pdf"
            backend.save_as(edited_pdf, "PDF")
            report["edited_pdf"] = str(edited_pdf)
    if format in {"HWP", "HWPX"}:
        with HancomBackend() as backend:
            backend.open(edited)
            text = backend.get_text()
            if text != expected:
                raise RuntimeError("export reopen changed expected text")
            if backend.get_field("성명") != "김검증":
                raise RuntimeError("export reopen changed the named field")
            report["verified"].append(format + " reopen exact text and named field")
    if format == "OOXML":
        with zipfile.ZipFile(edited) as archive:
            root = ET.fromstring(archive.read("word/document.xml"))
        namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        text = "".join(root.itertext())
        if "".join(text.split()) != "".join(expected.split()):
            raise RuntimeError("DOCX main-document XML text differs from edited fixture")
        tables = root.findall(".//w:tbl", namespace)
        if len(tables) != 1 or len(tables[0].findall("w:tr", namespace)) != 2:
            raise RuntimeError("DOCX fixture table structure differs")
        report["verified"].append("DOCX ZIP/main XML edited text and two-row table")
        report["unverified"].append("Hancom 2020 native auto-detected DOCX reopening")
    if hashlib.sha256(source.read_bytes()).hexdigest() != source_digest:
        raise RuntimeError("native smoke modified its source fixture on disk")
    report["verified"].append("source fixture SHA-256 unchanged after all reads/edits/exports")
    print(json.dumps(report, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--format", choices=["HWP", "HWPX", "PDF", "OOXML"], default="HWP")
    parser.add_argument("--preview-pdf", action="store_true", help="Opt in to before/after PDF previews; otherwise no sidecar PDFs are created")
    parser.add_argument("--child", type=Path)
    args = parser.parse_args()
    if args.child is not None:
        child(args.child, args.format, args.preview_pdf)
        return
    folder = Path(tempfile.mkdtemp(prefix="one-hwp-native-smoke-"))
    command = [sys.executable, "-X", "utf8", str(Path(__file__).resolve()), "--child", str(folder), "--format", args.format]
    if args.preview_pdf:
        command.append("--preview-pdf")
    try:
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", timeout=55)
    except subprocess.TimeoutExpired as exc:
        print(json.dumps({"status": "timeout", "directory": str(folder), "format": args.format,
                          "note": "Hancom was not globally terminated; inspect only this test instance",
                          "stdout": exc.stdout.decode("utf-8", errors="replace") if isinstance(exc.stdout, bytes) else exc.stdout}, ensure_ascii=False))
        return 1
    print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, file=sys.stderr, end="")
    if result.returncode:
        print(json.dumps({"status": "failed", "directory": str(folder), "format": args.format}, ensure_ascii=False))
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
