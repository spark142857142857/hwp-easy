"""Workspace-scoped, copy-on-write Hancom document operations.

The Hancom engine is an external Windows application, not a sandbox. Only
trusted documents should be opened. This layer constrains file targets and
publishes fresh artifacts only after native and structural checks succeed.
"""
from __future__ import annotations

import hashlib
from contextlib import contextmanager
import importlib.util
import json
import os
from pathlib import Path, PureWindowsPath
import shutil
import subprocess
import sys
import tempfile
from typing import Any, Callable
import zipfile
from xml.etree import ElementTree


FORMATS = {"hwp": ".hwp", "hwpx": ".hwpx", "pdf": ".pdf", "docx": ".docx"}
NATIVE_FORMATS = {"hwp": "HWP", "hwpx": "HWPX", "pdf": "PDF", "docx": "OOXML"}
INPUT_FORMATS = {".hwp", ".hwpx"}
MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_TEXT = 20_000
CFB = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"


class HwpError(ValueError):
    """An input, native-engine, or verification failure; no success implied."""


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest() if hasattr(hashlib, "file_digest") else _digest_stream(stream)


def _digest_stream(stream: Any) -> str:
    result = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b""):
        result.update(block)
    return result.hexdigest()


def _is_link(path: Path) -> bool:
    if path.is_symlink():
        return True
    try:
        return bool(getattr(path.lstat(), "st_file_attributes", 0) & 0x400)
    except FileNotFoundError:
        return False


def _check_zip(path: Path, required: set[str]) -> set[str]:
    try:
        with zipfile.ZipFile(path) as archive:
            info = archive.infolist()
            names = [item.filename for item in info]
            if len(names) != len(set(names)) or len(names) > 10_000:
                raise HwpError("Ambiguous or oversized ZIP document")
            if sum(item.file_size for item in info) > 256 * 1024 * 1024:
                raise HwpError("ZIP document exceeds decompressed size limit")
            for item in info:
                if item.flag_bits & 1 or item.file_size > 128 * 1024 * 1024:
                    raise HwpError("Encrypted or oversized ZIP member")
                if item.file_size > 1024 * 1024 and item.file_size > 500 * max(item.compress_size, 1):
                    raise HwpError("Suspicious ZIP compression ratio")
            if not required.issubset(set(names)):
                raise HwpError("Output is not the requested document format")
            for name in required:
                value = archive.read(name)
                if name.endswith(".xml"):
                    if b"<!DOCTYPE" in value.upper() or b"<!ENTITY" in value.upper():
                        raise HwpError("XML entity declarations are not accepted")
                    ElementTree.fromstring(value)
            if archive.testzip() is not None:
                raise HwpError("Corrupt ZIP document")
            return set(names)
    except (zipfile.BadZipFile, ElementTree.ParseError) as exc:
        raise HwpError("Invalid document container") from exc


def validate_artifact(path: Path, format: str) -> dict[str, Any]:
    """Check the actual container, never just a suffix or SaveAs boolean."""
    if not path.is_file() or path.stat().st_size == 0:
        raise HwpError("Native engine produced no nonempty file")
    if path.stat().st_size > MAX_SOURCE_BYTES:
        raise HwpError("Document exceeds 64 MiB limit")
    with path.open("rb") as stream:
        head = stream.read(8)
    if format == "hwp":
        if head != CFB:
            raise HwpError("Requested HWP output is not a compound document")
    elif format == "hwpx":
        names = _check_zip(path, {"mimetype", "Contents/content.hpf"})
        if not any(name.startswith("Contents/section") and name.endswith(".xml") for name in names):
            raise HwpError("HWPX has no document sections")
        with zipfile.ZipFile(path) as archive:
            if archive.read("mimetype").strip() != b"application/hwp+zip":
                raise HwpError("Incorrect HWPX mimetype")
    elif format == "docx":
        _check_zip(path, {"[Content_Types].xml", "word/document.xml"})
    elif format == "pdf":
        if not head.startswith(b"%PDF-"):
            raise HwpError("Requested PDF output has no PDF header")
        try:
            from pypdf import PdfReader
        except ImportError as exc:
            raise HwpError("PDF verification requires pypdf; install the pdf extra") from exc
        try:
            reader = PdfReader(path, strict=True)
            if reader.is_encrypted or not len(reader.pages):
                raise HwpError("PDF must be readable, unencrypted, and contain pages")
            return {"container_valid": True, "page_count": len(reader.pages)}
        except HwpError:
            raise
        except Exception as exc:
            raise HwpError("PDF cannot be parsed") from exc
    else:
        raise HwpError("Unsupported format")
    return {"container_valid": True}


