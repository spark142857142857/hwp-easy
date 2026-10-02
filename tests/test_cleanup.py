"""Cleanup visibility with synthetic documents, never real Hancom or user files."""
from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from one_hwp import service as implementation
from one_hwp.service import CFB, HwpError, HwpService, digest


class SyntheticBackend:
    """Opaque CFB+JSON exercises orchestration, not HWP validity/COM fidelity."""
    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def open(self, path):
        data = Path(path).read_bytes()
        self.document = json.loads(data[len(CFB):])

    def get_text(self):
        return self.document["text"]

    def get_fields(self):
        return []

    def get_field(self, name):
        raise KeyError(name)

    def page_count(self):
        return 1

    def replace_text(self, old, new, count):
        self.document["text"] = self.document["text"].replace(old, new)

    def save_as(self, path, format):
        if format != "HWP":
            raise HwpError("Cleanup fixture only supports HWP")
        Path(path).write_bytes(CFB + json.dumps(self.document).encode("utf-8"))


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="one-hwp-cleanup-test-")
        # Capture the original bound cleanup before mocking the class method.
        # This removes all retained synthetic data at the end of each test.
        self.addCleanup(self.temporary.cleanup)
        self.workspace = Path(self.temporary.name)
        self.source = self.workspace / "source.hwp"
        self.source.write_bytes(CFB + json.dumps({"text": "selected target text"}).encode("utf-8"))
        self.original = self.source.read_bytes()
        self.original_hash = digest(self.source)
        self.service = HwpService(self.workspace, backend_factory=SyntheticBackend)
        self.operation = {"kind": "replace_text", "old": "target", "new": "replacement", "expected_count": 1}

    @staticmethod
    def retain_scratch(temporary):
        # Mock cleanup as no file deletion. Detach GC's finalizer as well so it
        # cannot erase the evidence before the caller inspects the warning.
        temporary._finalizer.detach()

    def retained_cleanup(self):
        return mock.patch.object(implementation.tempfile.TemporaryDirectory, "cleanup",
                                 autospec=True, side_effect=self.retain_scratch)

    def assert_original_preserved(self):
        self.assertEqual(self.source.read_bytes(), self.original)
        self.assertEqual(digest(self.source), self.original_hash)

    def scratch_folders(self):
        return list(self.workspace.glob(".one-hwp-*"))

    def assert_retention_warning(self, messages):
        folders = self.scratch_folders()
        self.assertEqual(len(folders), 1)
        scratch = folders[0]
        self.assertTrue(scratch.is_dir())
        self.assertTrue(any(path.name.startswith("source") for path in scratch.iterdir()))
        warning = next((message for message in messages if scratch.name in message), None)
        self.assertIsNotNone(warning, "Retention warning must identify the actual private folder")
        self.assertIn("document", warning.lower())
        self.assertIn("copies", warning.lower())
        self.assertNotIn(str(self.workspace), warning, "Diagnostic must use a safe workspace-relative path")
        self.assertNotIn(str(scratch), warning)
        self.assertNotIn(self.original[len(CFB):].decode("utf-8"), warning)
        self.assert_original_preserved()

    def test_normal_inspect_cleans_private_folder(self):
        result = self.service.inspect("source.hwp")
        self.assertTrue(result["source_unchanged"])
        self.assertEqual(self.scratch_folders(), [])
        self.assertEqual(result.get("warnings", []), [])
        self.assert_original_preserved()

    def test_normal_edit_cleans_private_folder_and_preserves_output(self):
        result = self.service.edit("source.hwp", "edited.hwp", [self.operation])
        output = self.workspace / "edited.hwp"
        self.assertTrue(output.is_file())
        self.assertEqual(result["outputs"][0]["sha256"], digest(output))
        self.assertEqual(self.scratch_folders(), [])
        self.assertFalse(any(".one-hwp-" in warning for warning in result.get("warnings", [])))
        self.assert_original_preserved()

    def test_inspect_success_does_not_silently_retain_document_copy(self):
        with self.retained_cleanup():
            result = self.service.inspect("source.hwp")
        self.assertTrue(result["source_unchanged"])
        self.assertEqual(result["text"], "selected target text")
        self.assert_retention_warning(result["warnings"])

    def test_edit_success_warns_about_retained_document_copies(self):
        with self.retained_cleanup():
            result = self.service.edit("source.hwp", "edited.hwp", [self.operation])
        output = self.workspace / "edited.hwp"
        self.assertTrue(output.is_file())
        self.assertEqual(result["outputs"][0]["sha256"], digest(output))
        saved = json.loads(output.read_bytes()[len(CFB):])
        self.assertEqual(saved["text"], "selected replacement text")
        self.assert_retention_warning(result["warnings"])

    def test_operation_failure_keeps_reason_and_retention_warning_without_outputs(self):
        stale = {**self.operation, "expected_count": 2}
        with self.assertRaises(HwpError) as baseline:
            self.service.edit("source.hwp", "edited.hwp", [stale])
        reason = str(baseline.exception)
        self.assertEqual(self.scratch_folders(), [])
        with self.retained_cleanup():
            with self.assertRaises(HwpError) as retained:
                self.service.edit("source.hwp", "edited.hwp", [stale])
        message = str(retained.exception)
        self.assertIn(reason, message)
        self.assertFalse((self.workspace / "edited.hwp").exists())
        self.assert_retention_warning([message])

    def test_inspect_failure_keeps_reason_and_retention_warning_without_outputs(self):
        with self.retained_cleanup():
            with mock.patch.object(self.service, "_run", side_effect=HwpError("Synthetic inspection failed")):
                with self.assertRaises(HwpError) as retained:
                    self.service.inspect("source.hwp")
        message = str(retained.exception)
        self.assertIn("Synthetic inspection failed", message)
        self.assertFalse((self.workspace / "edited.hwp").exists())
        self.assert_retention_warning([message])


if __name__ == "__main__":
    unittest.main()
