"""Storage-only tests: CFB-prefixed synthetic bytes are not valid HWP fixtures.

These tests prove path and local publication behavior, not document-engine,
visual-fidelity, crash-proof, cross-process CAS, or cloud isolation guarantees.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import hashlib
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest import mock

from one_hwp import native_storage as implementation
from one_hwp.native_storage import (
    BackupError, CFB_MAGIC, ConflictError, InvalidDocumentError, PathPolicy,
    PathPolicyError, SafeStore, SaveError,
)


OLD = CFB_MAGIC + b"synthetic original"
NEW = CFB_MAGIC + b"synthetic edited"
OTHER = CFB_MAGIC + b"synthetic unrelated"


def digest(data):
    return hashlib.sha256(data).hexdigest()


class NativeStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.allowed = self.root / "documents"
        self.second = self.root / "other-documents"
        self.outside = self.root / "outside"
        for path in (self.allowed, self.second, self.outside):
            path.mkdir()
        self.path = self.allowed / "source.hwp"
        self.path.write_bytes(OLD)
        self.backups = self.root / "backups"
        self.policy = PathPolicy([self.allowed, self.second])
        self.store = SafeStore(self.policy, self.backups)

    def snapshot(self):
        return self.store.read(self.path)

    def assert_no_temporary(self):
        self.assertEqual(list(self.allowed.glob(".hwp-save-*")), [])
        self.assertEqual(list(self.second.glob(".hwp-save-*")), [])

    def test_multiple_explicit_roots_without_fixed_workspace(self):
        other = self.second / "Another.HWP"
        other.write_bytes(OTHER)
        self.assertEqual(self.store.read(other).data, OTHER)
        receipt = self.store.save(self.snapshot(), NEW, output=self.second / "new.hwp")
        self.assertEqual(receipt.mode, "save_as")
        self.assertEqual(receipt.path.read_bytes(), NEW)
        self.assertEqual(self.path.read_bytes(), OLD)
        self.assertIsNone(receipt.backup_id)
        self.assert_no_temporary()

    def test_default_save_has_verified_recoverable_previous_version(self):
        receipt = self.store.save(self.snapshot(), NEW)
        self.assertEqual(receipt.mode, "save")
        self.assertEqual(receipt.sha256, digest(NEW))
        self.assertEqual(self.path.read_bytes(), NEW)
        self.assertRegex(receipt.backup_id, r"^[0-9a-f]{32}$")
        self.assertEqual((self.backups / (receipt.backup_id + ".hwp")).read_bytes(), OLD)
        self.assert_no_temporary()

    def test_same_path_explicit_output_is_ordinary_save(self):
        receipt = self.store.save(self.snapshot(), NEW, output=self.path)
        self.assertEqual(receipt.mode, "save")
        self.assertEqual(self.path.read_bytes(), NEW)

    def test_different_path_same_file_identity_cannot_claim_save_as(self):
        # Platform aliases such as Windows 8.3 names need inode/file-ID checking,
        # even when ordinary hardlink counts are one. Simulate that identity.
        target = self.second / "alias.hwp"
        target.write_bytes(OLD)
        with mock.patch.object(implementation.os.path, "samefile", return_value=True):
            with self.assertRaises(PathPolicyError):
                self.store.save(self.snapshot(), NEW, output=target,
                                expected_destination_sha256=digest(OLD))
        self.assertEqual(self.path.read_bytes(), OLD)
        self.assertEqual(target.read_bytes(), OLD)
        self.assertEqual(list(self.backups.iterdir()), [])

    def test_repeated_save_and_restore_preserve_each_version(self):
        first = self.store.save(self.snapshot(), NEW)
        second = self.store.save(self.snapshot(), OTHER)
        restored = self.store.restore(self.path, first.backup_id, digest(OTHER))
        self.assertEqual(self.path.read_bytes(), OLD)
        self.assertEqual((self.backups / (second.backup_id + ".hwp")).read_bytes(), NEW)
        self.assertEqual((self.backups / (restored.backup_id + ".hwp")).read_bytes(), OTHER)

    def test_existing_save_as_requires_explicit_destination_version(self):
        target = self.second / "existing.hwp"
        target.write_bytes(OTHER)
        source = self.snapshot()
        for expected in (None, digest(OLD)):
            with self.assertRaises(ConflictError):
                self.store.save(source, NEW, output=target, expected_destination_sha256=expected)
            self.assertEqual(target.read_bytes(), OTHER)
        receipt = self.store.save(source, NEW, output=target, expected_destination_sha256=digest(OTHER))
        self.assertEqual(receipt.mode, "save_as")
        self.assertEqual(target.read_bytes(), NEW)
        self.assertEqual(self.path.read_bytes(), OLD)
        self.assertEqual((self.backups / (receipt.backup_id + ".hwp")).read_bytes(), OTHER)

    def test_stale_source_fails_for_save_and_save_as(self):
        source = self.snapshot()
        self.path.write_bytes(OTHER)
        for output in (None, self.second / "new.hwp"):
            with self.assertRaises(ConflictError):
                self.store.save(source, NEW, output=output)
        self.assertEqual(self.path.read_bytes(), OTHER)
        self.assertFalse((self.second / "new.hwp").exists())
        self.assertEqual(list(self.backups.iterdir()), [])

    def test_bytes_and_signature_validation_do_not_change_source(self):
        for data in (b"", b"HWP", bytearray(NEW), "text", None):
            with self.subTest(data=type(data).__name__):
                with self.assertRaises(InvalidDocumentError):
                    self.store.save(self.snapshot(), data)
                self.assertEqual(self.path.read_bytes(), OLD)
        self.path.write_bytes(b"wrong signature")
        with self.assertRaises(InvalidDocumentError):
            self.store.read(self.path)

    def test_configured_storage_limit_rejects_read_before_opening_document(self):
        bounded = SafeStore(self.policy, self.backups, max_document_bytes=len(OLD) - 1)
        with mock.patch.object(implementation.os, "open", side_effect=AssertionError("must not open oversized source")):
            with self.assertRaises(InvalidDocumentError):
                bounded.read(self.path)
        self.assertEqual(self.path.read_bytes(), OLD)

    def test_storage_limit_rejects_edit_bytes_without_publication_or_backup(self):
        bounded = SafeStore(self.policy, self.backups, max_document_bytes=len(OLD))
        snapshot = bounded.read(self.path)
        oversized = CFB_MAGIC + b"oversized synthetic data" * 5
        for output in (None, self.second / "oversized.hwp"):
            with self.assertRaises(InvalidDocumentError):
                bounded.save(snapshot, oversized, output=output)
        self.assertEqual(self.path.read_bytes(), OLD)
        self.assertEqual(list(self.backups.iterdir()), [])
        self.assertFalse((self.second / "oversized.hwp").exists())
        self.assert_no_temporary()

    def test_restore_limit_rejects_oversized_backup_without_mutation(self):
        receipt = self.store.save(self.snapshot(), NEW)
        backup = self.backups / (receipt.backup_id + ".hwp")
        backup.write_bytes(CFB_MAGIC + b"large backup" * 10)
        bounded = SafeStore(self.policy, self.backups, max_document_bytes=max(len(OLD), len(NEW)))
        with self.assertRaises(BackupError):
            bounded.restore(self.path, receipt.backup_id, digest(NEW))
        self.assertEqual(self.path.read_bytes(), NEW)
        self.assert_no_temporary()

    def test_nonpositive_or_boolean_limits_are_rejected(self):
        for value in (0, -1, True, None, "16"):
            with self.assertRaises(ValueError):
                SafeStore(self.policy, self.backups, max_document_bytes=value)

    def test_outside_extensions_relative_and_traversal_are_rejected(self):
        unauthorized = self.outside / "document.hwp"
        unauthorized.write_bytes(OLD)
        directory = self.allowed / "directory.hwp"
        directory.mkdir()
        invalid = [unauthorized, Path("source.hwp"), self.allowed / ".." / "outside" / "document.hwp",
                   self.allowed / "source.docx", directory, self.allowed / "missing" / "child.hwp",
                   self.allowed / "bad\x00name.hwp"]
        if os.name == "nt":
            invalid.append(self.allowed / "source.hwp:hidden.hwp")
        for path in invalid:
            with self.subTest(path=str(path)):
                with self.assertRaises(PathPolicyError):
                    self.store.save(self.snapshot(), NEW, output=path)
        self.assertEqual(self.path.read_bytes(), OLD)
        self.assertEqual(unauthorized.read_bytes(), OLD)

    def test_invalid_roots_rejected(self):
        for roots in ([], [Path("relative")], [self.path], self.allowed):
            with self.assertRaises(PathPolicyError):
                PathPolicy(roots)

    def test_hardlink_alias_rejected_without_any_write(self):
        source = self.snapshot()
        alias = self.second / "alias.hwp"
        try:
            os.link(self.path, alias)
        except OSError as exc:
            self.skipTest("Hardlinks unavailable: " + str(exc))
        for output in (None, alias):
            with self.assertRaises(PathPolicyError):
                self.store.save(source, NEW, output=output, expected_destination_sha256=digest(OLD))
        self.assertEqual(self.path.read_bytes(), OLD)
        self.assertEqual(alias.read_bytes(), OLD)

    def test_symlink_to_outside_rejected(self):
        outside = self.outside / "document.hwp"
        outside.write_bytes(OLD)
        alias = self.allowed / "alias.hwp"
        try:
            alias.symlink_to(outside)
        except OSError as exc:
            self.skipTest("Symlinks unavailable: " + str(exc))
        with self.assertRaises(PathPolicyError):
            self.store.read(alias)
        with self.assertRaises(PathPolicyError):
            self.store.save(self.snapshot(), NEW, output=alias, expected_destination_sha256=digest(OLD))
        self.assertEqual(outside.read_bytes(), OLD)

    @unittest.skipUnless(os.name == "nt", "Windows junction case")
    def test_windows_junction_to_outside_rejected(self):
        junction = self.allowed / "junction"
        result = subprocess.run(["cmd", "/c", "mklink", "/J", str(junction), str(self.outside)],
                                capture_output=True, text=True)
        if result.returncode:
            self.skipTest("Junction creation unavailable")
        self.addCleanup(junction.rmdir)
        target = self.outside / "document.hwp"
        target.write_bytes(OLD)
        with self.assertRaises(PathPolicyError):
            self.store.read(junction / "document.hwp")
        with self.assertRaises(PathPolicyError):
            PathPolicy([junction])
        self.assertEqual(target.read_bytes(), OLD)

    def test_backup_failure_keeps_current_file_and_cleans_temporary(self):
        with mock.patch.object(self.store, "_backup", side_effect=BackupError("synthetic failure")):
            with self.assertRaises(BackupError):
                self.store.save(self.snapshot(), NEW)
        self.assertEqual(self.path.read_bytes(), OLD)
        self.assert_no_temporary()

    def test_backup_fsync_failure_cleans_owned_partial_backups(self):
        real_write = implementation._write_fd
        count = 0

        def failing_backup(fd, data):
            nonlocal count
            count += 1
            if count == 2:
                os.close(fd)
                raise OSError("synthetic backup write failure")
            real_write(fd, data)

        with mock.patch.object(implementation, "_write_fd", side_effect=failing_backup):
            with self.assertRaises(BackupError):
                self.store.save(self.snapshot(), NEW)
        self.assertEqual(self.path.read_bytes(), OLD)
        self.assertEqual(list(self.backups.iterdir()), [])
        self.assert_no_temporary()

    def test_replace_permission_failure_preserves_source_and_backup(self):
        with mock.patch.object(implementation.os, "replace", side_effect=PermissionError("locked")):
            with self.assertRaises(SaveError):
                self.store.save(self.snapshot(), NEW)
        self.assertEqual(self.path.read_bytes(), OLD)
        self.assertEqual(len(list(self.backups.glob("*.hwp"))), 1)
        self.assertEqual(next(self.backups.glob("*.hwp")).read_bytes(), OLD)
        self.assert_no_temporary()

    def test_temporary_fsync_failure_keeps_source(self):
        with mock.patch.object(implementation.os, "fsync", side_effect=OSError("disk full")):
            with self.assertRaises(SaveError):
                self.store.save(self.snapshot(), NEW)
        self.assertEqual(self.path.read_bytes(), OLD)
        self.assertEqual(list(self.backups.iterdir()), [])
        self.assert_no_temporary()

    def test_unsupported_new_file_publication_keeps_original(self):
        output = self.second / "new.hwp"
        with mock.patch.object(implementation.os, "link", side_effect=OSError("no hardlink support")):
            with self.assertRaises(SaveError):
                self.store.save(self.snapshot(), NEW, output=output)
        self.assertFalse(output.exists())
        self.assertEqual(self.path.read_bytes(), OLD)
        self.assert_no_temporary()

    def test_cleanup_failure_after_new_publication_is_reported_without_data_loss(self):
        output = self.second / "new.hwp"
        original_unlink = Path.unlink

        def deny_temp(path, *args, **kwargs):
            if path.name.startswith(".hwp-save-"):
                raise PermissionError("temporary name locked")
            return original_unlink(path, *args, **kwargs)

        with mock.patch.object(Path, "unlink", deny_temp):
            receipt = self.store.save(self.snapshot(), NEW, output=output)
        self.assertEqual(output.read_bytes(), NEW)
        self.assertEqual(self.path.read_bytes(), OLD)
        self.assertTrue(any("temporary cleanup failed" in warning for warning in receipt.durability_warnings))
        # An opaque leftover is recoverable, not silently removed by broad cleanup.
        leftovers = list(self.second.glob(".hwp-save-*"))
        self.assertEqual(len(leftovers), 1)
        with self.assertRaises(PathPolicyError):
            self.store.read(output)
        leftovers[0].unlink()
        self.assertEqual(self.store.read(output).data, NEW)

    def test_backup_creation_denied_before_replacement(self):
        real_open = os.open

        def deny_backup(path, flags, *args, **kwargs):
            if Path(path).parent == self.backups and flags & os.O_CREAT:
                raise PermissionError("backup directory denied")
            return real_open(path, flags, *args, **kwargs)

        with mock.patch.object(implementation.os, "open", side_effect=deny_backup):
            with self.assertRaises(BackupError):
                self.store.save(self.snapshot(), NEW)
        self.assertEqual(self.path.read_bytes(), OLD)
        self.assertEqual(list(self.backups.iterdir()), [])
        self.assert_no_temporary()

    def test_new_output_race_never_clobbers_existing_file(self):
        output = self.second / "new.hwp"
        real_link = os.link

        def race(source, target):
            target.write_bytes(OTHER)
            return real_link(source, target)

        with mock.patch.object(implementation.os, "link", side_effect=race):
            with self.assertRaises(ConflictError):
                self.store.save(self.snapshot(), NEW, output=output)
        self.assertEqual(output.read_bytes(), OTHER)
        self.assertEqual(self.path.read_bytes(), OLD)
        self.assert_no_temporary()

    def test_external_destination_change_during_backup_is_detected(self):
        real_backup = self.store._backup

        def race(snapshot):
            result = real_backup(snapshot)
            self.path.write_bytes(OTHER)
            return result

        with mock.patch.object(self.store, "_backup", side_effect=race):
            with self.assertRaises(ConflictError):
                self.store.save(self.snapshot(), NEW)
        self.assertEqual(self.path.read_bytes(), OTHER)
        self.assert_no_temporary()

    def test_same_process_concurrent_saves_have_one_cas_winner(self):
        snapshot = self.snapshot()
        other_store = SafeStore(self.policy, self.backups)

        def attempt(store, value):
            try:
                return store.save(snapshot, value)
            except ConflictError:
                return None

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(attempt, self.store, NEW), pool.submit(attempt, other_store, OTHER)]
            results = [future.result() for future in futures]
        self.assertEqual(sum(result is not None for result in results), 1)
        self.assertIn(self.path.read_bytes(), (NEW, OTHER))
        self.assertEqual(len(list(self.backups.glob("*.hwp"))), 1)
        self.assert_no_temporary()

    def test_restore_rejects_wrong_version_wrong_target_and_bad_id(self):
        receipt = self.store.save(self.snapshot(), NEW)
        another = self.second / "another.hwp"
        another.write_bytes(OTHER)
        with self.assertRaises(ConflictError):
            self.store.restore(self.path, receipt.backup_id, digest(OLD))
        with self.assertRaises(BackupError):
            self.store.restore(another, receipt.backup_id, digest(OTHER))
        for value in ("../source", "", "A" * 32, None):
            with self.assertRaises(BackupError):
                self.store.restore(self.path, value, digest(NEW))
        self.assertEqual(self.path.read_bytes(), NEW)
        self.assertEqual(another.read_bytes(), OTHER)

    def test_corrupt_backup_cannot_replace_current_file(self):
        receipt = self.store.save(self.snapshot(), NEW)
        (self.backups / (receipt.backup_id + ".hwp")).write_bytes(OTHER)
        with self.assertRaises(BackupError):
            self.store.restore(self.path, receipt.backup_id, digest(NEW))
        self.assertEqual(self.path.read_bytes(), NEW)

    @unittest.skipIf(os.name == "nt", "POSIX mode semantics only, not Windows ACLs")
    def test_posix_backup_owner_permissions_and_existing_mode_preserved(self):
        self.path.chmod(0o640)
        receipt = self.store.save(self.snapshot(), NEW)
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o640)
        self.assertEqual(stat.S_IMODE(self.backups.stat().st_mode), 0o700)
        for path in self.backups.iterdir():
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertIsNotNone(receipt.backup_id)


if __name__ == "__main__":
    unittest.main()