def _compact(text: str) -> str:
    # Reflow may change whitespace runs, but losing a word boundary is not OK.
    return " ".join(text.split())


def _lines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _text_digest(text: str) -> str:
    return hashlib.sha256(_compact(text).encode("utf-8")).hexdigest()


def _docx_body_text(path: Path) -> str:
    """Visible main-document paragraphs in XML order, including table cells.

    This is a content check, not a Word/LibreOffice layout or field audit.
    """
    with zipfile.ZipFile(path) as archive:
        root = ElementTree.fromstring(archive.read("word/document.xml"))
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    paragraphs = []
    for paragraph in root.iter(ns + "p"):
        values = []
        for node in paragraph.iter():
            if node.tag == ns + "t":
                values.append(node.text or "")
            elif node.tag in {ns + "tab", ns + "br", ns + "cr"}:
                values.append(" ")
        paragraphs.append("".join(values))
    return "\n".join(paragraphs)


def _snapshot(backend: Any) -> dict[str, Any]:
    fields = backend.get_fields()
    if len(fields) > 2000:
        raise HwpError("Document contains too many fields")
    return {"text": backend.get_text(), "fields": {name: backend.get_field(name) for name in fields}, "page_count": backend.page_count()}


def run_document_job(payload: dict[str, Any], backend_factory: Callable[[], Any]) -> dict[str, Any]:
    """Run inside an isolated worker; backend injection is for unit tests only."""
    with backend_factory() as backend:
        backend.open(Path(payload["source"]))
        before = _snapshot(backend)
        if payload["mode"] == "inspect":
            return before
        operations_report = []
        for index, operation in enumerate(payload.get("operations", [])):
            if operation["kind"] == "replace_text":
                text = backend.get_text()
                count = text.count(operation["old"])
                if count != operation["expected_count"]:
                    raise HwpError(f"Operation {index}: expected {operation['expected_count']} matches, found {count}")
                backend.replace_text(operation["old"], operation["new"], count)
                if backend.get_text() != text.replace(operation["old"], operation["new"]):
                    raise HwpError(f"Operation {index}: native replacement differs from literal edit")
                operations_report.append({"index": index, "kind": "replace_text", "matches": count})
            else:
                name = operation["name"]
                names = backend.get_fields()
                if name not in names:
                    raise HwpError(f"Operation {index}: field must be an exact inspected field name")
                if _lines(backend.get_field(name)) != _lines(operation["expected_old"]):
                    raise HwpError(f"Operation {index}: field value changed since inspection")
                backend.put_field(name, operation["value"])
                if _lines(backend.get_field(name)) != _lines(operation["value"]):
                    raise HwpError(f"Operation {index}: field write did not persist in memory")
                operations_report.append({"index": index, "kind": "set_field"})
        edited = _snapshot(backend)
        backend.save_as(Path(payload["primary"]), NATIVE_FORMATS[payload["primary_format"]])
    # Reopen the primary artifact; mutation happens only to the scratch copy.
    with backend_factory() as backend:
        backend.open(Path(payload["primary"]))
        saved = _snapshot(backend)
    if saved["text"] != edited["text"]:
        # DOCX exports can change paragraph delimiters. Content must still agree.
        if payload["primary_format"] != "docx" or _compact(saved["text"]) != _compact(edited["text"]):
            raise HwpError("Saved document content changed on native reopen")
    if payload["primary_format"] in {"hwp", "hwpx"} and saved["fields"] != edited["fields"]:
        raise HwpError("Saved field values changed on native reopen")
    for output in payload.get("exports", []):
        with backend_factory() as backend:
            backend.open(Path(payload["primary"]))
            backend.save_as(Path(output["path"]), NATIVE_FORMATS[output["format"]])
        if output["format"] not in {"pdf", "docx"}:
            with backend_factory() as backend:
                backend.open(Path(output["path"]))
                reopened_text = backend.get_text()
                if output["format"] in {"hwp", "hwpx"}:
                    reopened_fields = {name: backend.get_field(name) for name in backend.get_fields()}
                    if reopened_fields != edited["fields"]:
                        raise HwpError("Exported field names or values changed on native reopen")
            if _compact(reopened_text) != _compact(edited["text"]):
                raise HwpError("Exported document content changed on native reopen")
    return {"operations": operations_report, "page_count_before": before["page_count"], "page_count_after": saved["page_count"], "native_reopen": True, "expected_text_sha256": _text_digest(edited["text"])}


