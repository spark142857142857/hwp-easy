"""Worker failure transport must preserve only safe cleanup diagnostics."""

import io
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from one_hwp import worker


class WorkerTests(unittest.TestCase):
    def run_worker(self, *, result=None, error=None, payload=b"{}"):
        output = io.BytesIO()
        stderr = io.StringIO()
        with patch.object(worker.sys, "stdin", SimpleNamespace(buffer=io.BytesIO(payload))), \
             patch.object(worker.sys, "stdout", SimpleNamespace(buffer=output)), \
             patch.object(worker.sys, "stderr", stderr), \
             patch.object(worker, "run_document_job", return_value=result, side_effect=error):
            code = worker.main()
        return code, json.loads(output.getvalue().decode("utf-8")), stderr.getvalue()

    def test_success_result_is_unchanged_and_emits_no_stderr(self):
        code, response, stderr = self.run_worker(result={"status": "검증 완료"})
        self.assertEqual(code, 0)
        self.assertEqual(response, {"ok": True, "result": {"status": "검증 완료"}})
        self.assertEqual(stderr, "")

    def test_plain_failure_preserves_existing_schema(self):
        code, response, stderr = self.run_worker(error=ValueError("invalid operation"))
        self.assertEqual(code, 1)
        self.assertEqual(response, {"ok": False, "error": "ValueError: invalid operation"})
        self.assertEqual(stderr, "")

    def test_safe_cleanup_warning_survives_both_fields(self):
        error = ValueError("operation failed")
        error.add_note("Private Hancom cleanup failed: quit, clear")
        code, response, stderr = self.run_worker(error=error)
        message = "Private Hancom cleanup failed: clear, quit"
        self.assertEqual(code, 1)
        self.assertEqual(response["cleanup_warnings"], [message])
        self.assertIn(message, response["error"])
        self.assertEqual(stderr, "")

    def test_arbitrary_and_nearly_matching_notes_are_not_dumped(self):
        error = ValueError("operation failed")
        for note in ["PRIVATE DOCUMENT CONTENT", "Private Hancom cleanup failed: quit\nPRIVATE DOCUMENT", "Private Hancom cleanup failed: C:/private/document.hwp", "Private Hancom cleanup failed: quit, unknown stage"]:
            error.add_note(note)
        _, response, stderr = self.run_worker(error=error)
        self.assertNotIn("cleanup_warnings", response)
        self.assertNotIn("PRIVATE", json.dumps(response))
        self.assertNotIn("document.hwp", json.dumps(response))
        self.assertEqual(stderr, "")

    def test_unknown_note_does_not_hide_known_warning(self):
        error = ValueError("operation failed")
        error.add_note("PRIVATE DOCUMENT CONTENT")
        error.add_note("Private Hancom cleanup failed: COM uninitialize")
        _, response, _ = self.run_worker(error=error)
        self.assertEqual(response["cleanup_warnings"], ["Private Hancom cleanup failed: COM uninitialize"])
        self.assertNotIn("PRIVATE DOCUMENT", json.dumps(response))

    def test_wrapped_backend_warning_is_preserved_without_native_cause_dump(self):
        native = RuntimeError("private native internals not to serialize")
        native.add_note("Private Hancom cleanup failed: quit")
        wrapper = RuntimeError("safe operation failed")
        wrapper.__cause__ = native
        _, response, _ = self.run_worker(error=wrapper)
        self.assertIn("Private Hancom cleanup failed: quit", response["error"])
        self.assertNotIn("private native internals", response["error"])

    def test_warning_duplicates_and_chain_cycle_are_bounded(self):
        first = ValueError("first")
        second = ValueError("second")
        first.__cause__ = second
        second.__cause__ = first
        for error in [first, second]:
            error.add_note("Private Hancom cleanup failed: clear, clear, quit")
        self.assertEqual(worker._cleanup_warnings(first), ["Private Hancom cleanup failed: clear, quit"])

    def test_nonstring_and_oversized_notes_are_ignored(self):
        error = ValueError("operation failed")
        error.__notes__ = [None, {"private": "document"}, "Private Hancom cleanup failed: " + "quit, " * 100]
        self.assertEqual(worker._cleanup_warnings(error), [])

    def test_invalid_json_is_failure_without_cleanup_diagnostics(self):
        code, response, stderr = self.run_worker(payload=b"{")
        self.assertEqual(code, 1)
        self.assertFalse(response["ok"])
        self.assertNotIn("cleanup_warnings", response)
        self.assertEqual(stderr, "")


if __name__ == "__main__":
    unittest.main()
