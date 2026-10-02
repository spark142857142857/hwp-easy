"""Synthetic/mock checks only: never open personal documents or start the engine."""
from __future__ import annotations

from contextlib import redirect_stdout
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

import local_corpus as corpus
from one_hwp.native_engine import EngineError, UnsupportedDocumentError


DATA = corpus.CFB_MAGIC + b"synthetic-only"
PRIVATE = "SYNTHETIC_PRIVATE_BODY_FILENAME_AND_EXCEPTION"


def inspection(unsupported=None):
    return {"blocks": [{"kind": "paragraph", "text": PRIVATE}, {"kind": "cell", "text": PRIVATE}],
            "tables": [{"cells": [{"text": PRIVATE}, {"text": PRIVATE}]}],
            "unsupported": unsupported or [], "warnings": [PRIVATE]}


class LocalCorpusTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.folder = self.root / "testdocs"
        self.folder.mkdir()
        self.engine = mock.Mock(spec=["inspect", "preview", "edit"])
        self.engine.inspect.return_value = inspection()
        self.engine.preview.return_value = {"svg": "<svg>" + PRIVATE + "</svg>", "warnings": [PRIVATE]}

    def document(self, name=PRIVATE + ".hwp", data=DATA):
        path = self.folder / name
        path.write_bytes(data)
        return path

    def assert_private_absent(self, report):
        self.assertNotIn(PRIVATE, json.dumps(report))
        self.assertNotIn(str(self.root), json.dumps(report))

    def test_empty_is_no_documents_without_engine_initialization(self):
        with mock.patch.object(corpus, "RhwpEngine") as constructor:
            result = corpus.inspect_corpus(self.folder)
        self.assertEqual(result["status"], "no_documents")
        self.assertEqual(result["summary"]["documents"], 0)
        constructor.assert_not_called()

    def test_hwp_only_top_level_counts_and_unchanged_bytes(self):
        path = self.document(name=PRIVATE + ".HWP")
        original = hashlib.sha256(path.read_bytes()).digest()
        (self.folder / (PRIVATE + ".docx")).write_bytes(b"not-read")
        nested = self.folder / "nested"
        nested.mkdir()
        (nested / "hidden.hwp").write_bytes(DATA)
        result = corpus.inspect_corpus(self.folder, engine=self.engine)
        self.assertEqual(result["status"], "checked")
        self.assertEqual(result["summary"]["ignored_entries"], 2)
        self.assertEqual(result["documents"][0]["counts"], {
            "blocks": 2, "body_paragraphs": 1, "cell_paragraphs": 1,
            "tables": 1, "table_cells": 2, "unsupported_elements": 0})
        self.assertTrue(result["documents"][0]["source_unchanged"])
        self.assertEqual(original, hashlib.sha256(path.read_bytes()).digest())
        self.engine.inspect.assert_called_once_with(DATA)
        self.engine.preview.assert_not_called()
        self.engine.edit.assert_not_called()
        self.assert_private_absent(result)

    def test_unsupported_entries_are_partial_fixed_counts_without_details(self):
        self.document()
        self.engine.inspect.return_value = inspection([
            {"kind": "control", "reason": PRIVATE, "control_id": PRIVATE},
            {"kind": PRIVATE, "reason": PRIVATE},
        ])
        result = corpus.inspect_corpus(self.folder, engine=self.engine)
        row = result["documents"][0]
        self.assertEqual(result["status"], "partial")
        self.assertEqual(row["read_coverage"], "partial_profile")
        self.assertEqual(row["unsupported_counts"], {"control": 1, "other": 1})
        self.assertTrue(row["source_unchanged"])
        self.assert_private_absent(result)

    def test_preview_checks_only_first_page_and_discards_svg(self):
        self.document()
        result = corpus.inspect_corpus(self.folder, engine=self.engine, preview=True)
        self.assertEqual(result["documents"][0]["preview"], {"status": "available", "checked_pages": 1})
        self.engine.preview.assert_called_once_with(DATA, 0)
        self.engine.edit.assert_not_called()
        self.assertFalse(result["layout_verified"])
        self.assert_private_absent(result)

    def test_preview_failure_does_not_claim_read_failure_or_leak_exception(self):
        self.document()
        self.engine.preview.side_effect = RuntimeError(PRIVATE)
        result = corpus.inspect_corpus(self.folder, engine=self.engine, preview=True)
        self.assertEqual(result["status"], "failed")
        row = result["documents"][0]
        self.assertEqual(row["status"], "supported")
        self.assertEqual(row["preview"]["status"], "failed")
        self.assertTrue(row["source_unchanged"])
        self.assert_private_absent(result)

    def test_malformed_magic_does_not_start_engine_and_is_hash_checked(self):
        self.document(data=b"malformed synthetic bytes")
        result = corpus.inspect_corpus(self.folder, engine=self.engine)
        row = result["documents"][0]
        self.assertEqual(row["status"], "malformed")
        self.assertTrue(row["source_unchanged"])
        self.engine.inspect.assert_not_called()

    def test_fixed_failure_codes_distinguish_malformed_unsupported_engine_and_unknown(self):
        self.document()
        for error, status, code in (
            (UnsupportedDocumentError("Malformed HWP container or header"), "malformed", "malformed_document"),
            (UnsupportedDocumentError(PRIVATE), "unsupported", "unsupported_document_profile"),
            (EngineError(PRIVATE), "failed", "engine_unavailable_or_failed"),
            (RuntimeError(PRIVATE), "failed", "inspection_failed"),
        ):
            with self.subTest(code=code):
                self.engine.inspect.side_effect = error
                result = corpus.inspect_corpus(self.folder, engine=self.engine)
                row = result["documents"][0]
                self.assertEqual((row["status"], row["reason_code"]), (status, code))
                self.assertTrue(row["source_unchanged"])
                self.assert_private_absent(result)

    def test_missing_and_parent_traversal_roots_are_rejected(self):
        for root in (self.root / "missing", self.folder / ".." / "testdocs"):
            with self.subTest(case="unsafe_root"):
                result = corpus.inspect_corpus(root, engine=self.engine)
                self.assertEqual(result["status"], "failed")
                self.assertEqual(result["reason_code"], "unsafe_document_path")
                self.assert_private_absent(result)
        self.engine.inspect.assert_not_called()

    def test_directory_named_hwp_is_rejected_without_reading(self):
        (self.folder / "not-a-file.hwp").mkdir()
        row = corpus.inspect_corpus(self.folder, engine=self.engine)["documents"][0]
        self.assertEqual(row["status"], "path_rejected")
        self.assertIsNone(row["source_unchanged"])
        self.engine.inspect.assert_not_called()

    def test_hardlink_aliases_are_rejected_before_read(self):
        source = self.document()
        try:
            os.link(source, self.folder / "alias.hwp")
        except OSError:
            self.skipTest("Hardlinks unavailable")
        report = corpus.inspect_corpus(self.folder, engine=self.engine)
        self.assertEqual(report["summary"]["path_rejected"], 2)
        self.engine.inspect.assert_not_called()
        self.assertEqual(source.read_bytes(), DATA)

    def test_symlink_file_and_root_are_rejected_before_read(self):
        outside = self.root / "outside"
        outside.mkdir()
        target = outside / "synthetic.hwp"
        target.write_bytes(DATA)
        link = self.folder / "alias.hwp"
        root_link = self.root / "linked"
        try:
            link.symlink_to(target)
            root_link.symlink_to(outside, target_is_directory=True)
        except OSError:
            self.skipTest("Symlinks unavailable")
        report = corpus.inspect_corpus(self.folder, engine=self.engine)
        self.assertEqual(report["documents"][0]["status"], "path_rejected")
        report = corpus.inspect_corpus(root_link, engine=self.engine)
        self.assertEqual(report["reason_code"], "unsafe_document_path")
        self.engine.inspect.assert_not_called()

    @unittest.skipUnless(os.name == "nt", "Windows junction semantics")
    def test_junction_root_rejected_without_reading(self):
        outside = self.root / "outside"
        outside.mkdir()
        junction = self.root / "junction"
        outcome = subprocess.run(["cmd", "/c", "mklink", "/J", str(junction), str(outside)],
                                 capture_output=True, text=True)
        if outcome.returncode:
            self.skipTest("Junction creation unavailable")
        self.addCleanup(junction.rmdir)
        self.assertEqual(corpus.inspect_corpus(junction, engine=self.engine)["reason_code"], "unsafe_document_path")
        self.engine.inspect.assert_not_called()

    def test_external_byte_change_and_removal_fail_hash_verification(self):
        path = self.document()

        def change(data):
            path.write_bytes(DATA + b"synthetic external change")
            return inspection()

        self.engine.inspect.side_effect = change
        row = corpus.inspect_corpus(self.folder, engine=self.engine)["documents"][0]
        self.assertEqual(row["reason_code"], "source_changed")
        self.assertFalse(row["source_unchanged"])

        def remove(data):
            path.unlink()
            raise RuntimeError(PRIVATE)

        self.engine.inspect.side_effect = remove
        row = corpus.inspect_corpus(self.folder, engine=self.engine)["documents"][0]
        self.assertEqual(row["reason_code"], "source_recheck_failed")
        self.assertEqual(row["source_check_code"], "verification_failed")

    def test_oversized_input_is_refused_before_read_or_engine(self):
        self.document()
        with mock.patch.object(corpus, "MAX_BYTES", 4):
            row = corpus.inspect_corpus(self.folder, engine=self.engine)["documents"][0]
        self.assertEqual(row["reason_code"], "input_byte_limit")
        self.assertIsNone(row["source_unchanged"])
        self.engine.inspect.assert_not_called()

    def test_report_and_stdout_are_private_and_empty_exit_is_nonzero(self):
        stdout = io.StringIO()
        with mock.patch.object(corpus, "ROOT", self.root), redirect_stdout(stdout):
            code = corpus.main(["--folder", str(self.folder), "--report", str(self.root / "outputs" / "local-corpus.json")])
        self.assertEqual(code, 2)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["status"], "no_documents")
        self.assertNotIn("documents", payload)
        self.assert_private_absent(json.loads((self.root / "outputs" / "local-corpus.json").read_text()))
        self.assertNotIn(str(self.root), stdout.getvalue())

    def test_default_main_supported_report_and_stdout_exclude_all_private_data(self):
        source = self.document()
        stdout = io.StringIO()
        with mock.patch.object(corpus, "ROOT", self.root), \
                mock.patch.object(corpus, "RhwpEngine", return_value=self.engine), redirect_stdout(stdout):
            # Exercise the default folder/report paths under a synthetic repository root.
            code = corpus.main(["--preview"])
        self.assertEqual(code, 0)
        saved = json.loads((self.root / "outputs" / "local-corpus.json").read_text())
        self.assert_private_absent(saved)
        self.assertNotIn(PRIVATE, stdout.getvalue())
        self.assertNotIn(str(self.root), stdout.getvalue())
        self.assertEqual(json.loads(stdout.getvalue())["summary"]["supported"], 1)
        self.assertEqual(source.read_bytes(), DATA)
        self.assertEqual(set(path.name for path in (self.root / "outputs").iterdir()), {"local-corpus.json"})
        self.engine.edit.assert_not_called()

    def test_report_cannot_overwrite_hwp_outside_outputs_or_hardlink(self):
        source = self.document()
        outputs = self.root / "outputs"
        outputs.mkdir()
        linked = outputs / "linked.json"
        try:
            os.link(source, linked)
        except OSError:
            self.skipTest("Hardlinks unavailable")
        with mock.patch.object(corpus, "ROOT", self.root):
            for target in (source, self.root / "outside.json", linked):
                with self.subTest(case="unsafe_report"):
                    with self.assertRaises(corpus.PathPolicyError):
                        corpus.write_report({"status": "synthetic"}, target)
        self.assertEqual(source.read_bytes(), DATA)

    def test_bad_cli_arguments_do_not_echo_private_values_or_exceptions(self):
        stdout = io.StringIO()
        with redirect_stdout(stdout):
            code = corpus.main(["--" + PRIVATE])
        self.assertEqual(code, 2)
        self.assertNotIn(PRIVATE, stdout.getvalue())

    @unittest.skipUnless(os.name == "nt", "Windows alternate data streams")
    def test_report_rejects_alternate_data_stream_paths(self):
        source = self.document()
        with mock.patch.object(corpus, "ROOT", self.root):
            target = self.root / "outputs" / "source.hwp:report.json"
            with self.assertRaises(corpus.PathPolicyError):
                corpus.write_report({"status": "synthetic"}, target)
        self.assertEqual(source.read_bytes(), DATA)


if __name__ == "__main__":
    unittest.main()
