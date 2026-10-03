"""Versioned, conservative orchestration for the Hancom-free HWP engine.

This module neither parses HWP nor grants filesystem permissions. The injected
engine validates document content and the injected store enforces path policy
and recoverable publication. Content/structure checks do not verify layout.
Opaque cursors and idempotency receipts are bounded, process-local caches; they
are not persistent sessions, authorization tokens, or crash-safe transactions.
No document text, bytes, or upstream engine exception messages are logged.
"""
from __future__ import annotations

import base64
import binascii
from collections import OrderedDict
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import threading
from typing import Any


_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_OPERATION_KEYS = frozenset({"target_id", "expected_old", "new_text"})
_UNSUPPORTED_NEW_TEXT = re.compile(r"[\r\n\x00-\x08\x0b-\x1f\ud800-\udfff]")
_CELL_LOCATION_KEYS = ("control", "cell", "cell_paragraph", "row", "column",
                       "row_span", "column_span")


class NativeServiceError(ValueError):
    """A safe service validation error, without document body text."""


def _hash(value: Any) -> str:
    if not isinstance(value, str) or _SHA256.fullmatch(value) is None:
        raise NativeServiceError("Expected a lowercase SHA-256 document version")
    return value


def _positive(value: Any, name: str, maximum: int) -> int:
    if type(value) is not int or not 1 <= value <= maximum:
        raise NativeServiceError(f"{name} must be an integer between 1 and {maximum}")
    return value


def _json_copy(value: Any, message: str) -> Any:
    try:
        return json.loads(json.dumps(value, ensure_ascii=True, allow_nan=False))
    except (TypeError, ValueError, OverflowError, RecursionError):
        raise NativeServiceError(message) from None


def _path_key(value: Path | str) -> str:
    if not isinstance(value, (Path, str)) or not str(value) or "\x00" in str(value):
        raise NativeServiceError("Expected a document filesystem path")
    return os.path.normcase(os.path.abspath(value))


