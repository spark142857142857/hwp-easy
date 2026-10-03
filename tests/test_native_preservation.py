"""Raw-body-record preservation regressions using synthetic bytes only.

The envelope/guard unit tests replace CFB access, not the document engine. Opt-in
integration tests generate genuine HWP with the pinned WASM runtime, append a
record using olefile's in-memory write_stream, and never open a personal file.
Passing these tests does not certify all named HWP records or visual fidelity.
"""
from __future__ import annotations

import base64
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import types
import unittest
from unittest import mock
import zlib

from one_hwp.native_engine import EngineError, RhwpEngine, UnsupportedDocumentError
from one_hwp.native_service import NativeService, NativeServiceError
from one_hwp.native_storage import Snapshot


ROOT = Path(__file__).resolve().parents[1]
REAL_ENGINE = os.environ.get("HWP_EASY_NATIVE_TESTS") == "1"


def record(tag, payload=b"", *, level=0, extended=False):
    size = len(payload)
    if extended or size >= 0xfff:
        return struct.pack("<II", tag | (level << 10) | (0xfff << 20), size) + payload
    return struct.pack("<I", tag | (level << 10) | (size << 20)) + payload


def deflate(data, level=9):
    codec = zlib.compressobj(level, zlib.DEFLATED, -15)
    return codec.compress(data) + codec.flush()


class BoundedInflateTests(unittest.TestCase):
    """Standard-library generated streams, not user document fixtures."""

    def test_exact_crc32_and_size_trailer_with_empty_and_multichunk_output(self):
        for raw in (b"", b"123456789", "한글 😀".encode() * 10_000):
            # Fixed gzip header removed; independent gzip writer supplies CRC/size.
            packed = gzip.compress(raw, mtime=0)[10:]
            with self.subTest(size=len(raw)):
                self.assertEqual(RhwpEngine._inflate(packed, True, len(raw)), raw)
                self.assertEqual(RhwpEngine._inflate(packed, True, len(raw),
                                                   allow_zero_padding=False), raw)
        self.assertEqual(struct.unpack("<I", gzip.compress(b"123456789", mtime=0)[-8:-4])[0],
                         0xcbf43926)

    def test_crc_size_byte_order_and_extra_data_are_checked(self):
        raw = b"SYNTHETIC_TRAILER_PAYLOAD"
        packed = gzip.compress(raw, mtime=0)[10:]
        crc, size = struct.unpack("<II", packed[-8:])
        tails = (struct.pack("<II", crc ^ 1, size), struct.pack("<II", crc, size + 1),
                 struct.pack(">II", crc, size), packed[-8:-1], packed[-8:] + b"\0",
                 packed[-8:] + deflate(b"second member"))
        for tail in tails:
            with self.subTest(length=len(tail)), self.assertRaisesRegex(UnsupportedDocumentError, "stream tail"):
                RhwpEngine._inflate(packed[:-8] + tail, True, len(raw))

    def test_limit_and_end_marker_are_not_bypassed_by_a_valid_trailer(self):
        raw = b"a" * 1000
        packed = gzip.compress(raw, mtime=0)[10:]
        with self.assertRaises(UnsupportedDocumentError):
            RhwpEngine._inflate(packed, True, len(raw) - 1)
        for truncated in (packed[:1], packed[:-9]):
            with self.subTest(length=len(truncated)), self.assertRaises(UnsupportedDocumentError):
                RhwpEngine._inflate(truncated, True, len(raw))

    def test_old_body_padding_and_strict_docinfo_padding_remain_distinct(self):
        raw = b"synthetic"
        packed = deflate(raw)
        self.assertEqual(RhwpEngine._inflate(packed + b"\0" * 16, True, len(raw)), raw)
        with self.assertRaises(UnsupportedDocumentError):
            RhwpEngine._inflate(packed + b"\0" * 16, True, len(raw), allow_zero_padding=False)
        with self.assertRaises(UnsupportedDocumentError):
            RhwpEngine._inflate(packed + deflate(b"other"), True, len(raw))

    def test_docinfo_checks_trailer_before_canonicalizing_caret(self):
        raw = record(16, b"\0" * 26)
        packed = gzip.compress(raw, mtime=0)[10:]
        self.assertEqual(RhwpEngine._docinfo_content(packed, True), raw)
        changed = packed[:-8] + bytes([packed[-8] ^ 1]) + packed[-7:]
        with self.assertRaises(EngineError):
            RhwpEngine._docinfo_content(changed, True)

    def test_invalid_deflate_is_a_fixed_safe_adapter_error(self):
        with self.assertRaisesRegex(UnsupportedDocumentError, "^Invalid HWP compressed stream$"):
            RhwpEngine._inflate(b"\x07", True, 100)


