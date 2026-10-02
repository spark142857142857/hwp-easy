"""Mock native-adapter contracts; these do not prove Hancom format fidelity."""

from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from one_hwp.hancom import HancomBackend, HancomError


class FakeApp:
    def __init__(self):
        self.text = "한글 원문 원문\r\n다음 문단\r\n"
        self.fields = {"이름{{0}}": "옛 이름", "항목{{0}}": "첫째", "항목{{1}}": "둘째"}
        self.XHwpWindows = SimpleNamespace(Item=Mock(return_value=SimpleNamespace(Visible=True)))
        self.RegisterModule = Mock(return_value=True)
        self.Clear = Mock(return_value=True)
        self.Quit = Mock()
        self.Open = Mock(return_value=True)
        self.GetTextFile = Mock(side_effect=lambda *_: self.text)
        self.GetFieldList = Mock(side_effect=lambda *_: "\x02".join(self.fields))
        self.GetFieldText = Mock(side_effect=lambda name: self.fields[name])
        self.PutFieldText = Mock(side_effect=self.put)
        self.SaveAs = Mock(side_effect=self.save)
        self.PageCount = 2
        self.FindDir = Mock(return_value=2)
        self.parameters = SimpleNamespace(HSet=object(), FindRegExp=1, SeveralWords=1, AutoSpell=1)
        self.HParameterSet = SimpleNamespace(HFindReplace=self.parameters)
        self.HAction = SimpleNamespace(GetDefault=Mock(), Execute=Mock(side_effect=self.replace))

    def put(self, name, value):
        self.fields[name] = value.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\r\n")

    def replace(self, action, parameters):
        self.text = self.text.replace(self.parameters.FindString, self.parameters.ReplaceString)
        return True

    def save(self, path, *_):
        Path(path).write_bytes(b"native-export-placeholder")
        return True