class NativeService:
    """Read, preflight, edit, preview and restore through injected collaborators.

    ``complete`` on reads/searches means traversal of the supported blocks is
    finished. A read's ``content_complete`` describes its issued cursor chain,
    not the final fragment alone. Search never returns the whole document.
    A paginated text fragment's target_id addresses its *whole* block, so edits
    must provide the whole block text as expected_old, not only that fragment.
    """

    MAX_CHARS = 64_000
    MAX_BLOCKS_PER_PAGE = 128
    MAX_RESULTS = 500
    MAX_OPERATIONS = 100
    MAX_QUERY_CHARS = 8_000
    MAX_EDIT_CHARS = 100_000
    CONTEXT_CHARS = 80

    def __init__(self, engine: Any, store: Any, *, cursor_limit: int = 512,
                 request_limit: int = 128, request_bytes_limit: int = 1_048_576):
        self.engine = engine
        self.store = store
        self.cursor_limit = _positive(cursor_limit, "cursor_limit", 65_536)
        self.request_limit = _positive(request_limit, "request_limit", 65_536)
        self.request_bytes_limit = _positive(request_bytes_limit, "request_bytes_limit", 67_108_864)
        self._cursors: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._requests: OrderedDict[str, tuple[str, dict[str, Any], int]] = OrderedDict()
        self._request_bytes = 0
        self._lock = threading.RLock()

    def capabilities(self) -> dict[str, Any]:
        try:
            engine = self.engine.capabilities()
        except Exception:
            raise NativeServiceError("Document engine capabilities are unavailable") from None
        if not isinstance(engine, dict):
            raise NativeServiceError("Document engine returned invalid capabilities")
        return {
            "engine": _json_copy(engine, "Document engine returned invalid capabilities"),
            "format": "hwp",
            "read": True, "search": True, "plan": True, "edit": True,
            "preview": True, "restore": True,
            "save_default": "same_file", "save_as": True,
            "layout_verified": False,
            "limits": {"max_chars": self.MAX_CHARS,
                       "max_blocks_per_page": self.MAX_BLOCKS_PER_PAGE,
                       "max_results": self.MAX_RESULTS,
                       "max_operations": self.MAX_OPERATIONS,
                       "max_query_chars": self.MAX_QUERY_CHARS,
                       "max_edit_chars": self.MAX_EDIT_CHARS},
            "cursor": {"issued_only": True, "version_bound": True,
                       "process_local": True, "max_entries": self.cursor_limit,
                       "expiry": "eviction_or_process_restart"},
            "idempotency": {"process_local": True, "persistent": False,
                            "max_entries": self.request_limit,
                            "max_receipt_bytes": self.request_bytes_limit,
                            "expiry": "eviction_or_process_restart",
                            "after_expiry": "ordinary_version_checks_apply"},
        }

    def _snapshot(self, source: Path | str, expected_sha256: str | None) -> Any:
        _path_key(source)
        if expected_sha256 is not None:
            _hash(expected_sha256)
        snapshot = self.store.read(source)
        try:
            valid = (isinstance(snapshot.data, bytes)
                     and _hash(snapshot.sha256) == hashlib.sha256(snapshot.data).hexdigest())
            _path_key(snapshot.path)
        except (AttributeError, NativeServiceError):
            raise NativeServiceError("Document store returned an invalid snapshot") from None
        if not valid:
            raise NativeServiceError("Document store returned an invalid snapshot")
        if expected_sha256 is not None and snapshot.sha256 != expected_sha256:
            raise NativeServiceError("Document version changed; read it again")
        return snapshot

    def _inspect(self, data: bytes) -> dict[str, Any]:
        try:
            result = self.engine.inspect(data)
        except Exception:
            raise NativeServiceError("Document engine inspection failed; no document was saved") from None
        if not isinstance(result, dict):
            raise NativeServiceError("Document engine returned an invalid inspection")
        result = _json_copy(result, "Document engine returned an invalid inspection")
        if (not isinstance(result.get("blocks"), list)
                or not isinstance(result.get("tables"), list)
                or not isinstance(result.get("warnings"), list)
                or not isinstance(result.get("unsupported"), list)
                or any(not isinstance(item, str) for item in result["warnings"])):
            raise NativeServiceError("Document engine returned an invalid inspection")
        ids = set()
        for block in result["blocks"]:
            if (not isinstance(block, dict) or not isinstance(block.get("id"), str)
                    or not block["id"] or len(block["id"]) > 1024
                    or block["id"] in ids or not isinstance(block.get("text"), str)
                    or block.get("kind") not in ("paragraph", "cell")
                    or type(block.get("section")) is not int or block["section"] < 0
                    or type(block.get("paragraph")) is not int or block["paragraph"] < 0
                    or ("editable" in block and type(block["editable"]) is not bool)
                    or ("edit_limit" in block and (type(block["edit_limit"]) is not int
                                                    or block["edit_limit"] < 0))
                    or _UNSUPPORTED_NEW_TEXT.search(block["id"])):
                raise NativeServiceError("Document engine returned invalid block metadata")
            ids.add(block["id"])
            if block["kind"] == "cell":
                for key in _CELL_LOCATION_KEYS:
                    minimum = 1 if key.endswith("_span") else 0
                    if key in block and (type(block[key]) is not int or block[key] < minimum):
                        raise NativeServiceError("Document engine returned invalid cell location metadata")
        return result

    @staticmethod
    def _target_id(sha256: str, raw_id: str) -> str:
        encoded = base64.urlsafe_b64encode(raw_id.encode("utf-8")).decode("ascii").rstrip("=")
        return f"hwp5:{sha256}:{encoded}"

    @staticmethod
    def _raw_id(target_id: str, sha256: str) -> str:
        if not isinstance(target_id, str):
            raise NativeServiceError("Operation target_id must be a versioned identifier")
        parts = target_id.split(":")
        if len(parts) != 3 or parts[0] != "hwp5" or parts[1] != sha256:
            raise NativeServiceError("Operation target does not belong to this document version")
        try:
            encoded = parts[2]
            value = base64.b64decode(encoded + "=" * (-len(encoded) % 4), altchars=b"-_", validate=True).decode("utf-8")
        except (ValueError, UnicodeError, binascii.Error):
            raise NativeServiceError("Operation target_id is invalid") from None
        if not value or NativeService._target_id(sha256, value) != target_id:
            raise NativeServiceError("Operation target_id is invalid")
        return value

    @staticmethod
    def _base(snapshot: Any, inspection: dict[str, Any]) -> dict[str, Any]:
        unsupported = copy.deepcopy(inspection["unsupported"])
        return {
            "source": str(snapshot.path), "source_sha256": snapshot.sha256,
            "scope": "supported_paragraph_and_cell_blocks",
            "supported_blocks": len(inspection["blocks"]),
            "unsupported": unsupported,
            "all_content_supported": not bool(unsupported),
            "content_complete": False,
            "warnings": list(inspection["warnings"]),
            "layout_verified": False,
        }

    def _issue_cursor(self, state: dict[str, Any]) -> str:
        with self._lock:
            token = secrets.token_urlsafe(24)
            while token in self._cursors:
                token = secrets.token_urlsafe(24)
            self._cursors[token] = state.copy()
            while len(self._cursors) > self.cursor_limit:
                self._cursors.popitem(last=False)
            return token

    def _position(self, cursor: str | None, *, kind: str, snapshot: Any,
                  query: str | None = None) -> tuple[int, int]:
        if cursor is None:
            return 0, 0
        if not isinstance(cursor, str):
            raise NativeServiceError("Cursor must be an issued opaque token")
        with self._lock:
            state = self._cursors.get(cursor)
            if state is None:
                raise NativeServiceError("Cursor is unknown or expired; restart the read")
            if (state["kind"] != kind or state["source"] != _path_key(snapshot.path)
                    or state["sha256"] != snapshot.sha256 or state.get("query") != query):
                raise NativeServiceError("Cursor does not match this source, version, or query")
            self._cursors.move_to_end(cursor)
            return state["block"], state["offset"]

    def _next_cursor(self, kind: str, snapshot: Any, block: int, offset: int,
                     query: str | None = None) -> str:
        return self._issue_cursor({"kind": kind, "source": _path_key(snapshot.path),
                                   "sha256": snapshot.sha256, "query": query,
                                   "block": block, "offset": offset})

    def read(self, source: Path | str, expected_sha256: str | None = None,
             cursor: str | None = None, max_chars: int = 8000) -> dict[str, Any]:
        budget = _positive(max_chars, "max_chars", self.MAX_CHARS)
        snapshot = self._snapshot(source, expected_sha256)
        inspection = self._inspect(snapshot.data)
        blocks = inspection["blocks"]
        index, offset = self._position(cursor, kind="read", snapshot=snapshot)
        start_index, start_offset = index, offset
        fragments = []
        while index < len(blocks) and len(fragments) < self.MAX_BLOCKS_PER_PAGE:
            block = blocks[index]
            text = block["text"]
            if text and budget == 0:
                break
            end = min(len(text), offset + budget)
            fragment = {key: copy.deepcopy(value) for key, value in block.items() if key != "text"}
            fragment.update(target_id=self._target_id(snapshot.sha256, block["id"]),
                            text=text[offset:end], start_offset=offset, end_offset=end,
                            total_chars=len(text), fragment_complete=end == len(text))
            fragments.append(fragment)
            budget -= end - offset
            if end < len(text):
                offset = end
                break
            index += 1
            offset = 0
        complete = index == len(blocks)
        result = self._base(snapshot, inspection)
        result.update(blocks=fragments, tables=copy.deepcopy(inspection["tables"]),
                      complete=complete,
                      content_complete=complete and not bool(inspection["unsupported"]),
                      content_complete_scope="issued_cursor_chain_not_this_page_alone",
                      response_scope="supported_text_fragments",
                      page_starts_at={"block_index": start_index, "offset": start_offset},
                      next_cursor=None if complete else self._next_cursor("read", snapshot, index, offset),
                      edit_expected_old_scope="whole_block")
        return result

    def search(self, source: Path | str, expected_sha256: str, query: str,
               cursor: str | None = None, max_results: int = 50) -> dict[str, Any]:
        _hash(expected_sha256)
        limit = _positive(max_results, "max_results", self.MAX_RESULTS)
        if not isinstance(query, str) or not query or len(query) > self.MAX_QUERY_CHARS:
            raise NativeServiceError("query must be a nonempty string within the configured limit")
        snapshot = self._snapshot(source, expected_sha256)
        inspection = self._inspect(snapshot.data)
        blocks = inspection["blocks"]
        index, offset = self._position(cursor, kind="search", snapshot=snapshot, query=query)
        results = []
        while index < len(blocks) and len(results) < limit:
            block = blocks[index]
            text = block["text"]
            found = text.find(query, offset)
            if found == -1:
                index += 1
                offset = 0
                continue
            start = max(0, found - self.CONTEXT_CHARS)
            end = min(len(text), found + len(query) + self.CONTEXT_CHARS)
            location = {"section": block["section"], "paragraph": block["paragraph"]}
            if block["kind"] == "cell":
                location.update({key: block[key] for key in _CELL_LOCATION_KEYS if key in block})
                if "control" in block:
                    location["table_id"] = f's{block["section"]}:p{block["paragraph"]}:t{block["control"]}'
            results.append({"target_id": self._target_id(snapshot.sha256, block["id"]),
                            "id": block["id"], "kind": block["kind"],
                            "section": block["section"], "paragraph": block["paragraph"],
                            "location": location,
                            "location_complete": block["kind"] != "cell" or all(key in block for key in _CELL_LOCATION_KEYS),
                            "match_start": found, "match_end": found + len(query),
                            "context_start": start, "context_end": end,
                            "total_chars": len(text), "context": text[start:end]})
            # A one-character advance includes overlapping occurrences.
            offset = found + 1
        # Do not return a useless final cursor merely because the last hit filled
        # the page. Locate the next match without consuming it.
        while index < len(blocks):
            found = blocks[index]["text"].find(query, offset)
            if found != -1:
                offset = found
                break
            index += 1
            offset = 0
        complete = index == len(blocks)
        result = self._base(snapshot, inspection)
        result.update(query=query, results=results, complete=complete,
                      content_complete=False, response_scope="search_matches",
                      location_index_base=0, text_offset_unit="unicode_code_points",
                      edit_expected_old_scope="whole_block",
                      complete_scope="search_traversal_of_issued_cursor_chain",
                      next_cursor=None if complete else self._next_cursor("search", snapshot, index, offset, query))
        return result

    def _operations(self, operations: Any, sha256: str) -> list[dict[str, str]]:
        if not isinstance(operations, list) or not operations or len(operations) > self.MAX_OPERATIONS:
            raise NativeServiceError("operations must be a nonempty list within the configured limit")
        validated = []
        targets = set()
        for operation in operations:
            if (not isinstance(operation, dict) or set(operation) != _OPERATION_KEYS
                    or any(not isinstance(operation[key], str) for key in _OPERATION_KEYS)):
                raise NativeServiceError("Each operation requires only target_id, expected_old, and new_text strings")
            raw_id = self._raw_id(operation["target_id"], sha256)
            if raw_id in targets:
                raise NativeServiceError("Duplicate operation targets are not allowed")
            targets.add(raw_id)
            validated.append({"target_id": raw_id, "expected_old": operation["expected_old"],
                              "new_text": operation["new_text"]})
        return validated

    def _preflight(self, inspection: dict[str, Any], operations: list[dict[str, str]]) -> list[dict[str, Any]]:
        if inspection["unsupported"]:
            raise NativeServiceError("Editing is refused because unsupported content cannot be safely verified")
        blocks = {block["id"]: block for block in inspection["blocks"]}
        changes = []
        for operation in operations:
            block = blocks.get(operation["target_id"])
            if block is None:
                raise NativeServiceError("An operation target is not present in this document version")
            if block.get("editable") is False:
                raise NativeServiceError("An operation target is outside the supported editing profile")
            if block["text"] != operation["expected_old"]:
                raise NativeServiceError("Operation expected_old does not match the whole target block")
            limit = min(block.get("edit_limit", self.MAX_EDIT_CHARS), self.MAX_EDIT_CHARS)
            if len(operation["new_text"]) > limit:
                raise NativeServiceError("Replacement text exceeds the supported target editing limit")
            if _UNSUPPORTED_NEW_TEXT.search(operation["new_text"]):
                raise NativeServiceError("Inserted line breaks or control characters are outside the supported editing profile")
            style = block.get("style", {})
            shapes = style.get("char_shape_ids") if isinstance(style, dict) else None
            if not operation["new_text"] and isinstance(shapes, list) and shapes and shapes[0] != 0:
                raise NativeServiceError("Empty replacement cannot safely preserve this target character style")
            changes.append({"raw_id": block["id"], "before_chars": len(block["text"]),
                            "after_chars": len(operation["new_text"]),
                            "changed": block["text"] != operation["new_text"]})
        return changes

    @staticmethod
    def _summaries(changes: list[dict[str, Any]], sha256: str) -> list[dict[str, Any]]:
        return [{"target_id": NativeService._target_id(sha256, item["raw_id"]),
                 **{key: value for key, value in item.items() if key != "raw_id"}}
                for item in changes]

    def plan(self, source: Path | str, expected_sha256: str,
             operations: list[dict[str, Any]]) -> dict[str, Any]:
        _hash(expected_sha256)
        validated = self._operations(operations, expected_sha256)
        snapshot = self._snapshot(source, expected_sha256)
        inspection = self._inspect(snapshot.data)
        changes = self._preflight(inspection, validated)
        result = self._base(snapshot, inspection)
        result.update(valid=True, write_performed=False, change_count=len(changes),
                      changes=self._summaries(changes, snapshot.sha256),
                      response_scope="edit_preflight_not_document_text",
                      save_default="same_file")
        return result

    @staticmethod
    def _verify(before: dict[str, Any], after: dict[str, Any], operations: list[dict[str, str]]) -> None:
        if (after["unsupported"] or before["tables"] != after["tables"]
                or len(before["blocks"]) != len(after["blocks"])):
            raise NativeServiceError("Edited document structure could not be preserved; no document was saved")
        targets = {operation["target_id"]: operation["new_text"] for operation in operations}
        for original, updated in zip(before["blocks"], after["blocks"]):
            old_metadata = {key: value for key, value in original.items() if key != "text"}
            new_metadata = {key: value for key, value in updated.items() if key != "text"}
            if old_metadata != new_metadata:
                raise NativeServiceError("Edited document block structure changed; no document was saved")
            expected = targets.get(original["id"], original["text"])
            if updated["text"] != expected:
                raise NativeServiceError("Edited document content verification failed; no document was saved")

    @staticmethod
    def _receipt(receipt: Any, warnings: list[str] | None = None) -> dict[str, Any]:
        try:
            version = _hash(receipt.sha256)
            if receipt.mode not in ("save", "save_as"):
                raise NativeServiceError("Document store returned an invalid save receipt")
            if receipt.backup_id is not None and not isinstance(receipt.backup_id, str):
                raise NativeServiceError("Document store returned an invalid save receipt")
            durability = receipt.durability_warnings
            if (not isinstance(durability, (tuple, list))
                    or any(not isinstance(item, str) for item in durability)):
                raise NativeServiceError("Document store returned invalid durability warnings")
            path = str(receipt.path)
        except AttributeError:
            raise NativeServiceError("Document store returned an invalid save receipt") from None
        return {"path": path, "sha256": version, "mode": receipt.mode,
                "backup_id": receipt.backup_id,
                "warnings": list(dict.fromkeys([*(warnings or []), *durability])),
                "layout_verified": False}

    def _fingerprint(self, source: Path | str, expected_sha256: str,
                     operations: list[dict[str, Any]], output: Path | str | None,
                     expected_destination_sha256: str | None) -> str:
        request = {"source": _path_key(source), "sha256": expected_sha256,
                   "operations": operations,
                   "output": None if output is None else _path_key(output),
                   "destination_sha256": expected_destination_sha256}
        return hashlib.sha256(json.dumps(request, sort_keys=True, ensure_ascii=True,
                                         separators=(",", ":")).encode("utf-8")).hexdigest()

    def _remember(self, request_id: str, fingerprint: str, result: dict[str, Any]) -> None:
        payload = _json_copy(result, "Document service generated an invalid receipt")
        payload["idempotency_retained"] = True
        size = len(json.dumps(payload, ensure_ascii=True).encode("utf-8"))
        # An oversized receipt is not retained. The response openly reports this
        # rather than implying durable or unlimited exactly-once semantics.
        retained = size <= self.request_bytes_limit
        result["idempotency_retained"] = retained
        if not retained:
            return
        self._requests[request_id] = (fingerprint, payload, size)
        self._request_bytes += size
        while len(self._requests) > self.request_limit or self._request_bytes > self.request_bytes_limit:
            _, (_, _, removed_size) = self._requests.popitem(last=False)
            self._request_bytes -= removed_size

    def edit(self, source: Path | str, expected_sha256: str,
             operations: list[dict[str, Any]], request_id: str,
             output: Path | str | None = None,
             expected_destination_sha256: str | None = None) -> dict[str, Any]:
        _hash(expected_sha256)
        validated = self._operations(operations, expected_sha256)
        if not isinstance(request_id, str) or not request_id or len(request_id) > 256:
            raise NativeServiceError("request_id must be a nonempty string of at most 256 characters")
        if expected_destination_sha256 is not None:
            _hash(expected_destination_sha256)
        fingerprint = self._fingerprint(source, expected_sha256, validated, output, expected_destination_sha256)
        # Serialize edits and consult receipts *before* source version checks:
        # a successful same-file edit has already changed the requested version.
        with self._lock:
            previous = self._requests.get(request_id)
            if previous is not None:
                if previous[0] != fingerprint:
                    raise NativeServiceError("request_id was already used with different inputs")
                self._requests.move_to_end(request_id)
                return copy.deepcopy(previous[1])
            snapshot = self._snapshot(source, expected_sha256)
            before = self._inspect(snapshot.data)
            changes = self._preflight(before, validated)
            try:
                edited = self.engine.edit(snapshot.data, copy.deepcopy(validated))
            except Exception:
                raise NativeServiceError("Document engine edit failed; no document was saved") from None
            if not isinstance(edited, bytes):
                raise NativeServiceError("Document engine returned invalid edited bytes; no document was saved")
            after = self._inspect(edited)
            self._verify(before, after, validated)
            receipt = self.store.save(snapshot, edited, output=output,
                                      expected_destination_sha256=expected_destination_sha256)
            result = self._receipt(receipt, [*before["warnings"], *after["warnings"]])
            if result["sha256"] != hashlib.sha256(edited).hexdigest():
                raise NativeServiceError("Save receipt does not match the verified output; inspect the destination before retrying")
            result.update(source=str(snapshot.path), previous_sha256=snapshot.sha256,
                          change_count=len(changes), changes=self._summaries(changes, snapshot.sha256),
                          content_verified=True, structure_verified=True,
                          request_id=request_id, idempotency_scope="bounded_process_local")
            self._remember(request_id, fingerprint, result)
            return result

    def preview(self, source: Path | str, expected_sha256: str,
                page: int = 0) -> dict[str, Any]:
        _hash(expected_sha256)
        if type(page) is not int or page < 0:
            raise NativeServiceError("page must be a nonnegative integer")
        snapshot = self._snapshot(source, expected_sha256)
        try:
            result = self.engine.preview(snapshot.data, page)
        except Exception:
            raise NativeServiceError("Document engine preview failed; no document was saved") from None
        if not isinstance(result, dict):
            raise NativeServiceError("Document engine returned an invalid preview")
        result = _json_copy(result, "Document engine returned an invalid preview")
        if (not isinstance(result.get("svg"), str) or type(result.get("page")) is not int
                or result["page"] != page or type(result.get("page_count")) is not int
                or not 0 <= page < result["page_count"]
                or not isinstance(result.get("warnings"), list)
                or any(not isinstance(item, str) for item in result["warnings"])):
            raise NativeServiceError("Document engine returned an invalid preview")
        result.update(source=str(snapshot.path), source_sha256=snapshot.sha256,
                      layout_verified=False)
        return result

    def restore(self, source: Path | str, backup_id: str,
                expected_sha256: str) -> dict[str, Any]:
        _path_key(source)
        _hash(expected_sha256)
        if not isinstance(backup_id, str) or not backup_id:
            raise NativeServiceError("backup_id must be a nonempty opaque identifier")
        with self._lock:
            receipt = self.store.restore(source, backup_id, expected_sha256)
            result = self._receipt(receipt)
            result.update(source=str(source), previous_sha256=expected_sha256,
                          restored_from_backup_id=backup_id,
                          content_verified=False, structure_verified=False)
            return result