class HwpService:
    def __init__(self, workspace: Path, backend_factory: Callable[[], Any] | None = None, timeout: float = 60):
        supplied = Path(workspace).absolute()
        if not supplied.is_dir():
            raise HwpError("Workspace must be an existing directory")
        for ancestor in (supplied, *supplied.parents):
            if _is_link(ancestor):
                raise HwpError("Workspace must not pass through symlinks or junctions")
        self.workspace = supplied.resolve()
        self.backend_factory = backend_factory
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 0 < timeout <= 300:
            raise HwpError("Timeout must be between 0 and 300 seconds")
        self.timeout = timeout

    def _path(self, value: str, *, source: bool) -> Path:
        if not isinstance(value, str) or not value or "\x00" in value:
            raise HwpError("Document path must be a nonempty workspace-relative string")
        windows = PureWindowsPath(value)
        path = Path(value)
        if path.is_absolute() or windows.is_absolute() or windows.drive or ":" in value:
            raise HwpError("Absolute paths, drives, and alternate data streams are not allowed")
        parts = windows.parts
        if any(part in {"..", "."} or part.endswith((" ", ".")) for part in parts):
            raise HwpError("Traversal or ambiguous path component")
        reserved = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
        if any(part.split(".", 1)[0].upper() in reserved for part in parts):
            raise HwpError("Windows device paths are not allowed")
        candidate = self.workspace.joinpath(*parts)
        for ancestor in (candidate, *candidate.parents):
            if ancestor == self.workspace.parent:
                break
            if _is_link(ancestor):
                raise HwpError("Symlinks and junctions are not allowed")
        try:
            candidate.resolve().relative_to(self.workspace)
        except ValueError as exc:
            raise HwpError("Path leaves the workspace") from exc
        if source:
            if not candidate.is_file() or candidate.suffix.lower() not in INPUT_FORMATS:
                raise HwpError("Source must be an existing HWP or HWPX file")
            validate_artifact(candidate, candidate.suffix.lower()[1:])
        else:
            if candidate.exists() or candidate.is_symlink():
                raise HwpError("Output already exists; overwriting is not supported")
            if not candidate.parent.is_dir():
                raise HwpError("Output parent directory must already exist")
        return candidate

    def _output(self, value: str, format: str) -> Path:
        if not isinstance(format, str) or format not in FORMATS:
            raise HwpError("Format must be hwp, hwpx, pdf, or docx")
        path = self._path(value, source=False)
        if path.suffix.lower() != FORMATS[format]:
            raise HwpError("Output suffix must match the requested format")
        return path

    def _run(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self.backend_factory is not None:
            return run_document_job(payload, self.backend_factory)
        if sys.platform != "win32":
            raise HwpError("Hancom native automation requires Windows")
        try:
            result = subprocess.run([sys.executable, "-m", "one_hwp.worker"], input=json.dumps(payload, ensure_ascii=False).encode("utf-8"), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=self.timeout, check=False)
        except subprocess.TimeoutExpired as exc:
            raise HwpError("Hancom worker timed out; no output was published. An isolated Hancom instance may need closing; existing user sessions were not terminated.") from exc
        try:
            response = json.loads(result.stdout.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise HwpError("Hancom worker failed without a valid result; no output was published") from exc
        if result.returncode or not response.get("ok"):
            raise HwpError(str(response.get("error", "Hancom worker failed")))
        return response["result"]

    def _freeze(self, source: Path, stage: Path, expected: str | None) -> str:
        if expected is not None and (not isinstance(expected, str) or len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected)):
            raise HwpError("expected_sha256 must be a lowercase 64-character SHA-256")
        original_hash = digest(source)
        if expected is not None and original_hash != expected:
            raise HwpError("Source changed since inspection")
        shutil.copyfile(source, stage)
        if digest(source) != original_hash or digest(stage) != original_hash:
            raise HwpError("Source changed during snapshot")
        return original_hash

    @contextmanager
    def _scratch(self):
        """Do not silently retain document copies when Windows holds a lock."""
        folder = tempfile.TemporaryDirectory(prefix=".one-hwp-", dir=self.workspace, ignore_cleanup_errors=True)
        path = Path(folder.name)
        warnings: list[str] = []
        failure = None
        try:
            yield path, warnings
        except BaseException as exc:
            failure = exc
            raise
        finally:
            try:
                folder.cleanup()
                retained = path.exists()
            except OSError:
                retained = True
            if retained:
                message = (
                    f"Scratch cleanup incomplete: {path.name} may contain document copies. "
                    "Close only the isolated Hancom instance and remove that directory when unlocked; "
                    "existing user sessions were not terminated."
                )
                if isinstance(failure, Exception):
                    raise HwpError(f"{failure} {message}") from failure
                if failure is not None:
                    failure.add_note(message)
                else:
                    warnings.append(message)

    def inspect(self, source: str) -> dict[str, Any]:
        path = self._path(source, source=True)
        with self._scratch() as (directory, cleanup_warnings):
            staged = directory / ("source" + path.suffix.lower())
            source_hash = self._freeze(path, staged, None)
            result = self._run({"mode": "inspect", "source": str(staged)})
            if digest(path) != source_hash:
                raise HwpError("Source changed while inspecting")
        text = result["text"]
        remaining = MAX_TEXT
        fields = []
        for name, value in result["fields"].items():
            fields.append({"name": name, "value": value[:remaining], "truncated": len(value) > remaining})
            remaining = max(0, remaining - len(value))
        return {"source": source, "source_sha256": source_hash, "text": text[:MAX_TEXT], "text_truncated": len(text) > MAX_TEXT, "fields": fields, "page_count": result["page_count"], "source_unchanged": True, "warnings": cleanup_warnings}

    def _operations(self, operations: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not isinstance(operations, list) or not 1 <= len(operations) <= 100:
            raise HwpError("edit requires between 1 and 100 operations")
        for op in operations:
            if not isinstance(op, dict):
                raise HwpError("Each operation must be an object")
            kind = op.get("kind")
            if kind == "replace_text":
                if set(op) != {"kind", "old", "new", "expected_count"}:
                    raise HwpError("replace_text requires kind, old, new, expected_count only")
                if not isinstance(op["old"], str) or not op["old"] or not isinstance(op["new"], str):
                    raise HwpError("Replacement requires nonempty old text and string new text")
                if any(c in op["old"] + op["new"] for c in "\r\n\t\x00") or max(len(op["old"]), len(op["new"])) > MAX_TEXT:
                    raise HwpError("Literal replacements must be single-line text; use fields for multiline content")
                if type(op["expected_count"]) is not int or not 0 <= op["expected_count"] <= 10_000:
                    raise HwpError("expected_count must be an integer between 0 and 10000")
            elif kind == "set_field":
                if set(op) != {"kind", "name", "value", "expected_old"} or not all(isinstance(op[k], str) for k in ("name", "value", "expected_old")):
                    raise HwpError("set_field requires string name, value, expected_old")
                if not op["name"] or any("\x00" in op[k] or len(op[k]) > MAX_TEXT for k in ("name", "value", "expected_old")):
                    raise HwpError("Invalid field name or value")
            else:
                raise HwpError("Only replace_text and set_field operations are supported")
        return operations

    def edit(self, source: str, output: str, operations: list[dict[str, Any]], exports: list[dict[str, str]] | None = None, expected_sha256: str | None = None) -> dict[str, Any]:
        if not isinstance(output, str) or Path(output).suffix.lower() not in {".hwp", ".hwpx"}:
            raise HwpError("Edited primary output must be HWP or HWPX")
        return self._produce(source, output, Path(output).suffix.lower()[1:], self._operations(operations), exports, expected_sha256)

    def export(self, source: str, output: str, format: str, expected_sha256: str | None = None) -> dict[str, Any]:
        return self._produce(source, output, format, [], None, expected_sha256)

    def _produce(self, source: str, output: str, format: str, operations: list[dict[str, Any]], exports: list[dict[str, str]] | None, expected_sha256: str | None) -> dict[str, Any]:
        source_path = self._path(source, source=True)
        target = self._output(output, format)
        if format in {"pdf", "docx"}:
            # DOCX import filters vary by Hancom installation. Keep an editable
            # native primary and check exported DOCX content through OOXML.
            primary_format = "hwp"
        else:
            primary_format = format
        if exports is None:
            exports = []
        if not isinstance(exports, list) or len(exports) > 8:
            raise HwpError("exports must be a list of at most 8 output requests")
        requests = [{"output": output, "format": format, "path": target}]
        for item in exports:
            if not isinstance(item, dict) or set(item) != {"output", "format"}:
                raise HwpError("Each export requires output and format only")
            requests.append({**item, "path": self._output(item["output"], item["format"])})
        keys = [os.path.normcase(str(item["path"])) for item in requests]
        if len(keys) != len(set(keys)):
            raise HwpError("Output paths must be distinct")
        report_outputs = []
        published: list[tuple[Path, Path]] = []
        with self._scratch() as (stage_dir, cleanup_warnings):
            snapshot = stage_dir / ("source" + source_path.suffix.lower())
            source_hash = self._freeze(source_path, snapshot, expected_sha256)
            primary = stage_dir / ("primary" + FORMATS[primary_format])
            staged_requests = []
            for index, item in enumerate(requests):
                staged_requests.append({**item, "staged": primary if index == 0 and format in {"hwp", "hwpx"} else stage_dir / (f"export-{index}" + FORMATS[item["format"]])})
            native_exports = [{"path": str(item["staged"]), "format": item["format"]} for item in staged_requests if item["staged"] != primary]
            result = self._run({"mode": "edit" if operations else "export", "source": str(snapshot), "primary": str(primary), "primary_format": primary_format, "operations": operations, "exports": native_exports})
            validate_artifact(primary, primary_format)
            for item in staged_requests:
                checks = validate_artifact(item["staged"], item["format"])
                if item["format"] == "docx":
                    if _text_digest(_docx_body_text(item["staged"])) != result["expected_text_sha256"]:
                        raise HwpError("DOCX main-document content differs from the edited native document")
                    checks.update({"text_verified": True, "text_verification_method": "docx_main_document_xml", "native_reopen": False})
                elif item["format"] in {"hwp", "hwpx"}:
                    checks.update({"text_verified": True, "native_reopen": True, "fields_verified": True})
                else:
                    checks.update({"text_verified": False, "native_reopen": False})
                report_outputs.append({"path": item["output"], "format": item["format"], "sha256": digest(item["staged"]), "size_bytes": item["staged"].stat().st_size, **checks, "layout_verified": False})
            if digest(source_path) != source_hash:
                raise HwpError("Source changed during operation; outputs not published")
            try:
                for item in staged_requests:
                    # Recheck the path immediately before exclusive publication.
                    checked = self._output(item["output"], item["format"])
                    os.link(item["staged"], checked)
                    published.append((checked, item["staged"]))
                for (path, _), record in zip(published, report_outputs):
                    if digest(path) != record["sha256"] or path.stat().st_size != record["size_bytes"]:
                        raise HwpError("Published output changed; verification report would be stale")
                if digest(source_path) != source_hash:
                    raise HwpError("Source changed during publication")
            except BaseException:
                for path, staged in published:
                    try:
                        if os.path.samestat(path.stat(), staged.stat()):
                            path.unlink()
                    except FileNotFoundError:
                        pass
                raise
        result.pop("expected_text_sha256", None)
        warnings = ["Native and container checks do not prove visual fidelity. Review rendered pages before submission."]
        if any(item["format"] == "docx" for item in requests):
            warnings.append("DOCX conversion may reflow tables, fonts, fields, and page breaks; DOCX native import is not required or certified.")
        return {"source": source, "source_sha256": source_hash, "source_unchanged": True, "outputs": report_outputs, **result, "layout_verified": False, "warnings": [*warnings, *cleanup_warnings]}

    def doctor(self) -> dict[str, Any]:
        modules = {name: importlib.util.find_spec(name) is not None for name in ("win32com", "mcp", "pypdf")}
        result: dict[str, Any] = {"platform": sys.platform, "python": sys.version.split()[0], "dependencies": modules, "com_registered": False, "security_module_registered": False, "native_engine_tested": False, "note": "Read-only metadata check; does not launch Hancom or prove export support."}
        if sys.platform == "win32":
            import winreg
            for view in (winreg.KEY_WOW64_32KEY, winreg.KEY_WOW64_64KEY):
                try:
                    with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, "HWPFrame.HwpObject\\CLSID", 0, winreg.KEY_READ | view):
                        result["com_registered"] = True
                except OSError:
                    pass
            try:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Software\\HNC\\HwpAutomation\\Modules") as key:
                    module, _ = winreg.QueryValueEx(key, "FilePathCheckerModule")
                    result["security_module_registered"] = Path(module).is_file()
            except OSError:
                pass
        return result