class _EnvelopeContainer:
    """CFB stand-in only for independent envelope-parser unit tests."""

    def __init__(self, streams):
        self.streams = streams

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def listdir(self):
        return [list(name) for name in self.streams if name[0] == "BodyText"]

    def openstream(self, name):
        key = tuple(name.split("/")) if isinstance(name, str) else tuple(name)
        return io.BytesIO(self.streams[key])


def body_profile(sections, *, compressed=False):
    """Exercise the raw scanner without requiring the optional olefile package."""
    header = bytearray(256)
    struct.pack_into("<I", header, 36, int(compressed))
    streams = {("FileHeader",): bytes(header), **sections}
    module = types.SimpleNamespace(OleFileIO=lambda _: _EnvelopeContainer(streams))
    with mock.patch.dict("sys.modules", {"olefile": module}):
        return RhwpEngine._body_profile(b"synthetic-CFB-stand-in")


class BodyProfileUnitTests(unittest.TestCase):
    def test_unknown_record_is_disclosed_without_copying_opaque_payload(self):
        private = b"SYNTHETIC_OPAQUE_PAYLOAD_NOT_FOR_A_RESPONSE"
        body = record(66, b"header") + record(1000, private, level=1)
        result = body_profile({("BodyText", "Section0"): body})
        self.assertEqual(result["paragraph_records"], 1)
        self.assertEqual(len(result["unsupported"]), 1)
        unknown = result["unsupported"][0]
        self.assertEqual((unknown["kind"], unknown["section"], unknown["record_tag"], unknown["record_level"]),
                         ("body_record", 0, 1000, 1))
        self.assertNotIn(private.decode(), json.dumps(result))

    def test_known_envelopes_and_extended_sizes_are_scanned(self):
        body = record(66, b"header", extended=True) + record(67, b"text", level=1)
        result = body_profile({("BodyText", "Section0"): body})
        self.assertEqual(result, {"unsupported": [], "paragraph_records": 1})

    def test_section_and_paragraph_counts_include_all_body_streams(self):
        result = body_profile({("BodyText", "Section1"): record(66, b"two"),
                               ("BodyText", "Section0"): record(66, b"one") + record(66, b"three")})
        self.assertEqual(result["paragraph_records"], 3)
        self.assertEqual(result["unsupported"], [])

    def test_unknown_known_hwp_tag_outside_the_current_subset_is_not_whitelisted(self):
        # PARA_RANGE_TAG is a valid named HWP tag, but not part of this verified
        # subset. Do not confuse valid-format recognition with edit support.
        self.assertNotIn(70, RhwpEngine.BODY_TAGS)
        result = body_profile({("BodyText", "Section0"): record(70, b"opaque", level=1)})
        self.assertEqual(result["unsupported"][0]["record_tag"], 70)

    def test_truncated_envelopes_and_oversized_payloads_are_refused(self):
        cases = [b"\x01", struct.pack("<I", 66 | (0xfff << 20)),
                 struct.pack("<II", 66 | (0xfff << 20), 100),
                 struct.pack("<I", 66 | (10 << 20)) + b"short"]
        for body in cases:
            with self.subTest(length=len(body)), self.assertRaises(UnsupportedDocumentError):
                body_profile({("BodyText", "Section0"): body})

    def test_invalid_section_names_and_sequence_are_refused(self):
        cases = [{("BodyText", "Section2"): record(66)},
                 {("BodyText", "Section0"): record(66), ("BodyText", "Section2"): record(66)},
                 {("BodyText", "Extension"): record(66)},
                 {("BodyText", "Section0", "Unexpected"): record(66)}]
        for sections in cases:
            with self.subTest(names=list(sections)), self.assertRaises(UnsupportedDocumentError):
                body_profile(sections)

    def test_compressed_envelopes_and_zero_tail_padding(self):
        raw = record(66, b"header") + record(1000, b"opaque", level=1)
        result = body_profile({("BodyText", "Section0"): deflate(raw) + b"\x00" * 4}, compressed=True)
        self.assertEqual(result["paragraph_records"], 1)
        self.assertEqual(result["unsupported"][0]["record_tag"], 1000)

    def test_expansion_limit_is_aggregate_across_sections(self):
        raw = record(66, b"0" * 12)
        sections = {("BodyText", "Section0"): deflate(raw), ("BodyText", "Section1"): deflate(raw)}
        with mock.patch.object(RhwpEngine, "MAX_EXPANDED_BYTES", 24):
            with self.assertRaises(UnsupportedDocumentError):
                body_profile(sections, compressed=True)

    def test_bomb_truncated_deflate_and_nonzero_tail_are_refused(self):
        raw = record(66, b"x" * 1000)
        cases = [deflate(raw), deflate(raw)[:-1], deflate(record(66)) + b"nonzero-tail"]
        for packed in cases:
            with self.subTest(length=len(packed)), mock.patch.object(RhwpEngine, "MAX_EXPANDED_BYTES", 100):
                with self.assertRaises(UnsupportedDocumentError):
                    body_profile({("BodyText", "Section0"): packed}, compressed=True)

    def test_unknown_record_count_is_bounded(self):
        with self.assertRaisesRegex(UnsupportedDocumentError, "Too many unsupported"):
            body_profile({("BodyText", "Section0"): record(1000) * 1025})

    def test_total_record_count_is_bounded(self):
        with self.assertRaisesRegex(UnsupportedDocumentError, "record count"):
            body_profile({("BodyText", "Section0"): record(71) * 1_000_001})

    def test_edit_action_unknown_profile_is_refused_before_subprocess(self):
        engine = RhwpEngine(node="not-started")
        profile = {"paragraph_records": 1, "unsupported": [{"kind": "body_record", "record_tag": 1000}]}
        with mock.patch.object(engine, "_validate"), mock.patch.object(engine, "_body_profile", return_value=profile):
            with mock.patch("one_hwp.native_engine.subprocess.run") as run:
                with self.assertRaises(UnsupportedDocumentError):
                    engine._call("edit", b"synthetic", operations=[
                        {"target_id": "s0:p0", "expected_old": "old", "new_text": "new"}])
                run.assert_not_called()

    def test_read_merges_raw_record_coverage_with_upstream_unsupported(self):
        engine = RhwpEngine(node="not-started")
        profile = {"paragraph_records": 1, "unsupported": [{"kind": "body_record", "record_tag": 1000}]}
        response = {"ok": True, "result": {"blocks": [{"id": "s0:p0"}],
                                               "unsupported": [{"kind": "control"}]}}
        process = subprocess.CompletedProcess([], 0, json.dumps(response), "")
        with mock.patch.object(engine, "_validate"), mock.patch.object(engine, "_body_profile", return_value=profile):
            with mock.patch("one_hwp.native_engine.subprocess.run", return_value=process):
                result = engine.inspect(b"synthetic")
        self.assertEqual([item["kind"] for item in result["unsupported"]], ["control", "body_record"])

    def test_missing_paragraph_view_is_explicitly_unsupported(self):
        engine = RhwpEngine(node="not-started")
        profile = {"paragraph_records": 2, "unsupported": []}
        response = {"ok": True, "result": {"blocks": [{"id": "s0:p0"}], "unsupported": []}}
        process = subprocess.CompletedProcess([], 0, json.dumps(response), "")
        with mock.patch.object(engine, "_validate"), mock.patch.object(engine, "_body_profile", return_value=profile):
            with mock.patch("one_hwp.native_engine.subprocess.run", return_value=process):
                result = engine.inspect(b"synthetic")
        self.assertEqual(result["unsupported"][0]["kind"], "paragraph_coverage_mismatch")


