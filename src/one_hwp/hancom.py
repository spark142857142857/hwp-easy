"""Narrow, isolated Hancom Automation adapter.

This module never connects to an active user's Hancom instance. Its caller must
provide a private working copy and verify exported artifacts before publishing.
COM methods cannot be interrupted safely here; call this adapter in a bounded
worker process. A successful SaveAs is not a layout-fidelity guarantee.
"""

from __future__ import annotations

from pathlib import Path
import re
import threading


class HancomError(RuntimeError):
    """Native automation failed or could not meet the exact-edit contract."""


def _load_com():
    try:
        import pythoncom
        import win32com.client
    except ImportError as exc:
        raise HancomError("Hancom automation requires Windows and pywin32") from exc
    return pythoncom, win32com.client


class HancomBackend:
    """Own one DispatchEx instance on one STA thread for one transaction."""

    def __init__(self, security_module: str | None = "FilePathCheckerModule", visible=False):
        if security_module is not None and (
            not isinstance(security_module, str) or not security_module
            or any(ord(char) < 32 for char in security_module)
        ):
            raise ValueError("security_module must be a nonempty module name or None")
        if type(visible) is not bool:
            raise ValueError("visible must be boolean")
        self.security_module = security_module
        self.visible = visible
        self._app = None
        self._pythoncom = None
        self._thread = None
        self._file_access_ready = False
        self._used = False

    def __enter__(self):
        if self._used:
            raise HancomError("A HancomBackend cannot be entered more than once")
        self._used = True
        com, client = _load_com()
        try:
            com.CoInitializeEx(com.COINIT_APARTMENTTHREADED)
        except Exception as exc:
            raise HancomError("Hancom requires a COM STA worker thread") from exc
        self._pythoncom = com
        self._thread = threading.get_ident()
        try:
            self._app = client.DispatchEx("HWPFrame.HwpObject")
            self._app.XHwpWindows.Item(0).Visible = self.visible
            if self.security_module is not None:
                registered = self._app.RegisterModule("FilePathCheckDLL", self.security_module)
                if not registered:
                    raise HancomError("Existing Hancom file security module registration failed")
                self._file_access_ready = True
        except Exception as exc:
            failures = self._cleanup()
            failure = exc if isinstance(exc, HancomError) else HancomError(
                "Could not initialize an isolated Hancom instance"
            )
            if failures:
                failure.add_note("Private Hancom cleanup failed: " + ", ".join(failures))
            if failure is exc:
                raise
            raise failure from exc
        return self

    def _ready(self, *, files=False):
        if self._app is None or self._thread != threading.get_ident():
            raise HancomError("Hancom must be used inside its owning STA context")
        if files and not self._file_access_ready:
            raise HancomError("File access requires an existing registered Hancom security module")
        return self._app

    def _cleanup(self):
        failures = []
        app, self._app = self._app, None
        if app is not None:
            try:
                # Clear(1) discards only this private instance's unsaved document.
                app.Clear(1)
            except Exception:
                failures.append("clear")
            try:
                app.Quit()
            except Exception:
                failures.append("quit")
        com, self._pythoncom = self._pythoncom, None
        self._file_access_ready = False
        self._thread = None
        if com is not None:
            try:
                com.CoUninitialize()
            except Exception:
                failures.append("COM uninitialize")
        return failures

    def __exit__(self, exc_type, exc, traceback):
        if self._thread is not None and self._thread != threading.get_ident():
            raise HancomError("Hancom context must close on its owning STA thread")
        failures = self._cleanup()
        if failures:
            message = "Private Hancom cleanup failed: " + ", ".join(failures)
            if exc is not None:
                exc.add_note(message)
            else:
                raise HancomError(message)
        return False

    @staticmethod
    def _path(path: Path) -> Path:
        path = Path(path)
        if not path.is_absolute() or any(ord(char) < 32 for char in str(path)):
            raise ValueError("Hancom paths must be absolute without control characters")
        return path

    def open(self, path: Path):
        app = self._ready(files=True)
        path = self._path(path)
        if not path.is_file():
            raise HancomError("Hancom working-copy input does not exist")
        try:
            result = app.Open(
                str(path), "",
                "lock:false;suspendpassword:true;forceopen:true;versionwarning:false",
            )
        except Exception as exc:
            raise HancomError("Hancom could not open the working copy") from exc
        if not result:
            raise HancomError("Hancom rejected the working copy (format, password, or access)")

    def get_text(self) -> str:
        try:
            # Desktop Hancom 2020 TEXT is an ANSI export and can corrupt Korean.
            # UNICODE (not the similarly named web-control TEXT API) preserves it.
            text = self._ready().GetTextFile("UNICODE", "")
        except HancomError:
            raise
        except Exception as exc:
            raise HancomError("Hancom text extraction failed") from exc
        if not isinstance(text, str):
            raise HancomError("Hancom text extraction did not return Unicode text")
        return text

    def get_fields(self) -> list[str]:
        try:
            names = self._ready().GetFieldList(1, 0)
        except HancomError:
            raise
        except Exception as exc:
            raise HancomError("Hancom field enumeration failed") from exc
        if not isinstance(names, str):
            raise HancomError("Hancom field enumeration did not return text")
        return [name for name in names.split("\x02") if name]

    def _field(self, name):
        if not isinstance(name, str) or not name or any(ord(char) < 32 for char in name):
            raise ValueError("field name must be nonempty without separators/control characters")
        fields = self.get_fields()
        if name in fields:
            return name
        matches = [field for field in fields if re.sub(r"\{\{\d+\}\}$", "", field) == name]
        if len(matches) == 1:
            return matches[0]
        if matches:
            raise HancomError("Field name is ambiguous; use its explicit {{index}} name")
        raise HancomError("Requested Hancom field does not exist")

    def get_field(self, name) -> str:
        target = self._field(name)
        try:
            value = self._ready().GetFieldText(target)
        except Exception as exc:
            raise HancomError("Hancom field reading failed") from exc
        if not isinstance(value, str):
            raise HancomError("Hancom field reading did not return Unicode text")
        return value

    def put_field(self, name, value):
        if not isinstance(value, str) or "\x00" in value or "\x02" in value:
            raise ValueError("field value must be text without null/field-list separators")
        target = self._field(name)
        # Native 2020 PutFieldText silently drops bare LF characters. Canonical
        # CRLF input is necessary for real paragraphs, not only for comparison.
        native_value = value.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\r\n")
        try:
            self._ready().PutFieldText(target, native_value)
        except Exception as exc:
            raise HancomError("Hancom field writing failed") from exc
        if self.get_field(target) != native_value:
            # The native method has no reliable success result; re-read the field.
            raise HancomError("Hancom field value did not match the requested text after writing")

    def replace_text(self, old, new, expected_count) -> int:
        if not isinstance(old, str) or not old or not isinstance(new, str):
            raise ValueError("replacement requires nonempty old text and text new value")
        if any(ord(char) < 32 for char in old + new):
            raise ValueError("replacement supports single-line literals without control characters")
        if type(expected_count) is not int or expected_count < 0:
            raise ValueError("expected_count must be a nonnegative integer")
        before = self.get_text()
        count = before.count(old)
        if count != expected_count:
            raise HancomError("Literal occurrence count does not match expected_count")
        if not count or old == new:
            return count
        app = self._ready()
        try:
            parameters = app.HParameterSet.HFindReplace
            app.HAction.GetDefault("AllReplace", parameters.HSet)
            # Never inherit native find-dialog options from a preceding operation.
            options = {
                "MatchCase": 1, "AllWordForms": 0, "SeveralWords": 0,
                "UseWildCards": 0, "WholeWordOnly": 0, "AutoSpell": 0,
                "Direction": app.FindDir("AllDoc"), "IgnoreFindString": 0,
                "IgnoreReplaceString": 0, "FindString": old, "ReplaceString": new,
                "ReplaceMode": 1, "IgnoreMessage": 1, "HanjaFromHangul": 0,
                "FindJaso": 0, "FindRegExp": 0, "FindStyle": "", "ReplaceStyle": "",
                "FindType": 1,
            }
            for key, value in options.items():
                setattr(parameters, key, value)
            app.HAction.Execute("AllReplace", parameters.HSet)
        except Exception as exc:
            raise HancomError("Hancom literal replacement failed") from exc
        # Hancom 2020 returns False for AllReplace even when all replacements
        # succeeded (measured on a paragraph+table fixture). Its return value
        # cannot certify success; the complete Unicode text contract below can.
        if self.get_text() != before.replace(old, new):
            raise HancomError("Native replacement changed text outside the exact literal contract")
        return count

    def save_as(self, path: Path, format: str):
        app = self._ready(files=True)
        path = self._path(path)
        if not isinstance(format, str):
            raise ValueError("format must be HWP, HWPX, PDF, or OOXML/DOCX")
        native_format = format.upper()
        if native_format == "DOCX":
            native_format = "OOXML"
        extensions = {"HWP": ".hwp", "HWPX": ".hwpx", "PDF": ".pdf", "OOXML": ".docx"}
        if native_format not in extensions or path.suffix.lower() != extensions[native_format]:
            raise ValueError("output suffix must match HWP, HWPX, PDF, or OOXML/DOCX format")
        if path.exists() or not path.parent.is_dir():
            raise HancomError("Hancom export requires a new file in an existing private directory")
        try:
            result = app.SaveAs(str(path), native_format, "lock:false;backup:false;export:true")
        except Exception as exc:
            raise HancomError("Hancom export failed") from exc
        if not result or not path.is_file() or path.stat().st_size == 0:
            raise HancomError("Hancom did not produce a nonempty export")

    def page_count(self) -> int | None:
        app = self._ready()
        try:
            count = app.PageCount
        except Exception:
            return None
        return count if type(count) is int and count >= 1 else None
