"""Internal, opt-in read-only checks for local HWP files; not a product CLI.

Only top-level .hwp entries are considered. No document names, paths, body text,
SVG, upstream warnings, or exception messages enter the report or console.
The engine receives bytes for inspect/optional first-page preview only. This
tool never edits, exports HWP, uses COM/UI, or calls a remote service. Like the
existing PathPolicy, it is not an OS sandbox against hostile filesystem races.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from one_hwp.native_engine import EngineError, RhwpEngine, UnsupportedDocumentError
from one_hwp.native_storage import (
    CFB_MAGIC, ConflictError, InvalidDocumentError, PathPolicy, PathPolicyError,
    _absolute as _storage_absolute, _no_links, _read_file, _regular,
)


MAX_BYTES = 16 * 1024 * 1024
UNSUPPORTED_KINDS = frozenset({
    "control", "nested_or_noncell_list", "body_record", "paragraph_coverage_mismatch",
})
MALFORMED_ERRORS = frozenset({
    "Not a supported HWP document", "Malformed HWP container or header",
    "HWP body streams are missing", "Truncated HWP body record",
    "Truncated extended HWP record", "HWP body record exceeds its stream",
    "HWP section sequence is incomplete", "Malformed HWP body record stream",
})


def _absolute(value: Path | str) -> Path:
    path = Path(value)
    return _storage_absolute(path if path.is_absolute() else ROOT / path)


def _reason(exc: Exception) -> tuple[str, str]:
    # Recognize only exact, fixed messages from our adapter. Never publish str(exc).
    if isinstance(exc, UnsupportedDocumentError):
        if str(exc) in MALFORMED_ERRORS:
            return "malformed", "malformed_document"
        return "unsupported", "unsupported_document_profile"
    if isinstance(exc, InvalidDocumentError):
        return "limit_exceeded", "input_byte_limit"
    if isinstance(exc, PathPolicyError):
        return "path_rejected", "unsafe_document_path"
    if isinstance(exc, ConflictError):
        return "failed", "source_changed_during_read"
    if isinstance(exc, EngineError):
        return "failed", "engine_unavailable_or_failed"
    if isinstance(exc, OSError):
        return "failed", "local_io_failed"
    return "failed", "inspection_failed"


def _counts(inspection: dict[str, Any]) -> tuple[dict[str, int], dict[str, int]]:
    if not isinstance(inspection, dict):
        raise EngineError("Invalid inspection shape")
    blocks, tables, unsupported = (inspection.get(key) for key in ("blocks", "tables", "unsupported"))
    if any(not isinstance(items, list) or any(not isinstance(item, dict) for item in items)
           for items in (blocks, tables, unsupported)):
        raise EngineError("Invalid inspection shape")
    if any(not isinstance(table.get("cells"), list) for table in tables):
        raise EngineError("Invalid table shape")
    kinds = Counter(item["kind"] if item.get("kind") in UNSUPPORTED_KINDS else "other"
                    for item in unsupported)
    counts = {
        "blocks": len(blocks),
        "body_paragraphs": sum(item.get("kind") == "paragraph" for item in blocks),
        "cell_paragraphs": sum(item.get("kind") == "cell" for item in blocks),
        "tables": len(tables), "table_cells": sum(len(table["cells"]) for table in tables),
        "unsupported_elements": len(unsupported),
    }
    return counts, dict(sorted(kinds.items()))


def _inspect_one(path: Path, number: int, policy: PathPolicy, engine: Any,
                 preview: bool) -> dict[str, Any]:
    result = {
        "document_id": f"document_{number:04d}", "status": "failed",
        "reason_code": "inspection_failed", "counts": None, "unsupported_counts": {},
        "read_coverage": "not_read", "source_unchanged": None,
        "source_check_code": "not_read",
        "preview": {"status": "not_attempted" if preview else "not_requested", "checked_pages": 0},
    }
    before_hash = None
    try:
        data = _read_file(policy.check(path), max_bytes=MAX_BYTES)
        before_hash = hashlib.sha256(data).digest()
        if not data.startswith(CFB_MAGIC):
            result.update(status="malformed", reason_code="malformed_document")
        else:
            inspection = engine.inspect(data)
            counts, unsupported = _counts(inspection)
            partial = bool(counts["unsupported_elements"])
            result.update(
                status="partial" if partial else "supported",
                reason_code="unsupported_elements" if partial else "supported_read_profile",
                counts=counts, unsupported_counts=unsupported,
                read_coverage="partial_profile" if partial else "verified_profile",
            )
            if preview:
                try:
                    rendered = engine.preview(data, 0)
                    if not isinstance(rendered, dict) or not isinstance(rendered.get("svg"), str) \
                            or "<svg" not in rendered["svg"]:
                        raise EngineError("Invalid preview shape")
                    result["preview"] = {"status": "available", "checked_pages": 1}
                except Exception:
                    result["preview"] = {"status": "failed", "checked_pages": 0,
                                         "reason_code": "preview_unavailable_or_failed"}
    except Exception as exc:
        status, reason = _reason(exc)
        result.update(status=status, reason_code=reason)
    finally:
        if before_hash is not None:
            try:
                after = _read_file(policy.check(path), max_bytes=MAX_BYTES)
                unchanged = hashlib.sha256(after).digest() == before_hash
                result.update(source_unchanged=unchanged,
                              source_check_code="unchanged" if unchanged else "source_changed")
                if not unchanged:
                    result.update(status="failed", reason_code="source_changed")
            except Exception:
                result.update(status="failed", reason_code="source_recheck_failed",
                              source_unchanged=None, source_check_code="verification_failed")
    return result


def inspect_corpus(folder: Path | str = ROOT / "testdocs", *, preview: bool = False,
                   engine: Any = None) -> dict[str, Any]:
    """Return only safe structural counts/statuses. Never persist document data."""
    report = {"schema_version": 1, "status": "failed", "reason_code": "corpus_failed",
              "scope": "top_level_hwp_read_only", "layout_verified": False,
              "preview_requested": preview, "documents": [], "summary": {}}
    try:
        folder = _absolute(folder)
        policy = PathPolicy([folder])
        # Enumeration does not follow directories, symlinks or junctions.
        entries = sorted(folder.iterdir(), key=lambda path: path.name.casefold())
        candidates = [path for path in entries if path.suffix.lower() == ".hwp"]
        if not candidates:
            report.update(status="no_documents", reason_code="no_hwp_documents")
        else:
            engine = RhwpEngine() if engine is None else engine
            report["documents"] = [_inspect_one(path, number, policy, engine, preview)
                                   for number, path in enumerate(candidates, 1)]
            failures = any(item["status"] not in {"supported", "partial"}
                           or item["preview"]["status"] == "failed"
                           for item in report["documents"])
            partial = any(item["status"] == "partial" for item in report["documents"])
            report.update(status="failed" if failures else "partial" if partial else "checked",
                          reason_code="document_checks_failed" if failures else
                          "unsupported_elements" if partial else "read_checks_completed")
        statuses = Counter(item["status"] for item in report["documents"])
        report["summary"] = {"documents": len(candidates), "ignored_entries": len(entries) - len(candidates),
                             **{key: statuses[key] for key in ("supported", "partial", "unsupported", "malformed",
                                                               "path_rejected", "limit_exceeded", "failed")}}
    except Exception as exc:
        _, reason = _reason(exc)
        report.update(status="failed", reason_code=reason)
        report["summary"] = {"documents": 0}
    return report


def write_report(report: dict[str, Any], destination: Path | str = ROOT / "outputs" / "local-corpus.json") -> None:
    """Write a safe JSON report only below ignored outputs, never over an HWP."""
    destination = _absolute(destination)
    output_root = ROOT / "outputs"
    if destination.suffix.lower() != ".json" or ".." in destination.parts \
            or not destination.is_relative_to(output_root):
        raise PathPolicyError("Report must be JSON under ignored outputs")
    _no_links(output_root, allow_missing_leaf=True)
    output_root.mkdir(mode=0o700, exist_ok=True)
    _no_links(destination.parent)
    _no_links(destination, allow_missing_leaf=True)
    if destination.exists():
        _regular(destination.lstat())
    temporary = None
    try:
        fd, name = tempfile.mkstemp(prefix=".local-corpus-", suffix=".json", dir=destination.parent)
        temporary = Path(name)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(report, stream, ensure_ascii=True, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        _no_links(destination, allow_missing_leaf=True)
        if destination.exists():
            _regular(destination.lstat())
        os.replace(temporary, destination)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise ValueError("Invalid internal check arguments")


def main(argv: list[str] | None = None) -> int:
    parser = _Parser(description="Internal read-only local HWP corpus check; no editing or document-text output")
    parser.add_argument("--folder", type=Path, default=ROOT / "testdocs")
    parser.add_argument("--report", type=Path, default=ROOT / "outputs" / "local-corpus.json")
    parser.add_argument("--preview", action="store_true", help="Check first-page SVG in memory; do not store it")
    try:
        args = parser.parse_args(argv)
        report = inspect_corpus(args.folder, preview=args.preview)
        write_report(report, args.report)
        print(json.dumps({"status": report["status"], "reason_code": report["reason_code"],
                          "summary": report["summary"]}, sort_keys=True))
        return 0 if report["status"] == "checked" else 2
    except Exception:
        print(json.dumps({"status": "failed", "reason_code": "local_check_or_report_failed"}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