def paragraph_payload(text, *, last=False, tail=b""):
    payload = bytearray(24)
    count = len(text.encode("utf-16-le")) // 2 + 1
    struct.pack_into("<I", payload, 0, count | (0x80000000 if last else 0))
    struct.pack_into("<H", payload, 12, 1)  # Character-shape runs.
    struct.pack_into("<H", payload, 16, 1)  # Regenerated line segments.
    return bytes(payload) + tail


def paragraph_records(text, *, last=False, level=0, controls=b"", tail=b""):
    return [(66, level, paragraph_payload(text, last=last, tail=tail)),
            (67, level + 1, text.encode("utf-16-le") + controls + b"\r\x00"),
            (68, level + 1, struct.pack("<II", 0, 0)),
            (69, level + 1, b"\x00" * 36)]


def encode_records(records):
    return b"".join(record(tag, payload, level=level) for tag, level, payload in records)


class _VerificationContainer(_EnvelopeContainer):
    """CFB I/O stand-in; verification code itself is real, not mocked."""

    def listdir(self):
        return [list(name) for name in self.streams]


def verify_body_records(before, after, *, blocks=None, operations=None):
    """Compare independently supplied synthetic raw records via the full guard.

    This proves the preservation guard's acceptance/rejection logic, not that
    these stub CFB containers or the arbitrary opaque payloads are genuine HWP.
    """
    header = bytes(256)
    docinfo = record(16, b"\x00" * 26)
    common = {("FileHeader",): header, ("DocInfo",): docinfo}
    streams = {
        b"before": {**common, ("BodyText", "Section0"): encode_records(before)},
        b"after": {**common, ("BodyText", "Section0"): encode_records(after)},
    }
    module = types.SimpleNamespace(OleFileIO=lambda data: _VerificationContainer(streams[data.getvalue()]))
    if blocks is None:
        blocks = [{"id": "s0:p0", "section": 0}, {"id": "s0:p1", "section": 0}]
    if operations is None:
        operations = [{"target_id": "s0:p0", "expected_old": "before", "new_text": "after"}]
    with mock.patch.dict("sys.modules", {"olefile": module}):
        return RhwpEngine._verify_stream_preservation(b"before", b"after", blocks, operations)


