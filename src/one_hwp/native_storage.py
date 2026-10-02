"""Conservative local-file storage for the no-Hancom document service.

This is not a document parser, OS sandbox, or multi-user cloud store. CFB magic
is only a quick type check; a document engine must validate edited bytes before
calling ``save``. The process-wide lock serializes this module's reads/saves,
including different SafeStore instances. Hash and identity checks catch many
external changes, but stdlib filesystem replacement is not an atomic CAS against
another process writing after the final check. Use a trusted, non-shared local
directory; a cloud adapter needs its own authentication and transactional CAS.

Previous versions remain until an explicitly configured future retention policy
removes them. Backup IDs are random UUIDs, not paths or content-derived IDs.
No document text is logged. POSIX files are created owner-only; on Windows the
directory's inherited ACL applies, which this stdlib module cannot certify.
File fsync and atomic publication are attempted, not a universal crash-proof
guarantee. Directory fsync limitations are returned as durability warnings.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import threading
from typing import Iterable
import uuid


CFB_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_LOCK = threading.RLock()
_BACKUP_ID = re.compile(r"[0-9a-f]{32}\Z")
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")


class StorageError(Exception):
    """Safe storage operation failed; messages contain no document content."""


class PathPolicyError(StorageError):
    """A path, link, file type, or permission boundary is not allowed."""


class InvalidDocumentError(StorageError):
    """Bytes do not have the expected CFB signature (not full HWP validation)."""


class ConflictError(StorageError):
    """A document changed or an existing output was not authorized for replacement."""


class BackupError(StorageError):
    """A recoverable previous version could not be prepared or read."""


class SaveError(StorageError):
    """Publication failed before a successful atomic replacement."""


@dataclass(frozen=True)
class Snapshot:
    path: Path
    data: bytes
    sha256: str


@dataclass(frozen=True)
class SaveReceipt:
    path: Path
    sha256: str
    mode: str
    backup_id: str | None
    durability_warnings: tuple[str, ...] = ()


def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _document_bytes(data: bytes, *, max_bytes: int | None = None) -> None:
    if not isinstance(data, bytes) or not data.startswith(CFB_MAGIC):
        raise InvalidDocumentError("Expected immutable CFB document bytes")
    if max_bytes is not None and len(data) > max_bytes:
        raise InvalidDocumentError("Document exceeds the configured storage byte limit")


def _hash(value: str) -> str:
    if not isinstance(value, str) or _SHA256.fullmatch(value) is None:
        raise ConflictError("Expected a lowercase SHA-256 version")
    return value


def _absolute(value: Path | str) -> Path:
    try:
        path = Path(value)
    except (TypeError, ValueError) as exc:
        raise PathPolicyError("Expected an absolute filesystem path") from exc
    if (not path.is_absolute() or ".." in path.parts or "\x00" in str(path)
            or (os.name == "nt" and any(":" in part for part in path.parts[1:]))):
        raise PathPolicyError("Paths must be absolute without parent traversal")
    return Path(os.path.abspath(path))


def _key(path: Path) -> str:
    return os.path.normcase(str(path))


def _linked(info: os.stat_result) -> bool:
    # lstat's Windows reparse flag catches junctions as well as symlinks on 3.11.
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, "st_file_attributes", 0)
        & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    )


def _no_links(path: Path, *, allow_missing_leaf: bool = False) -> None:
    parts = [*reversed(path.parents), path]
    for index, part in enumerate(parts):
        try:
            info = part.lstat()
        except FileNotFoundError:
            if allow_missing_leaf and index == len(parts) - 1:
                return
            raise PathPolicyError("A required path component does not exist") from None
        except OSError as exc:
            raise PathPolicyError("Cannot inspect a path component") from exc
        if _linked(info):
            raise PathPolicyError("Symbolic links and reparse points are not allowed")
        if index != len(parts) - 1 and not stat.S_ISDIR(info.st_mode):
            raise PathPolicyError("Parent path components must be directories")


def _regular(info: os.stat_result) -> None:
    if _linked(info) or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise PathPolicyError("Expected a regular file with no hardlink aliases")


def _identity(info: os.stat_result) -> tuple[int, int, int, int]:
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns


class PathPolicy:
    """Explicit multiple-directory grant, without a fixed workspace convention.

    Existing symlinks/junctions, hardlinked files, directories named .hwp, and
    nonexistent intermediate directories are rejected. This does not protect
    against a hostile process racing directory replacement after checks.
    """

    def __init__(self, allowed_roots: Iterable[Path | str]):
        if isinstance(allowed_roots, (str, Path)):
            raise PathPolicyError("Provide an iterable of allowed directories")
        roots = tuple(_absolute(root) for root in allowed_roots)
        if not roots:
            raise PathPolicyError("At least one allowed directory is required")
        for root in roots:
            _no_links(root)
            if not root.is_dir():
                raise PathPolicyError("Allowed roots must be existing directories")
        self.allowed_roots = roots

    def check(self, value: Path | str, *, allow_missing: bool = False) -> Path:
        path = _absolute(value)
        if path.suffix.lower() != ".hwp":
            raise PathPolicyError("Only .hwp document paths are allowed")
        if not any(path.is_relative_to(root) for root in self.allowed_roots):
            raise PathPolicyError("Document is outside the explicitly allowed directories")
        _no_links(path, allow_missing_leaf=allow_missing)
        try:
            info = path.lstat()
        except FileNotFoundError:
            if allow_missing:
                return path
            raise PathPolicyError("Document does not exist") from None
        except OSError as exc:
            raise PathPolicyError("Cannot inspect document") from exc
        _regular(info)
        return path


def _read_file(path: Path, *, max_bytes: int | None = None) -> bytes:
    """Check before/after opening, without following leaf symlinks where supported."""
    _no_links(path)
    before = path.lstat()
    _regular(before)
    if max_bytes is not None and before.st_size > max_bytes:
        raise InvalidDocumentError("File exceeds the configured storage byte limit")
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    with os.fdopen(fd, "rb") as stream:
        opened = os.fstat(stream.fileno())
        _regular(opened)
        if _identity(opened) != _identity(before):
            raise ConflictError("File changed while opening")
        if max_bytes is not None and opened.st_size > max_bytes:
            raise InvalidDocumentError("File exceeds the configured storage byte limit")
        data = stream.read() if max_bytes is None else stream.read(max_bytes + 1)
        if max_bytes is not None and len(data) > max_bytes:
            raise InvalidDocumentError("File exceeds the configured storage byte limit")
        after_open = os.fstat(stream.fileno())
    _no_links(path)
    after_path = path.lstat()
    _regular(after_path)
    if _identity(after_open) != _identity(opened) or _identity(after_path) != _identity(opened):
        raise ConflictError("File changed while reading")
    return data


def _write_fd(fd: int, data: bytes) -> None:
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def _sync_directory(path: Path) -> tuple[str, ...]:
    if os.name == "nt":
        return ("Directory fsync is unavailable on this Windows stdlib path",)
    fd = None
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        os.fsync(fd)
    except OSError:
        return ("Directory fsync was not supported; crash durability is unverified",)
    finally:
        if fd is not None:
            os.close(fd)
    return ()


class SafeStore:
    """Recoverable local saves, requiring a configured private backup directory.

    A new output is atomically published by a no-clobber hardlink from a temporary
    file in the same directory, then the temporary name is removed. Filesystems
    without hardlink support fail rather than fall back to non-atomic copying.
    Existing files use os.replace. Retention/expiry and OS ACL management are not
    implemented; operators must protect and manage the configured backup folder.
    """

    def __init__(self, policy: PathPolicy, backup_dir: Path | str,
                 *, max_document_bytes: int = 16 * 1024 * 1024):
        if type(max_document_bytes) is not int or max_document_bytes < 1:
            raise ValueError("max_document_bytes must be a positive integer")
        self.policy = policy
        self.max_document_bytes = max_document_bytes
        self.backup_dir = _absolute(backup_dir)
        _no_links(self.backup_dir, allow_missing_leaf=True)
        try:
            self.backup_dir.mkdir(mode=0o700, exist_ok=True)
        except OSError as exc:
            raise BackupError("Cannot prepare the configured backup directory") from exc
        self._check_backup_directory()

    def _check_backup_directory(self) -> None:
        try:
            _no_links(self.backup_dir)
            if not self.backup_dir.is_dir():
                raise BackupError("Backup location is not a directory")
            if os.name != "nt" and stat.S_IMODE(self.backup_dir.stat().st_mode) & 0o077:
                raise BackupError("The backup directory must remain owner-only")
        except PathPolicyError as exc:
            raise BackupError("The backup directory is no longer safe") from exc

    def read(self, path: Path | str) -> Snapshot:
        with _LOCK:
            checked = self.policy.check(path)
            try:
                data = _read_file(checked, max_bytes=self.max_document_bytes)
            except OSError as exc:
                raise PathPolicyError("Cannot read the document") from exc
            _document_bytes(data, max_bytes=self.max_document_bytes)
            return Snapshot(checked, data, _digest(data))

    def _current(self, snapshot: Snapshot) -> Snapshot:
        if not isinstance(snapshot, Snapshot):
            raise ConflictError("A versioned document snapshot is required")
        _document_bytes(snapshot.data, max_bytes=self.max_document_bytes)
        if _digest(snapshot.data) != _hash(snapshot.sha256):
            raise ConflictError("Snapshot bytes do not match its version")
        current = self.read(snapshot.path)
        if current.sha256 != snapshot.sha256:
            raise ConflictError("Source document changed; read it again")
        return current

    def _backup(self, snapshot: Snapshot) -> tuple[str, tuple[str, ...]]:
        self._check_backup_directory()
        backup_id = uuid.uuid4().hex
        data_path = self.backup_dir / (backup_id + ".hwp")
        meta_path = self.backup_dir / (backup_id + ".json")
        created: list[Path] = []
        metadata = json.dumps(
            {"version": 1, "path": _key(snapshot.path), "sha256": snapshot.sha256},
            separators=(",", ":"),
        ).encode("utf-8")
        try:
            for path, data in ((data_path, snapshot.data), (meta_path, metadata)):
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
                created.append(path)
                _write_fd(fd, data)
            if _digest(_read_file(data_path, max_bytes=self.max_document_bytes)) != snapshot.sha256:
                raise BackupError("Backup verification failed")
            return backup_id, _sync_directory(self.backup_dir)
        except (OSError, StorageError) as exc:
            for path in created:
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    pass  # Never remove other files or attempt broad cleanup.
            if isinstance(exc, BackupError):
                raise
            raise BackupError("Could not secure a verified previous version") from exc

    def save(
        self,
        snapshot: Snapshot,
        data: bytes,
        *,
        output: Path | str | None = None,
        expected_destination_sha256: str | None = None,
    ) -> SaveReceipt:
        """Save current document by default, or an explicitly specified output.

        Replacing a separate existing output requires its expected hash. A stale
        source is rejected even for Save As. The input bytes must already have
        been independently validated by the caller's document engine.
        """
        _document_bytes(data, max_bytes=self.max_document_bytes)
        if expected_destination_sha256 is not None:
            _hash(expected_destination_sha256)
        with _LOCK:
            source = self._current(snapshot)
            target = self.policy.check(output if output is not None else source.path, allow_missing=True)
            same_file = _key(target) == _key(source.path)
            mode = "save" if same_file else "save_as"
            destination = self.read(target) if target.exists() else None
            if destination is not None and not same_file:
                try:
                    if os.path.samefile(target, source.path):
                        raise PathPolicyError("A separate output cannot alias the source document")
                except OSError as exc:
                    raise PathPolicyError("Cannot verify source/output separation") from exc
            if destination is not None:
                expected = source.sha256 if same_file else expected_destination_sha256
                if expected is None:
                    raise ConflictError("Existing output replacement requires its expected version")
                if destination.sha256 != expected:
                    raise ConflictError("Destination document changed; read it again")
                if same_file and expected_destination_sha256 not in (None, source.sha256):
                    raise ConflictError("Destination version does not match the current document")
            elif expected_destination_sha256 is not None:
                raise ConflictError("The expected destination no longer exists")

            temporary: Path | None = None
            backup_id: str | None = None
            warnings: tuple[str, ...] = ()
            try:
                fd, name = tempfile.mkstemp(prefix=".hwp-save-", suffix=".tmp", dir=target.parent)
                temporary = Path(name)
                _write_fd(fd, data)
                if _digest(_read_file(temporary, max_bytes=self.max_document_bytes)) != _digest(data):
                    raise SaveError("Temporary output verification failed")
                if destination is not None:
                    # Preserve existing POSIX permission bits, not Windows ACLs.
                    if os.name != "nt":
                        os.chmod(temporary, stat.S_IMODE(target.stat().st_mode))
                    backup_id, warnings = self._backup(destination)
                self._current(source)
                self.policy.check(target, allow_missing=True)
                if destination is not None:
                    if self.read(target).sha256 != destination.sha256:
                        raise ConflictError("Destination changed while preparing the save")
                    os.replace(temporary, target)
                    temporary = None
                else:
                    # Unlike replace(), this refuses a file created by a racing writer.
                    try:
                        os.link(temporary, target)
                    except FileExistsError as exc:
                        raise ConflictError("The new output already exists") from exc
                    try:
                        temporary.unlink()
                        temporary = None
                    except OSError:
                        warnings += (
                            "Output was published but temporary cleanup failed; its hardlink alias may block future access",
                        )
                warnings += _sync_directory(target.parent)
                if os.name == "nt":
                    warnings += ("Windows inherited file ACLs were not independently verified",)
                return SaveReceipt(target, _digest(data), mode, backup_id, tuple(dict.fromkeys(warnings)))
            except OSError as exc:
                raise SaveError("Could not atomically publish the document") from exc
            finally:
                if temporary is not None:
                    try:
                        temporary.unlink(missing_ok=True)
                    except OSError:
                        # A successful new-file publication can leave a private temp
                        # name if the filesystem refuses cleanup. Do not erase output.
                        pass

    def restore(self, path: Path | str, backup_id: str, expected_sha256: str) -> SaveReceipt:
        """Restore a backup only to its bound document, preserving today's version."""
        _hash(expected_sha256)
        if not isinstance(backup_id, str) or _BACKUP_ID.fullmatch(backup_id) is None:
            raise BackupError("Invalid opaque backup identifier")
        with _LOCK:
            current = self.read(path)
            if current.sha256 != expected_sha256:
                raise ConflictError("Document changed before restoration")
            self._check_backup_directory()
            try:
                metadata = json.loads(_read_file(self.backup_dir / (backup_id + ".json"), max_bytes=65_536))
                data = _read_file(self.backup_dir / (backup_id + ".hwp"), max_bytes=self.max_document_bytes)
                if (not isinstance(metadata, dict) or metadata.get("version") != 1
                        or metadata.get("path") != _key(current.path)
                        or metadata.get("sha256") != _digest(data)):
                    raise BackupError("Backup is damaged or belongs to another document")
                _document_bytes(data, max_bytes=self.max_document_bytes)
            except (OSError, ValueError, StorageError) as exc:
                if isinstance(exc, BackupError):
                    raise
                raise BackupError("Cannot read a verified backup") from exc
            return self.save(current, data)
