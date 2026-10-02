"""Guarded service invariants with synthetic containers, never real Hancom.

CFB+JSON is a deliberately opaque fake native format, not a valid HWP document.
The fake engine isolates orchestration and failure handling from COM fidelity.
"""
from __future__ import annotations

import builtins
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock
from xml.etree import ElementTree
import zipfile

from one_hwp import service as implementation
from one_hwp.service import CFB, HwpError, HwpService, MAX_TEXT, digest, validate_artifact


def normalize_field(value):
    return value.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\r\n")


WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def docx_fixture_xml(data):
    """Real visible paragraph/run/table XML for the independent XML check."""
    ElementTree.register_namespace("w", WORD_NS)
    tag = lambda name: "{" + WORD_NS + "}" + name
    document = ElementTree.Element(tag("document"))
    body = ElementTree.SubElement(document, tag("body"))

    def paragraph(parent, value):
        node = ElementTree.SubElement(parent, tag("p"))
        # Split runs deliberately: text verification must concatenate them,
        # rather than inserting or dropping word boundaries at each run.
        for part in (value[:len(value) // 2], value[len(value) // 2:]):
            run = ElementTree.SubElement(node, tag("r"))
            pieces = part.split("\t")
            for index, piece in enumerate(pieces):
                if index:
                    ElementTree.SubElement(run, tag("tab"))
                text = ElementTree.SubElement(run, tag("t"), {"{http://www.w3.org/XML/1998/namespace}space": "preserve"})
                text.text = piece

    blocks = data.get("docx_blocks")
    if blocks is None:
        blocks = [{"kind": "paragraph", "text": value}
                  for value in normalize_field(data["text"]).split("\r\n")]
    for block in blocks:
        if block["kind"] == "paragraph":
            paragraph(body, block["text"])
        else:
            table = ElementTree.SubElement(body, tag("tbl"))
            for row_values in block["rows"]:
                row = ElementTree.SubElement(table, tag("tr"))
                for value in row_values:
                    paragraph(ElementTree.SubElement(row, tag("tc")), value)
    return ElementTree.tostring(document, encoding="utf-8", xml_declaration=True)


def write_fixture(path, data, format="HWP"):
    encoded = json.dumps(data, ensure_ascii=False).encode("utf-8")
    if format == "HWP":
        path.write_bytes(CFB + encoded)
    elif format in {"HWPX", "OOXML"}:
        with zipfile.ZipFile(path, "w") as document:
            document.writestr("fixture.json", encoded)
            if format == "HWPX":
                document.writestr("mimetype", b"application/hwp+zip")
                document.writestr("Contents/content.hpf", b"<package/>")
                document.writestr("Contents/section0.xml", b"<section/>")
            else:
                document.writestr("[Content_Types].xml", b"<Types/>")
                document.writestr("word/document.xml", docx_fixture_xml(data))
    elif format == "PDF":
        path.write_bytes(b"%PDF-1.7\nthis deliberately is not a parseable PDF")
    else:
        raise ValueError(format)


def read_fixture(path):
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as document:
            return json.loads(document.read("fixture.json"))
    content = path.read_bytes()
    if content[:8] != CFB:
        raise HwpError("Fake native parser rejects an invalid container")
    return json.loads(content[8:])


class FakeFactory:
    def __init__(self, **faults):
        self.faults = faults
        self.opened, self.saved = [], []
        self.entries, self.exits = 0, 0
        self.source_mutated = False

    def __call__(self):
        return FakeBackend(self)


class FakeBackend:
    def __init__(self, factory):
        self.factory = factory
        self.data = None

    def __enter__(self):
        self.factory.entries += 1
        return self

    def __exit__(self, *exception):
        self.factory.exits += 1

    def open(self, path):
        self.factory.opened.append(Path(path))
        self.data = read_fixture(path)

    def get_text(self):
        source = self.factory.faults.get("mutate_source")
        if source is not None and not self.factory.source_mutated:
            write_fixture(source, {"text": "edited by another application", "fields": {}})
            self.factory.source_mutated = True
        return self.data["text"]

    def get_fields(self):
        return list(self.data["fields"])

    def get_field(self, name):
        return self.data["fields"][name]

    def put_field(self, name, value):
        if not self.factory.faults.get("put_noop"):
            self.data["fields"][name] = normalize_field(value) if self.factory.faults.get("normalize_fields") else value

    def replace_text(self, old, new, expected_count):
        if self.factory.faults.get("replace_noop"):
            return
        self.data["text"] = self.data["text"].replace(old, new)
        if self.factory.faults.get("replace_unrelated"):
            self.data["text"] += " unexpected extra text"

    def save_as(self, path, format):
        self.factory.saved.append((Path(path), format))
        if format == self.factory.faults.get("fail_format"):
            raise HwpError("Injected native export failure")
        if self.factory.faults.get("no_file"):
            return
        saved = json.loads(json.dumps(self.data))
        if self.factory.faults.get("saved_text_changed"):
            saved["text"] += " unexpectedly changed during save"
        if self.factory.faults.get("saved_fields_changed"):
            saved["fields"]["성명"] = "unexpected field value"
        if format == "OOXML" and self.factory.faults.get("docx_drops_word_spaces"):
            saved["text"] = saved["text"].replace(" ", "")
        if format == "HWPX" and self.factory.faults.get("hwpx_drops_fields"):
            saved["fields"] = {}
        write_fixture(path, saved, format)

    def page_count(self):
        return self.data.get("pages", 2)


class ServiceTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory(prefix="one-hwp-service-")
        self.addCleanup(folder.cleanup)
        self.workspace = Path(folder.name)
        self.source = self.workspace / "input.hwp"
        self.data = {"text": "합성 원문: 대상 / 대상", "fields": {"성명": "원래 이름", "메모": "원래 메모"}, "pages": 2}
        write_fixture(self.source, self.data)
        self.original = self.source.read_bytes()
        self.factory = FakeFactory()
        self.service = HwpService(self.workspace, backend_factory=self.factory)

    def replacement(self, **overrides):
        return {"kind": "replace_text", "old": "대상", "new": "교체", "expected_count": 2, **overrides}

    def field(self, **overrides):
        return {"kind": "set_field", "name": "성명", "value": "새 이름", "expected_old": "원래 이름", **overrides}

    def edit(self, operations=None, **kwargs):
        return self.service.edit("input.hwp", "output.hwp", operations or [self.replacement()], **kwargs)

    def assert_failure(self, action, *, unchanged=True):
        with self.assertRaises((HwpError, OSError)):
            action()
        self.assertFalse((self.workspace / "output.hwp").exists())
        self.assertFalse((self.workspace / "review.docx").exists())
        if unchanged:
            self.assertEqual(self.source.read_bytes(), self.original)
        self.assertEqual(list(self.workspace.glob(".one-hwp-*")), [])
        self.assertEqual(self.factory.entries, self.factory.exits)

    def without_optional_converters(self, action):
        """Even installed pypdf must not be consulted for a native-only job."""
        real_import = builtins.__import__
        attempted_pdf_imports = []

        def import_without_pdf(name, *args, **kwargs):
            if name == "pypdf" or name.startswith("pypdf."):
                attempted_pdf_imports.append(name)
                raise ImportError("Synthetic HWP-only environment has no pypdf")
            return real_import(name, *args, **kwargs)

        with mock.patch("builtins.__import__", side_effect=import_without_pdf), mock.patch.object(
            implementation, "_docx_body_text", side_effect=AssertionError("DOCX must not be inspected for HWP-only")
        ) as docx_reader:
            result = action()
        self.assertEqual(attempted_pdf_imports, [])
        docx_reader.assert_not_called()
        return result

    def assert_hwp_only_result(self, result, *, edited):
        # Call history catches deleted intermediates too: checking final files
        # alone could miss a PDF or OOXML save that was removed during cleanup.
        self.assertEqual([format for _, format in self.factory.saved], ["HWP"])
        self.assertTrue(self.factory.opened)
        self.assertTrue(all(path.suffix.lower() == ".hwp" for path in self.factory.opened))
        self.assertTrue(all(path.suffix.lower() == ".hwp" for path, _ in self.factory.saved))
        self.assertEqual([item["format"] for item in result["outputs"]], ["hwp"])
        self.assertEqual([item["path"] for item in result["outputs"]], ["output.hwp"])
        self.assertEqual({path.name for path in self.workspace.iterdir()}, {"input.hwp", "output.hwp"})
        output = self.workspace / "output.hwp"
        expected = self.data["text"].replace("대상", "교체") if edited else self.data["text"]
        self.assertEqual(read_fixture(output)["text"], expected)
        self.assertEqual(result["outputs"][0]["sha256"], digest(output))
        self.assertTrue(result["outputs"][0]["native_reopen"])
        self.assertTrue(result["outputs"][0]["fields_verified"])
        self.assertFalse(result["layout_verified"])
        self.assertTrue(result["warnings"])
        self.assertFalse(any("docx" in warning.lower() for warning in result["warnings"]))
        self.assertTrue(result["source_unchanged"])
        self.assertEqual(result["source_sha256"], digest(self.source))
        self.assertEqual(self.source.read_bytes(), self.original)
        self.assertEqual(self.factory.entries, self.factory.exits)

    def test_hwp_only_edit_with_exports_omitted_uses_only_native_hwp(self):
        result = self.without_optional_converters(lambda: self.edit())
        self.assert_hwp_only_result(result, edited=True)

    def test_hwp_only_edit_with_empty_exports_uses_only_native_hwp(self):
        result = self.without_optional_converters(lambda: self.edit(exports=[]))
        self.assert_hwp_only_result(result, edited=True)

    def test_hwp_only_export_uses_only_native_hwp(self):
        result = self.without_optional_converters(
            lambda: self.service.export("input.hwp", "output.hwp", "hwp")
        )
        self.assert_hwp_only_result(result, edited=False)

    def test_explicit_docx_export_keeps_conversion_warning(self):
        result = self.edit(exports=[{"output": "review.docx", "format": "docx"}])
        self.assertEqual([format for _, format in self.factory.saved], ["HWP", "OOXML"])
        self.assertEqual([item["format"] for item in result["outputs"]], ["hwp", "docx"])
        self.assertTrue(any("docx conversion" in warning.lower() for warning in result["warnings"]))
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_inspect_uses_private_copy_and_preserves_original(self):
        result = self.service.inspect("input.hwp")
        self.assertEqual(result["text"], self.data["text"])
        self.assertEqual(result["source_sha256"], digest(self.source))
        self.assertTrue(result["source_unchanged"])
        self.assertNotIn(self.source, self.factory.opened)
        self.assertEqual(self.source.read_bytes(), self.original)
        self.assertEqual(self.factory.entries, self.factory.exits)
        self.assertEqual(list(self.workspace.glob(".one-hwp-*")), [])

    def test_inspect_bounds_text_and_total_field_values(self):
        self.data["text"] = "텍" * (MAX_TEXT + 10)
        self.data["fields"] = {"첫째": "가" * (MAX_TEXT - 5), "둘째": "나" * 30, "셋째": "다" * 20}
        write_fixture(self.source, self.data)
        result = self.service.inspect("input.hwp")
        self.assertEqual(len(result["text"]), MAX_TEXT)
        self.assertTrue(result["text_truncated"])
        self.assertEqual(sum(len(field["value"]) for field in result["fields"]), MAX_TEXT)
        self.assertTrue(result["fields"][1]["truncated"])
        self.assertEqual(result["fields"][2]["value"], "")

    def test_exact_replacement_reopens_and_hashes_published_artifact(self):
        result = self.edit()
        output = self.workspace / "output.hwp"
        self.assertEqual(read_fixture(output)["text"], self.data["text"].replace("대상", "교체"))
        self.assertTrue(result["native_reopen"])
        self.assertFalse(result["layout_verified"])
        self.assertEqual(result["operations"], [{"index": 0, "kind": "replace_text", "matches": 2}])
        self.assertEqual(result["outputs"][0]["sha256"], digest(output))
        self.assertTrue(result["outputs"][0]["container_valid"])
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_operations_apply_in_declared_sequence(self):
        self.edit([self.replacement(), self.replacement(old="교체", new="완료")])
        self.assertEqual(read_fixture(self.workspace / "output.hwp")["text"], self.data["text"].replace("대상", "완료"))

    def test_stale_occurrence_count_does_not_publish(self):
        self.assert_failure(lambda: self.edit([self.replacement(expected_count=1)]))

    def test_zero_expected_count_is_an_explicit_noop(self):
        self.edit([self.replacement(old="없는 내용", expected_count=0)])
        self.assertEqual(read_fixture(self.workspace / "output.hwp"), self.data)

    def test_replacement_noop_and_unrelated_edit_are_detected(self):
        for fault in ("replace_noop", "replace_unrelated"):
            with self.subTest(fault=fault):
                self.factory.faults = {fault: True}
                self.assert_failure(self.edit)

    def test_field_guard_updates_only_exact_inspected_field(self):
        self.edit([self.field()])
        saved = read_fixture(self.workspace / "output.hwp")
        self.assertEqual(saved["fields"]["성명"], "새 이름")
        self.assertEqual(saved["fields"]["메모"], "원래 메모")
        self.assertEqual(saved["text"], self.data["text"])
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_stale_field_value_and_missing_field_fail(self):
        for operation in (self.field(expected_old="stale"), self.field(name="not inspected")):
            with self.subTest(operation=operation):
                self.assert_failure(lambda: self.edit([operation]))

    def test_field_write_noop_detected(self):
        self.factory.faults["put_noop"] = True
        self.assert_failure(lambda: self.edit([self.field()]))

    def test_multiline_field_accepts_native_newline_normalization(self):
        self.factory.faults["normalize_fields"] = True
        self.edit([self.field(value="첫 줄\n둘째 줄")])
        self.assertEqual(read_fixture(self.workspace / "output.hwp")["fields"]["성명"], "첫 줄\r\n둘째 줄")

    def test_primary_save_content_or_field_corruption_detected(self):
        for fault in ("saved_text_changed", "saved_fields_changed"):
            with self.subTest(fault=fault):
                self.factory.faults = {fault: True}
                self.assert_failure(self.edit)

    def test_missing_native_file_is_not_success(self):
        self.factory.faults["no_file"] = True
        with self.assertRaises((HwpError, FileNotFoundError)):
            self.edit()
        self.assertFalse((self.workspace / "output.hwp").exists())
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_selected_source_hash_must_match_current_bytes(self):
        self.assert_failure(lambda: self.edit(expected_sha256="0" * 64))
        result = self.edit(expected_sha256=digest(self.source))
        self.assertEqual(result["source_sha256"], digest(self.source))

    def test_invalid_selected_hash_rejected(self):
        for invalid in (True, "a" * 63, "A" * 64, "g" * 64):
            with self.subTest(value=invalid):
                self.assert_failure(lambda: self.edit(expected_sha256=invalid))

    def test_source_change_inside_native_job_prevents_publication(self):
        self.factory.faults["mutate_source"] = self.source
        self.assert_failure(self.edit, unchanged=False)
        self.assertEqual(read_fixture(self.source)["text"], "edited by another application")

    def test_source_change_during_inspection_is_not_reported_unchanged(self):
        self.factory.faults["mutate_source"] = self.source
        self.assert_failure(lambda: self.service.inspect("input.hwp"), unchanged=False)
        self.assertEqual(read_fixture(self.source)["text"], "edited by another application")

    def test_source_change_during_snapshot_is_not_reverted_or_published(self):
        copy = implementation.shutil.copyfile
        def changing_copy(source, destination, **kwargs):
            result = copy(source, destination, **kwargs)
            write_fixture(self.source, {"text": "changed during freeze", "fields": {}})
            return result
        with mock.patch.object(implementation.shutil, "copyfile", side_effect=changing_copy):
            self.assert_failure(self.edit, unchanged=False)
        self.assertEqual(read_fixture(self.source)["text"], "changed during freeze")
        self.assertEqual(self.factory.entries, 0)

    def test_source_change_during_publication_rolls_back_owned_outputs(self):
        link = implementation.os.link
        def changing_link(*args, **kwargs):
            value = link(*args, **kwargs)
            write_fixture(self.source, {"text": "changed at publication", "fields": {}})
            return value
        with mock.patch.object(implementation.os, "link", side_effect=changing_link):
            self.assert_failure(self.edit, unchanged=False)
        self.assertEqual(read_fixture(self.source)["text"], "changed at publication")

    def test_published_bytes_must_match_recorded_hash_before_success(self):
        link = implementation.os.link
        def corrupting_link(staged, output, **kwargs):
            value = link(staged, output, **kwargs)
            with Path(output).open("ab") as stream:
                stream.write(b"unexpected bytes during publication")
            return value
        with mock.patch.object(implementation.os, "link", side_effect=corrupting_link):
            self.assert_failure(self.edit)

    def test_publication_second_failure_removes_only_new_owned_first_file(self):
        link = implementation.os.link
        calls = 0
        def failing_second_link(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("Injected second publication failure")
            return link(*args, **kwargs)
        with mock.patch.object(implementation.os, "link", side_effect=failing_second_link):
            self.assert_failure(lambda: self.edit(exports=[{"output": "review.docx", "format": "docx"}]))
        self.assertEqual(calls, 2)

    def test_rollback_does_not_remove_a_replaced_output_owned_by_someone_else(self):
        link = implementation.os.link
        calls = 0
        def replacing_after_link(staged, output, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("Injected second publication failure")
            value = link(staged, output, **kwargs)
            Path(output).unlink()
            Path(output).write_bytes(b"replacement belonging to another application")
            return value
        with mock.patch.object(implementation.os, "link", side_effect=replacing_after_link):
            with self.assertRaises(OSError):
                self.edit(exports=[{"output": "review.docx", "format": "docx"}])
        self.assertEqual((self.workspace / "output.hwp").read_bytes(), b"replacement belonging to another application")
        self.assertFalse((self.workspace / "review.docx").exists())
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_output_created_mid_publication_is_not_overwritten_or_rolled_back(self):
        link = implementation.os.link
        def competing_file(staged, output, **kwargs):
            result = link(staged, output, **kwargs)
            (self.workspace / "review.docx").write_bytes(b"created by another application")
            return result
        with mock.patch.object(implementation.os, "link", side_effect=competing_file):
            with self.assertRaises(HwpError):
                self.edit(exports=[{"output": "review.docx", "format": "docx"}])
        self.assertFalse((self.workspace / "output.hwp").exists())
        self.assertEqual((self.workspace / "review.docx").read_bytes(), b"created by another application")
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_existing_primary_and_export_outputs_are_preserved(self):
        for name in ("output.hwp", "review.docx"):
            with self.subTest(name=name):
                existing = self.workspace / name
                existing.write_bytes(b"belongs to user")
                with self.assertRaises(HwpError):
                    self.edit(exports=[{"output": "review.docx", "format": "docx"}])
                self.assertEqual(existing.read_bytes(), b"belongs to user")
                existing.unlink()
        self.assertEqual(self.factory.entries, 0)
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_duplicate_output_paths_are_rejected_before_native_launch(self):
        self.assert_failure(lambda: self.edit(exports=[{"output": "output.hwp", "format": "hwp"}]))
        self.assertEqual(self.factory.entries, 0)

    def test_traversal_absolute_drive_ads_and_reserved_paths_rejected(self):
        unsafe = ("../outside.hwp", r"..\outside.hwp", str(self.source), r"C:\outside.hwp",
                  r"\\server\share\outside.hwp", "input.hwp:stream", "NUL.hwp", "COM1.hwp", "bad./out.hwp")
        for path in unsafe:
            with self.subTest(path=path):
                with self.assertRaises(HwpError):
                    self.service.inspect(path)
                with self.assertRaises(HwpError):
                    self.service.edit("input.hwp", path, [self.replacement()])
        self.assertEqual(self.factory.entries, 0)

    def test_new_output_requires_existing_parent_and_matching_suffix(self):
        for output, format in (("missing/output.hwp", "hwp"), ("output.txt", "hwp"),
                               ("output.hwpx", "docx"), ("output.hwp", "unsupported")):
            with self.subTest(output=output):
                with self.assertRaises(HwpError):
                    self.service.export("input.hwp", output, format)
        self.assertEqual(self.factory.entries, 0)

    def test_unknown_unhashable_format_is_a_guarded_input_error(self):
        for invalid in (None, [], {}, True, 42):
            with self.subTest(format=invalid):
                self.assert_failure(lambda: self.service.export("input.hwp", "output.hwp", invalid))
        self.assertEqual(self.factory.entries, 0)

    def test_edit_primary_docx_or_pdf_not_supported_as_editable_output(self):
        for output in ("out.docx", "out.pdf"):
            with self.subTest(output=output):
                with self.assertRaises(HwpError):
                    self.service.edit("input.hwp", output, [self.replacement()])
        self.assertEqual(self.factory.entries, 0)

    def test_newline_tabs_and_null_literal_replacements_rejected(self):
        for text in ("a\nb", "a\rb", "a\tb", "a\x00b"):
            for field in ("old", "new"):
                with self.subTest(text=text, field=field):
                    self.assert_failure(lambda: self.edit([self.replacement(**{field: text})]))
        self.assertEqual(self.factory.entries, 0)

    def test_unknown_operations_extra_code_fields_and_boolean_counts_rejected(self):
        for operation in ({"kind": "run_code", "code": "not executed"}, self.replacement(expected_count=True),
                          {**self.field(), "arbitrary_action": "not executed"}, self.replacement(expected_count=-1)):
            with self.subTest(operation=operation):
                self.assert_failure(lambda: self.edit([operation]))
        self.assertEqual(self.factory.entries, 0)

    def test_native_export_failure_publishes_nothing(self):
        self.factory.faults["fail_format"] = "OOXML"
        self.assert_failure(lambda: self.edit(exports=[{"output": "review.docx", "format": "docx"}]))

    def test_docx_export_validates_xml_without_native_docx_import(self):
        result = self.service.export("input.hwp", "output.docx", "docx")
        output = self.workspace / "output.docx"
        self.assertEqual(read_fixture(output), self.data)
        self.assertTrue(result["outputs"][0]["container_valid"])
        self.assertTrue(result["native_reopen"])
        self.assertFalse(result["outputs"][0]["native_reopen"])
        self.assertTrue(result["outputs"][0]["text_verified"])
        self.assertEqual(result["outputs"][0]["text_verification_method"], "docx_main_document_xml")
        self.assertFalse(result["layout_verified"])
        self.assertEqual(result["outputs"][0]["sha256"], digest(output))
        self.assertEqual(self.source.read_bytes(), self.original)
        self.assertFalse(any(path.suffix.lower() == ".docx" for path in self.factory.opened))
        self.assertEqual([format for path, format in self.factory.saved], ["HWP", "OOXML"])
        self.assertTrue(any("docx conversion" in warning.lower() for warning in result["warnings"]))

    def test_docx_xml_check_does_not_accept_lost_word_boundaries(self):
        self.factory.faults["docx_drops_word_spaces"] = True
        self.assert_failure(lambda: self.service.export("input.hwp", "review.docx", "docx"))

    def test_docx_input_is_unsupported_before_native_open(self):
        write_fixture(self.workspace / "input.docx", self.data, "OOXML")
        for action in (
            lambda: self.service.inspect("input.docx"),
            lambda: self.service.export("input.docx", "output.hwp", "hwp"),
            lambda: self.service.edit("input.docx", "output.hwp", [self.replacement()]),
        ):
            with self.assertRaises(HwpError):
                action()
        self.assertEqual(self.factory.opened, [])
        self.assertEqual(self.factory.entries, 0)

    def test_docx_visible_xml_preserves_paragraph_table_order_and_split_runs(self):
        self.data["text"] = "첫 문단 <합성> & text\n첫 셀 A\t두 단어\n둘째 셀 B\n끝 문단"
        self.data["docx_blocks"] = [
            {"kind": "paragraph", "text": "첫 문단 <합성> & text"},
            {"kind": "table", "rows": [["첫 셀 A\t두 단어", "둘째 셀 B"]]},
            {"kind": "paragraph", "text": "끝 문단"},
        ]
        write_fixture(self.source, self.data)
        result = self.service.export("input.hwp", "output.docx", "docx")
        visible = implementation._docx_body_text(self.workspace / "output.docx")
        self.assertEqual(" ".join(visible.split()), " ".join(self.data["text"].split()))
        self.assertTrue(result["outputs"][0]["text_verified"])
        self.assertFalse(result["outputs"][0]["native_reopen"])
        self.assertFalse(any(path.suffix.lower() == ".docx" for path in self.factory.opened))

    def test_hwpx_secondary_export_cannot_drop_fields_while_preserving_body(self):
        self.factory.faults["hwpx_drops_fields"] = True
        self.assert_failure(lambda: self.edit(exports=[{"output": "review.hwpx", "format": "hwpx"}]))
        self.assertFalse((self.workspace / "review.hwpx").exists())

    def test_hwpx_primary_is_native_reopened_and_checked(self):
        self.service.edit("input.hwp", "output.hwpx", [self.field()])
        output = self.workspace / "output.hwpx"
        self.assertTrue(validate_artifact(output, "hwpx")["container_valid"])
        self.assertEqual(read_fixture(output)["fields"]["성명"], "새 이름")
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_corrupt_pdf_export_is_not_published(self):
        with self.assertRaises(HwpError):
            self.service.export("input.hwp", "output.pdf", "pdf")
        self.assertFalse((self.workspace / "output.pdf").exists())
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_docx_missing_required_members_bad_xml_and_duplicate_members_fail(self):
        output = self.workspace / "invalid.docx"
        for case in ("missing", "xml", "duplicate", "entity"):
            with self.subTest(case=case):
                with zipfile.ZipFile(output, "w") as document:
                    document.writestr("[Content_Types].xml", b"<Types/>")
                    if case != "missing":
                        xml = b"<document/>"
                        if case == "xml":
                            xml = b"<not closed"
                        elif case == "entity":
                            xml = b'<!DOCTYPE document [<!ENTITY x "bad">]><document/>'
                        document.writestr("word/document.xml", xml)
                    if case == "duplicate":
                        with self.assertWarns(UserWarning):
                            document.writestr("word/document.xml", b"<document/>")
                with self.assertRaises(HwpError):
                    validate_artifact(output, "docx")

    def test_hwp_header_and_hwpx_mimetype_are_not_just_suffix_checks(self):
        bad_hwp = self.workspace / "fake.hwp"
        bad_hwp.write_bytes(b"plain text")
        with self.assertRaises(HwpError):
            self.service.inspect("fake.hwp")
        bad_hwpx = self.workspace / "fake.hwpx"
        with zipfile.ZipFile(bad_hwpx, "w") as document:
            document.writestr("mimetype", b"application/not-hwp")
            document.writestr("Contents/content.hpf", b"<package/>")
            document.writestr("Contents/section0.xml", b"<section/>")
        with self.assertRaises(HwpError):
            self.service.inspect("fake.hwpx")
        self.assertEqual(self.factory.entries, 0)

    def test_symlink_source_is_not_followed(self):
        alias = self.workspace / "alias.hwp"
        try:
            alias.symlink_to(self.source)
        except OSError as exc:
            self.skipTest(f"OS cannot create symlink fixture: {exc}")
        with self.assertRaises(HwpError):
            self.service.inspect("alias.hwp")
        self.assertEqual(self.factory.entries, 0)

    def test_workspace_and_deadline_validation(self):
        with self.assertRaises(HwpError):
            HwpService(self.workspace / "missing", backend_factory=self.factory)
        for timeout in (True, 0, -1, 301):
            with self.subTest(timeout=timeout):
                with self.assertRaises(HwpError):
                    HwpService(self.workspace, backend_factory=self.factory, timeout=timeout)

    def test_doctor_does_not_enter_native_backend(self):
        result = self.service.doctor()
        self.assertFalse(result["native_engine_tested"])
        self.assertIn("dependencies", result)
        self.assertEqual(self.factory.entries, 0)


if __name__ == "__main__":
    unittest.main()