class KnownRecordPreservationUnitTests(unittest.TestCase):
    def setUp(self):
        self.before = paragraph_records("before") + paragraph_records("untargeted", last=True, tail=b"OPAQUE-HEADER-TAIL")
        self.after = paragraph_records("after 😀") + paragraph_records("untargeted", last=True, tail=b"OPAQUE-HEADER-TAIL")

    def test_legitimate_target_text_replacement_is_allowed(self):
        self.assertIsNone(verify_body_records(self.before, self.after))
        # A uniform run may move or collapse; its shape identity must survive.
        before = list(self.before)
        before[2] = (68, 1, struct.pack("<IIII", 0, 0, 99, 0))
        self.assertIsNone(verify_body_records(before, self.after))
        for shape_ids in ((1,), (0, 1)):
            changed = list(self.after)
            changed[2] = (68, 1, b"".join(struct.pack("<II", index, value)
                                         for index, value in enumerate(shape_ids)))
            with self.subTest(shape_ids=shape_ids), self.assertRaises(EngineError):
                verify_body_records(self.before, changed)
        before[2] = (68, 1, struct.pack("<IIII", 0, 0, 99, 1))
        with self.assertRaises(EngineError):
            verify_body_records(before, self.after)

    def test_untargeted_header_tail_change_and_loss_are_rejected(self):
        index = 4
        for payload in (self.after[index][2][:-1], self.after[index][2][:-1] + b"X"):
            output = list(self.after)
            output[index] = (66, 0, payload)
            with self.subTest(length=len(payload)), self.assertRaises(EngineError):
                verify_body_records(self.before, output)

    def test_untargeted_text_shape_reference_and_known_opaque_tail_changes_rejected(self):
        for tag in (67, 68, 73, 74, 75):
            extra = (tag, 1, b"KNOWN-OPAQUE-TAIL")
            before = self.before + [extra]
            after = self.after + [(tag, 1, b"KNOWN-OPAQUE-FAIL")]
            with self.subTest(tag=tag), self.assertRaises(EngineError):
                verify_body_records(before, after)

    def test_untargeted_record_removal_and_level_change_are_rejected(self):
        for index in (4, 5, 6, 7):
            output = self.after[:index] + self.after[index + 1:]
            with self.subTest(index=index), self.assertRaises(EngineError):
                verify_body_records(self.before, output)
        output = list(self.after)
        tag, level, payload = output[5]
        output[5] = (tag, level + 1, payload)
        with self.assertRaises(EngineError):
            verify_body_records(self.before, output)

    def test_table_cell_and_list_header_payload_changes_and_loss_are_rejected(self):
        host = paragraph_records("table host")
        table_headers = [(71, 1, b"TABLE-CONTROL-HEADER-TAIL"),
                         (77, 2, b"TABLE-PROPERTIES-TAIL"),
                         (72, 2, b"CELL-LIST-HEADER-TAIL")]
        before = host + table_headers + paragraph_records("before", level=2) + paragraph_records("untargeted", last=True)
        after = host + table_headers + paragraph_records("after", level=2) + paragraph_records("untargeted", last=True)
        blocks = [{"id": "s0:p0", "section": 0},
                  {"id": "s0:p0:t0:c0:p0", "section": 0},
                  {"id": "s0:p1", "section": 0}]
        operations = [{"target_id": "s0:p0:t0:c0:p0", "expected_old": "before", "new_text": "after"}]
        self.assertIsNone(verify_body_records(before, after, blocks=blocks, operations=operations))
        for index in (4, 5, 6):
            tag, level, payload = after[index]
            cases = [after[:index] + after[index + 1:],
                     after[:index] + [(tag, level, payload[:-1])] + after[index + 1:],
                     after[:index] + [(tag, level, payload[:-1] + b"X")] + after[index + 1:]]
            for output in cases:
                with self.subTest(tag=tag, records=len(output)), self.assertRaises(EngineError):
                    verify_body_records(before, output, blocks=blocks, operations=operations)

    def test_binary_inline_slot_deletion_or_payload_change_is_rejected(self):
        tab = struct.pack("<H", 9) + b"\x22" * 12 + struct.pack("<H", 9)
        before = paragraph_records("before", controls=tab) + self.before[4:]
        kept = paragraph_records("after", controls=tab) + self.after[4:]
        self.assertIsNone(verify_body_records(before, kept))
        removed = paragraph_records("after") + self.after[4:]
        changed = paragraph_records("after", controls=tab[:2] + b"X" + tab[3:]) + self.after[4:]
        for output in (removed, changed):
            with self.assertRaises(EngineError):
                verify_body_records(before, output)

    def test_single_unit_binary_control_deletion_is_rejected(self):
        for code in (0, 10, 24, 28, 31):
            before = paragraph_records("before", controls=struct.pack("<H", code)) + self.before[4:]
            after = paragraph_records("after") + self.after[4:]
            with self.subTest(code=code), self.assertRaises(EngineError):
                verify_body_records(before, after)

    def test_untargeted_text_count_is_not_a_target_derived_field(self):
        output = list(self.after)
        changed = bytearray(output[4][2])
        struct.pack_into("<I", changed, 0, struct.unpack_from("<I", changed)[0] + 1)
        output[4] = (66, 0, bytes(changed))
        with self.assertRaises(EngineError):
            verify_body_records(self.before, output)

    def test_paragraph_end_of_list_flag_is_not_a_derived_text_count(self):
        for index in (0, 4):
            output = list(self.after)
            changed = bytearray(output[index][2])
            struct.pack_into("<I", changed, 0, struct.unpack_from("<I", changed)[0] ^ 0x80000000)
            output[index] = (66, 0, bytes(changed))
            with self.subTest(target=index == 0), self.assertRaises(EngineError):
                verify_body_records(self.before, output)

    def test_truncated_text_slots_shape_tails_and_line_tails_are_rejected(self):
        broken = [(67, 1, b"a"), (67, 1, struct.pack("<H", 9)),
                  (68, 1, b"x" * 9), (69, 1, b"x" * 37)]
        for replacement in broken:
            index = {67: 1, 68: 2, 69: 3}[replacement[0]]
            output = list(self.after)
            output[index] = replacement
            with self.subTest(tag=replacement[0], length=len(replacement[2])), self.assertRaises(EngineError):
                verify_body_records(self.before, output)