class HancomTests(unittest.TestCase):
    def setUp(self):
        self.app = FakeApp()
        self.com = SimpleNamespace(
            COINIT_APARTMENTTHREADED=2, CoInitializeEx=Mock(), CoUninitialize=Mock(),
        )
        self.client = SimpleNamespace(DispatchEx=Mock(return_value=self.app))
        self.patch = patch("one_hwp.hancom._load_com", return_value=(self.com, self.client))
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.source = self.folder / "working-copy.hwp"
        self.source.write_bytes(b"private-copy")

    def test_isolated_dispatch_sta_and_own_cleanup(self):
        with HancomBackend() as backend:
            self.assertEqual(backend.get_text(), self.app.text)
        self.com.CoInitializeEx.assert_called_once_with(2)
        self.client.DispatchEx.assert_called_once_with("HWPFrame.HwpObject")
        self.app.RegisterModule.assert_called_once_with("FilePathCheckDLL", "FilePathCheckerModule")
        self.assertFalse(self.app.XHwpWindows.Item(0).Visible)
        self.app.Clear.assert_called_once_with(1)
        self.app.Quit.assert_called_once()
        self.com.CoUninitialize.assert_called_once()

    def test_visible_requires_explicit_boolean(self):
        with HancomBackend(visible=True):
            self.assertTrue(self.app.XHwpWindows.Item(0).Visible)
        with self.assertRaises(ValueError):
            HancomBackend(visible=1)

    def test_security_registration_failure_cleans_without_open(self):
        self.app.RegisterModule.return_value = False
        with self.assertRaisesRegex(HancomError, "security module"):
            with HancomBackend():
                self.fail("must not enter")
        self.app.Open.assert_not_called()
        self.app.Quit.assert_called_once()
        self.com.CoUninitialize.assert_called_once()

    def test_security_failure_preserves_safe_cleanup_note(self):
        self.app.RegisterModule.return_value = False
        self.app.Quit.side_effect = RuntimeError("private native diagnostic must not leak")
        with self.assertRaisesRegex(HancomError, "security module") as caught:
            with HancomBackend():
                self.fail("must not enter")
        self.assertEqual(caught.exception.__notes__, ["Private Hancom cleanup failed: quit"])
        self.assertNotIn("private native", str(caught.exception))
        self.com.CoUninitialize.assert_called_once()

    def test_com_initialization_failure_preserves_cleanup_note_on_safe_wrapper(self):
        self.app.RegisterModule.side_effect = RuntimeError("private COM internals")
        self.app.Clear.side_effect = RuntimeError("private clear internals")
        self.app.Quit.side_effect = RuntimeError("private quit internals")
        self.com.CoUninitialize.side_effect = RuntimeError("private COM cleanup internals")
        with self.assertRaisesRegex(HancomError, "initialize") as caught:
            with HancomBackend():
                self.fail("must not enter")
        self.assertEqual(caught.exception.__notes__, ["Private Hancom cleanup failed: clear, quit, COM uninitialize"])
        self.assertNotIn("private COM", str(caught.exception))

    def test_no_module_is_diagnostic_only(self):
        with HancomBackend(security_module=None) as backend:
            self.assertEqual(backend.get_text(), self.app.text)
            for operation in [lambda: backend.open(self.source), lambda: backend.save_as(self.folder / "x.hwp", "HWP")]:
                with self.assertRaisesRegex(HancomError, "security module"):
                    operation()
        self.app.Open.assert_not_called()
        self.app.SaveAs.assert_not_called()

    def test_dispatch_failure_uninitializes_sta(self):
        self.client.DispatchEx.side_effect = RuntimeError("not installed")
        with self.assertRaisesRegex(HancomError, "initialize"):
            with HancomBackend():
                pass
        self.com.CoUninitialize.assert_called_once()
        self.app.Quit.assert_not_called()

    def test_sta_initialization_failure_does_not_uninitialize(self):
        self.com.CoInitializeEx.side_effect = RuntimeError("changed apartment")
        with self.assertRaisesRegex(HancomError, "STA"):
            with HancomBackend():
                pass
        self.com.CoUninitialize.assert_not_called()
        self.client.DispatchEx.assert_not_called()

    def test_context_cannot_be_reused(self):
        backend = HancomBackend()
        with backend:
            pass
        with self.assertRaisesRegex(HancomError, "more than once"):
            with backend:
                pass

    def test_unentered_and_closed_methods_fail(self):
        backend = HancomBackend()
        with self.assertRaises(HancomError):
            backend.get_text()
        with backend:
            pass
        with self.assertRaises(HancomError):
            backend.get_fields()

    def test_other_thread_cannot_use_context(self):
        with HancomBackend() as backend:
            with patch("one_hwp.hancom.threading.get_ident", return_value=-1):
                with self.assertRaisesRegex(HancomError, "owning STA"):
                    backend.get_text()

    def test_cleanup_does_not_mask_body_exception(self):
        self.app.Clear.side_effect = RuntimeError("clear failure")
        with self.assertRaisesRegex(ValueError, "body failed") as caught:
            with HancomBackend():
                raise ValueError("body failed")
        self.assertTrue(any("cleanup failed" in note for note in caught.exception.__notes__))
        self.app.Quit.assert_called_once()
        self.com.CoUninitialize.assert_called_once()

    def test_cleanup_failure_after_success_is_reported(self):
        self.app.Quit.side_effect = RuntimeError("quit failure")
        with self.assertRaisesRegex(HancomError, "cleanup failed"):
            with HancomBackend():
                pass
        self.com.CoUninitialize.assert_called_once()

    def test_open_requires_existing_absolute_working_copy(self):
        with HancomBackend() as backend:
            with self.assertRaises(ValueError):
                backend.open(Path("relative.hwp"))
            with self.assertRaisesRegex(HancomError, "does not exist"):
                backend.open(self.folder / "absent.hwp")
            self.app.Open.assert_not_called()
            backend.open(self.source)
        self.app.Open.assert_called_once_with(
            str(self.source), "", "lock:false;suspendpassword:true;forceopen:true;versionwarning:false",
        )

    def test_false_and_exception_open_are_reported(self):
        with HancomBackend() as backend:
            self.app.Open.return_value = False
            with self.assertRaisesRegex(HancomError, "rejected"):
                backend.open(self.source)
            self.app.Open.side_effect = RuntimeError("COM failure")
            with self.assertRaisesRegex(HancomError, "could not open"):
                backend.open(self.source)

    def test_text_must_be_unicode_string(self):
        self.app.GetTextFile.side_effect = None
        self.app.GetTextFile.return_value = None
        with HancomBackend() as backend:
            with self.assertRaisesRegex(HancomError, "Unicode"):
                backend.get_text()

    def test_field_indexes_are_retained_and_unique_base_resolves(self):
        with HancomBackend() as backend:
            self.assertEqual(backend.get_fields(), list(self.app.fields))
            self.assertEqual(backend.get_field("이름"), "옛 이름")
            self.assertEqual(backend.get_field("항목{{1}}"), "둘째")
        self.app.GetFieldList.assert_called_with(1, 0)

    def test_missing_and_ambiguous_fields_fail_closed(self):
        with HancomBackend() as backend:
            with self.assertRaisesRegex(HancomError, "ambiguous"):
                backend.put_field("항목", "변경")
            with self.assertRaisesRegex(HancomError, "does not exist"):
                backend.get_field("없는 필드")
            with self.assertRaises(ValueError):
                backend.get_field("이름\x02항목")
        self.app.PutFieldText.assert_not_called()

    def test_field_write_multiline_is_verified(self):
        with HancomBackend() as backend:
            backend.put_field("이름", "첫 줄\n다음 줄")
            self.assertEqual(backend.get_field("이름"), "첫 줄\r\n다음 줄")
        self.app.PutFieldText.assert_called_once_with("이름{{0}}", "첫 줄\r\n다음 줄")

    def test_silent_failed_field_write_is_reported(self):
        self.app.PutFieldText.side_effect = None
        with HancomBackend() as backend:
            with self.assertRaisesRegex(HancomError, "did not match"):
                backend.put_field("이름", "변경")

    def test_field_separator_values_are_rejected(self):
        with HancomBackend() as backend:
            for value in [None, "bad\x00", "bad\x02"]:
                with self.assertRaises(ValueError):
                    backend.put_field("이름", value)
        self.app.PutFieldText.assert_not_called()

    def test_literal_replace_counts_and_resets_native_options(self):
        with HancomBackend() as backend:
            self.assertEqual(backend.replace_text("원문", "수정", 2), 2)
        self.assertEqual(self.app.text, "한글 수정 수정\r\n다음 문단\r\n")
        for key in ["AllWordForms", "SeveralWords", "UseWildCards", "WholeWordOnly", "AutoSpell", "HanjaFromHangul", "FindJaso", "FindRegExp"]:
            self.assertEqual(getattr(self.app.parameters, key), 0, key)
        self.assertEqual(self.app.parameters.MatchCase, 1)
        self.assertEqual(self.app.parameters.IgnoreMessage, 1)
        self.app.HAction.GetDefault.assert_called_once_with("AllReplace", self.app.parameters.HSet)

    def test_count_mismatch_never_changes_native_document(self):
        before = self.app.text
        with HancomBackend() as backend:
            with self.assertRaisesRegex(HancomError, "expected_count"):
                backend.replace_text("원문", "변경", 1)
        self.assertEqual(self.app.text, before)
        self.app.HAction.Execute.assert_not_called()

    def test_zero_and_identical_replacements_do_not_run_actions(self):
        with HancomBackend() as backend:
            self.assertEqual(backend.replace_text("없는 문구", "새 문구", 0), 0)
            self.assertEqual(backend.replace_text("원문", "원문", 2), 2)
        self.app.HAction.Execute.assert_not_called()

    def test_single_line_and_strict_expected_count_validation(self):
        with HancomBackend() as backend:
            for old, new, count in [("", "new", 0), ("원문\n", "new", 0), ("원문", "new\t", 2), ("원문", "new", True), ("원문", "new", -1)]:
                with self.assertRaises(ValueError):
                    backend.replace_text(old, new, count)
        self.app.HAction.Execute.assert_not_called()

    def test_native_literal_punctuation_and_case_contract(self):
        self.app.text = "한글[a].*\r\n한글[a].*\r\nCase case\r\n"
        with HancomBackend() as backend:
            backend.replace_text("한글[a].*", "치환$1", 2)
            backend.replace_text("Case", "CASE", 1)
        self.assertEqual(self.app.text, "치환$1\r\n치환$1\r\nCASE case\r\n")

    def test_native_changed_unrelated_text_is_rejected(self):
        def bad_replace(*_):
            self.app.text = "문서 전체 손실"
            return True
        self.app.HAction.Execute.side_effect = bad_replace
        with HancomBackend() as backend:
            with self.assertRaisesRegex(HancomError, "exact literal contract"):
                backend.replace_text("원문", "변경", 2)

    def test_native_false_replace_is_reported(self):
        self.app.HAction.Execute.side_effect = None
        self.app.HAction.Execute.return_value = False
        with HancomBackend() as backend:
            with self.assertRaisesRegex(HancomError, "exact literal contract"):
                backend.replace_text("원문", "변경", 2)

    def test_false_action_result_with_verified_exact_change_succeeds(self):
        def measured_2020_action(*_):
            self.app.replace(None, None)
            return False
        self.app.HAction.Execute.side_effect = measured_2020_action
        with HancomBackend() as backend:
            self.assertEqual(backend.replace_text("원문", "변경", 2), 2)

    def test_format_aliases_and_nonempty_exports(self):
        with HancomBackend() as backend:
            for format, suffix in [("HWP", "hwp"), ("HWPX", "hwpx"), ("PDF", "pdf"), ("DOCX", "docx"), ("OOXML", "docx")]:
                path = self.folder / (format + "." + suffix)
                backend.save_as(path, format)
                self.assertGreater(path.stat().st_size, 0)
        self.assertEqual(self.app.SaveAs.call_args_list[-2].args[1], "OOXML")

    def test_save_cannot_overwrite_or_use_bad_suffix_or_format(self):
        with HancomBackend() as backend:
            with self.assertRaisesRegex(HancomError, "new file"):
                backend.save_as(self.source, "HWP")
            for name, format in [("bad.docx", "HWP"), ("bad.hwp", "HTML"), ("bad.hwp", None)]:
                with self.assertRaises(ValueError):
                    backend.save_as(self.folder / name, format)
        self.app.SaveAs.assert_not_called()
        self.assertEqual(self.source.read_bytes(), b"private-copy")

    def test_false_save_or_absent_export_is_reported(self):
        with HancomBackend() as backend:
            self.app.SaveAs.side_effect = None
            self.app.SaveAs.return_value = False
            with self.assertRaisesRegex(HancomError, "nonempty export"):
                backend.save_as(self.folder / "false.hwp", "HWP")
            self.app.SaveAs.return_value = True
            with self.assertRaisesRegex(HancomError, "nonempty export"):
                backend.save_as(self.folder / "missing.hwp", "HWP")

    def test_empty_export_is_reported(self):
        def empty_save(path, *_):
            Path(path).touch()
            return True
        self.app.SaveAs.side_effect = empty_save
        with HancomBackend() as backend:
            with self.assertRaisesRegex(HancomError, "nonempty export"):
                backend.save_as(self.folder / "empty.hwp", "HWP")

    def test_page_count_does_not_invent_values(self):
        with HancomBackend() as backend:
            self.assertEqual(backend.page_count(), 2)
            for invalid in [None, True, 0, "2", -1]:
                self.app.PageCount = invalid
                self.assertIsNone(backend.page_count())


if __name__ == "__main__":
    unittest.main()
