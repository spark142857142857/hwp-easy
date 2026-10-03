"""Hancom-free HWP 5 adapter. Document bytes, never caller-selected code, cross the bridge.

The WASM parser runs in a time-limited Node subprocess. This is not an OS sandbox
and does not certify all HWP records, layout, or hosted multi-user isolation.
"""
from __future__ import annotations

import base64
import binascii
import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
from typing import Any
import zlib


class EngineError(RuntimeError):
    """Safe engine failure; messages must not contain document contents."""


class UnsupportedDocumentError(EngineError):
    pass


class RhwpEngine:
    VERSION = "0.8.6"
    # Conservative HWP 5 body profile: paragraphs, simple control/list headers,
    # section/page definitions and top-level tables. This is not an exhaustive
    # list of valid HWP tags. Unknown valid tags must be disclosed, not dropped.
    BODY_TAGS = frozenset({66, 67, 68, 69, 71, 72, 73, 74, 75, 77})
    MAX_EXPANDED_BYTES = 64 * 1024 * 1024

    def __init__(self, *, node: str | None = None, timeout: float = 45,
                 max_document_bytes: int = 16 * 1024 * 1024,
                 runtime_root: Path | str | None = None):
        self.node = node or shutil.which("node")
        self.timeout = timeout
        self.max_document_bytes = max_document_bytes
        self.bridge = Path(__file__).with_name("rhwp_bridge.mjs")
        self.runtime_root = runtime_root

    def capabilities(self) -> dict[str, Any]:
        info = self._call("capabilities")
        return {**info, "max_document_bytes": self.max_document_bytes,
                "timeout_seconds": self.timeout, "hancom_required": False,
                "layout_verified": False, "os_sandbox": False}

    def _validate(self, data: bytes) -> None:
        if not isinstance(data, bytes) or len(data) > self.max_document_bytes:
            raise UnsupportedDocumentError("Document exceeds the configured input limit or is not bytes")
        try:
            import olefile
        except ImportError as exc:
            raise EngineError("Native HWP validation dependency is not installed") from exc
        try:
            with olefile.OleFileIO(io.BytesIO(data)) as container:
                header = container.openstream("FileHeader").read(256)
                if len(header) < 40 or not header.startswith(b"HWP Document File\x00"):
                    raise UnsupportedDocumentError("Not a supported HWP document")
                if header[35] != 5:
                    raise UnsupportedDocumentError("Only HWP 5.x is supported")
                flags = struct.unpack_from("<I", header, 36)[0]
                # Password, distribution, scripts, DRM and signed/history data are
                # outside the first conservative editing/reading profile.
                if flags & ~1:
                    raise UnsupportedDocumentError("HWP security or optional header features are outside the supported profile")
                if not container.exists("DocInfo") or not container.exists("BodyText/Section0"):
                    raise UnsupportedDocumentError("HWP body streams are missing")
        except UnsupportedDocumentError:
            raise
        except Exception as exc:
            raise UnsupportedDocumentError("Malformed HWP container or header") from exc

    def _call(self, action: str, data: bytes | None = None, **kwargs: Any) -> dict[str, Any]:
        if not self.node:
            raise EngineError("Node.js engine runtime is unavailable")
        request = {"action": action, **kwargs}
        profile = None
        if data is not None:
            self._validate(data)
            profile = self._body_profile(data)
            if action == "edit" and profile["unsupported"]:
                raise UnsupportedDocumentError("Unverified HWP body records cannot be safely edited")
            request["data"] = base64.b64encode(data).decode("ascii")
        try:
            environment = os.environ.copy()
            if self.runtime_root is not None:
                environment["HWP_EASY_RUNTIME_DIR"] = str(Path(self.runtime_root).resolve())
            process = subprocess.run(
                [self.node, "--max-old-space-size=256", str(self.bridge)],
                input=json.dumps(request, ensure_ascii=True),
                capture_output=True, text=True, encoding="utf-8",
                timeout=self.timeout, check=False,
                env=environment,
            )
        except subprocess.TimeoutExpired as exc:
            raise EngineError("Document engine timed out; no document was saved") from exc
        except OSError as exc:
            raise EngineError("Document engine runtime could not start") from exc
        # Do not forward upstream stderr/error strings: they may contain body text.
        if process.returncode != 0 or len(process.stdout) > 64 * 1024 * 1024:
            raise EngineError("Document engine failed or exceeded the response limit")
        try:
            result = json.loads(process.stdout)
            if not isinstance(result, dict) or result.get("ok") is not True:
                raise ValueError
            payload = result["result"]
            if not isinstance(payload, dict):
                raise ValueError
            if action == "inspect" and profile is not None:
                payload["unsupported"] = [*payload.get("unsupported", []), *profile["unsupported"]]
                if profile["paragraph_records"] != len(payload.get("blocks", [])):
                    payload["unsupported"].append({
                        "kind": "paragraph_coverage_mismatch",
                        "reason": "Not all HWP paragraph records are represented in the content view",
                    })
            return payload
        except (ValueError, KeyError, TypeError) as exc:
            raise EngineError("Document engine rejected the request or returned an invalid response") from exc

    def inspect(self, data: bytes) -> dict[str, Any]:
        return self._call("inspect", data)

    def edit(self, data: bytes, operations: list[dict[str, Any]]) -> bytes:
        before = self.inspect(data)
        result = self._call("edit", data, operations=operations)
        try:
            output = base64.b64decode(result["data"], validate=True)
        except (KeyError, ValueError, binascii.Error) as exc:
            raise EngineError("Document engine returned invalid HWP bytes") from exc
        self._validate(output)
        self._verify_stream_preservation(data, output, before["blocks"], operations)
        return output

    @staticmethod
    def _docinfo_content(data: bytes, compressed: bool) -> bytes:
        """Compare DocInfo content, excluding its three saved caret DWORDs.

        HWP DOCUMENT_PROPERTIES (tag 16) has seven u16 document counters
        followed by the 12-byte saved caret. The latter legitimately moves
        during an edit; font/style/other metadata must remain byte-identical.
        See the pinned upstream serializer and the HWP 5.0 format specification.
        """
        limit = 8 * 1024 * 1024
        if compressed:
            try:
                data = RhwpEngine._inflate(data, True, limit, allow_zero_padding=False)
            except UnsupportedDocumentError as exc:
                raise EngineError("DocInfo exceeds the supported validation profile") from exc
        if len(data) < 30 or len(data) > limit:
            raise EngineError("Unsupported DocInfo record layout")
        header = struct.unpack_from("<I", data)[0]
        if (header & 0x3ff) != 16 or ((header >> 10) & 0x3ff) != 0 or (header >> 20) != 26:
            raise EngineError("Unsupported DocInfo document properties")
        return data[:18] + b"\x00" * 12 + data[30:]

    @staticmethod
    def _verify_stream_preservation(original: bytes, edited: bytes,
                                    blocks: list[dict[str, Any]], operations: list[dict[str, Any]]) -> None:
        """Independent CFB check for data outside rewritten body/preview streams.

        Paragraph text/counts and regenerated line geometry may change. Other
        record payloads and untargeted text/style references must remain intact.
        This remains a narrow profile, not certification of all HWP variants.
        """
        import olefile
        try:
            with olefile.OleFileIO(io.BytesIO(original)) as before, olefile.OleFileIO(io.BytesIO(edited)) as after:
                names = {tuple(name) for name in before.listdir()}
                output_names = {tuple(name) for name in after.listdir()}
                if names != output_names:
                    raise EngineError("CFB stream preservation check failed")
                before_flags = struct.unpack_from("<I", before.openstream("FileHeader").read(), 36)[0]
                after_flags = struct.unpack_from("<I", after.openstream("FileHeader").read(), 36)[0]
                targets = {operation["target_id"] for operation in operations}
                grouped = {}
                for block in blocks:
                    grouped.setdefault(block["section"], []).append(block)
                for name in names:
                    if name[0] in ("PrvText", "PrvImage"):
                        continue
                    original_stream = before.openstream(list(name)).read()
                    edited_stream = after.openstream(list(name)).read()
                    if name == ("DocInfo",):
                        original_stream = RhwpEngine._docinfo_content(original_stream, bool(before_flags & 1))
                        edited_stream = RhwpEngine._docinfo_content(edited_stream, bool(after_flags & 1))
                    elif name[0] == "BodyText":
                        section = int(name[1][7:])
                        target_indexes = {index for index, block in enumerate(grouped.get(section, [])) if block["id"] in targets}
                        original_stream = RhwpEngine._body_preservation_records(original_stream, bool(before_flags & 1), target_indexes)
                        edited_stream = RhwpEngine._body_preservation_records(edited_stream, bool(after_flags & 1), target_indexes)
                    if original_stream != edited_stream:
                        raise EngineError("Non-target HWP data changed during editing")
        except EngineError:
            raise
        except Exception as exc:
            raise EngineError("Independent HWP preservation check failed") from exc

    @classmethod
    def _body_preservation_records(cls, stream: bytes, compressed: bool,
                                  targets: set[int]) -> list[tuple[int, int, bytes]]:
        raw = cls._inflate(stream, compressed, cls.MAX_EXPANDED_BYTES)
        position, paragraph = 0, -1
        result = []
        while position < len(raw):
            header = struct.unpack_from("<I", raw, position)[0]
            position += 4
            tag, level, size = header & 0x3ff, (header >> 10) & 0x3ff, header >> 20
            if size == 0xfff:
                size = struct.unpack_from("<I", raw, position)[0]
                position += 4
            payload = raw[position:position + size]
            if len(payload) != size:
                raise EngineError("Truncated body preservation record")
            position += size
            if tag == 66:
                paragraph += 1
                if len(payload) < 22:
                    raise EngineError("Unsupported paragraph header layout")
                # Text count, line count, and targeted char-run count are derived
                # from edited text. Paragraph shape/style/instance data are not.
                canonical = bytearray(payload)
                # Only the low 31 bits are a derived text count. The high bit
                # identifies the final paragraph in its list and must survive.
                canonical[16:18] = b"\x00" * 2
                if paragraph in targets:
                    canonical[0:4] = struct.pack("<I", struct.unpack_from("<I", payload)[0] & 0x80000000)
                    canonical[12:14] = b"\x00" * 2
                payload = bytes(canonical)
            elif tag == 67 and paragraph in targets:
                payload = cls._text_control_bytes(payload)
            elif tag == 68 and paragraph in targets:
                if len(payload) % 8:
                    raise EngineError("Unverified character-shape record tail")
                # Run positions/counts can change with text length, but even
                # references outside visible text must not silently disappear.
                # The WASM check separately verifies visible uniform styling.
                ids = sorted({struct.unpack_from("<I", payload, offset + 4)[0]
                              for offset in range(0, len(payload), 8)})
                payload = b"".join(struct.pack("<I", value) for value in ids)
            elif tag == 69:
                if len(payload) % 36:
                    raise EngineError("Unverified line-segment record tail")
                payload = b""  # Regenerated line geometry is not layout certification.
            result.append((tag, level, payload))
        return result

    @staticmethod
    def _text_control_bytes(payload: bytes) -> bytes:
        """Remove only visible UTF-16 text, retaining all binary control slots.

        HWP 5 char controls occupy one unit; inline/extended controls occupy
        eight. Tabs retain their binary width/type data, conservatively refusing
        changes that would drop them. This is a preservation check, not a writer.
        """
        if len(payload) % 2:
            raise EngineError("Unverified paragraph text tail")
        controls = bytearray()
        offset = 0
        while offset < len(payload):
            code = struct.unpack_from("<H", payload, offset)[0]
            count = 16 if code in (*range(1, 10), 11, 12, *range(14, 24)) else 2
            if offset + count > len(payload):
                raise EngineError("Truncated paragraph control slot")
            if code < 32:
                controls.extend(payload[offset:offset + count])
            offset += count
        return bytes(controls)

    def preview(self, data: bytes, page: int) -> dict[str, Any]:
        if type(page) is not int or page < 0:
            raise ValueError("Page must be a nonnegative integer")
        return self._call("preview", data, page=page)

    @staticmethod
    def _inflate(data: bytes, compressed: bool, limit: int, *,
                 allow_zero_padding: bool = True) -> bytes:
        """Bound raw DEFLATE and verify an optional CRC32/ISIZE trailer.

        Some local HWP streams have the 8-byte little-endian gzip trailer,
        without a gzip header. Recognize only its exact length AND both values
        (RFC 1952 section 2.3.1), not arbitrary tail bytes or another member.
        Existing zero padding remains body-only; DocInfo opts out explicitly.
        CRC32 detects accidental corruption, not authenticity or edit safety.
        """
        if compressed:
            decoder = zlib.decompressobj(-15)
            try:
                expanded = decoder.decompress(data, limit + 1)
            except zlib.error as exc:
                raise UnsupportedDocumentError("Invalid HWP compressed stream") from exc
            if len(expanded) > limit:
                raise UnsupportedDocumentError("Compressed HWP stream exceeds the supported processing profile")
            if not decoder.eof:
                raise UnsupportedDocumentError("Truncated HWP compressed stream")
            tail = decoder.unused_data
            if tail:
                verified_trailer = (len(tail) == 8
                    and struct.unpack("<II", tail) == (zlib.crc32(expanded), len(expanded) & 0xffffffff))
                if not verified_trailer and not (allow_zero_padding and not any(tail)):
                    raise UnsupportedDocumentError("Unverified HWP compressed stream tail")
            return expanded
        if len(data) > limit:
            raise UnsupportedDocumentError("HWP stream exceeds the supported processing limit")
        return data

    @classmethod
    def _body_profile(cls, data: bytes) -> dict[str, Any]:
        """Bound decompression and detect records the WASM view might omit.

        The upstream model alone is insufficient: an unknown body record can
        disappear on save without a reported content loss or validation warning.
        This reader only examines record envelopes, not an alternate HWP engine.
        """
        import olefile
        unsupported = []
        paragraphs = 0
        expanded_total = 0
        record_count = 0
        try:
            with olefile.OleFileIO(io.BytesIO(data)) as container:
                compressed = bool(struct.unpack_from("<I", container.openstream("FileHeader").read(), 36)[0] & 1)
                sections = [name for name in container.listdir() if name[0] == "BodyText"]
                indexes = []
                for name in sections:
                    if len(name) != 2 or not name[1].startswith("Section") or not name[1][7:].isdigit():
                        raise UnsupportedDocumentError("Unsupported HWP body stream layout")
                    indexes.append(int(name[1][7:]))
                    raw = cls._inflate(container.openstream(name).read(), compressed, cls.MAX_EXPANDED_BYTES - expanded_total)
                    expanded_total += len(raw)
                    position = 0
                    while position < len(raw):
                        if position + 4 > len(raw):
                            raise UnsupportedDocumentError("Truncated HWP body record")
                        header = struct.unpack_from("<I", raw, position)[0]
                        position += 4
                        tag, level, size = header & 0x3ff, (header >> 10) & 0x3ff, header >> 20
                        if size == 0xfff:
                            if position + 4 > len(raw):
                                raise UnsupportedDocumentError("Truncated extended HWP record")
                            size = struct.unpack_from("<I", raw, position)[0]
                            position += 4
                        if position + size > len(raw):
                            raise UnsupportedDocumentError("HWP body record exceeds its stream")
                        record_count += 1
                        if record_count > 1_000_000:
                            raise UnsupportedDocumentError("HWP record count exceeds the processing limit")
                        if tag == 66:
                            paragraphs += 1
                        if tag not in cls.BODY_TAGS:
                            if len(unsupported) >= 1024:
                                raise UnsupportedDocumentError("Too many unsupported HWP records")
                            unsupported.append({"kind": "body_record", "section": int(name[1][7:]),
                                                "record_tag": tag, "record_level": level,
                                                "reason": "Record is outside the verified content/preservation profile"})
                        position += size
                if sorted(indexes) != list(range(len(indexes))):
                    raise UnsupportedDocumentError("HWP section sequence is incomplete")
        except UnsupportedDocumentError:
            raise
        except Exception as exc:
            raise UnsupportedDocumentError("Malformed HWP body record stream") from exc
        return {"unsupported": unsupported, "paragraph_records": paragraphs}