def real_fixture():
    script = (
        'import {fixture} from "./tests/rhwp_fixtures.mjs";'
        'process.stdout.write(fixture({table:false}).toString("base64"));'
    )
    process = subprocess.run([shutil.which("node"), "--input-type=module", "-e", script],
                             text=True, encoding="utf-8", capture_output=True,
                             cwd=ROOT, timeout=30, check=True)
    return base64.b64decode(process.stdout, validate=True)


def append_unknown_in_memory(data):
    """Keep all known records and the CFB stream length; append an opaque tag."""
    import olefile
    stream = io.BytesIO(data)
    with olefile.OleFileIO(stream, write_mode=True) as container:
        header = container.openstream("FileHeader").read()
        if not struct.unpack_from("<I", header, 36)[0] & 1:
            raise AssertionError("Synthetic regression fixture must use raw-deflate body streams")
        original = container.openstream("BodyText/Section0").read()
        body = zlib.decompress(original, -15)
        body += record(1000, b"\x11" * 16, level=1)
        compressed = min((deflate(body, level) for level in range(1, 10)), key=len)
        if len(compressed) > len(original):
            raise AssertionError("Regression fixture compression no longer fits its existing CFB stream")
        container.write_stream("BodyText/Section0", compressed + b"\x00" * (len(original) - len(compressed)))
    return stream.getvalue()


class _MemoryStore:
    def __init__(self, data):
        self.data = data
        self.source = ROOT / "never-written-synthetic.hwp"
        self.save = mock.Mock(side_effect=AssertionError("Unsupported bytes must not be saved"))

    def read(self, source):
        if Path(source) != self.source:
            raise AssertionError("Unexpected synthetic source")
        return Snapshot(self.source, self.data, hashlib.sha256(self.data).hexdigest())


@unittest.skipUnless(REAL_ENGINE, "set HWP_EASY_NATIVE_TESTS=1 for real pinned WASM regression")
@unittest.skipUnless(importlib.util.find_spec("olefile"), "optional native olefile dependency not installed")
class UnknownRecordRealRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original = real_fixture()
        cls.mutated = append_unknown_in_memory(cls.original)
        cls.engine = RhwpEngine()

    def test_genuine_cfb_unknown_append_does_not_change_known_content(self):
        original = self.engine.inspect(self.original)
        mutated = self.engine.inspect(self.mutated)
        self.assertEqual(original["blocks"], mutated["blocks"])
        self.assertEqual(original["tables"], mutated["tables"])
        self.assertEqual(original["warnings"], mutated["warnings"])
        self.assertEqual(original["unsupported"], [])
        unknown = [item for item in mutated["unsupported"] if item.get("record_tag") == 1000]
        self.assertEqual(len(unknown), 1)
        self.assertEqual(unknown[0]["kind"], "body_record")

    def test_raw_append_detected_independently_before_node(self):
        profile = self.engine._body_profile(self.mutated)
        self.assertEqual(profile["paragraph_records"], 3)
        self.assertEqual(profile["unsupported"][0]["record_tag"], 1000)
        with mock.patch("one_hwp.native_engine.subprocess.run") as run:
            with self.assertRaises(UnsupportedDocumentError):
                self.engine._call("edit", self.mutated, operations=[
                    {"target_id": "s0:p1", "expected_old": "중간 합성 문단", "new_text": "synthetic replacement"}])
            run.assert_not_called()

    def test_public_edit_refuses_unknown_before_editing_action(self):
        # Public edit may perform a read-only inspect for its independent saved
        # record comparison. It must never invoke the mutation/export action.
        real_run = subprocess.run
        with mock.patch("one_hwp.native_engine.subprocess.run", wraps=real_run) as run:
            with self.assertRaises(UnsupportedDocumentError):
                self.engine.edit(self.mutated, [{"target_id": "s0:p1", "expected_old": "중간 합성 문단",
                                                "new_text": "synthetic replacement"}])
        actions = [json.loads(call.kwargs["input"])["action"] for call in run.call_args_list]
        self.assertNotIn("edit", actions)
        self.assertTrue(all(action == "inspect" for action in actions))

    def test_service_read_discloses_partial_coverage_and_plan_edit_never_save(self):
        store = _MemoryStore(self.mutated)
        service = NativeService(self.engine, store)
        result = service.read(store.source)
        self.assertTrue(result["complete"])
        self.assertFalse(result["content_complete"])
        self.assertFalse(result["all_content_supported"])
        self.assertEqual(result["unsupported"][0]["record_tag"], 1000)
        block = next(item for item in result["blocks"] if item["id"] == "s0:p1")
        operations = [{"target_id": block["target_id"], "expected_old": block["text"],
                       "new_text": "synthetic replacement"}]
        with self.assertRaises(NativeServiceError):
            service.plan(store.source, result["source_sha256"], operations)
        with self.assertRaises(NativeServiceError):
            service.edit(store.source, result["source_sha256"], operations, "unknown-regression")
        store.save.assert_not_called()
        self.assertEqual(store.data, self.mutated)


if __name__ == "__main__":
    unittest.main()
