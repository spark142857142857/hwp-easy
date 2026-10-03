"""Real generated HWP integration tests, opt-in to a pinned Node/WASM runtime.

These do not launch Hancom, use personal documents, or register an MCP server.
Unit tests below use a fake process only to check safe failure handling.
"""
from __future__ import annotations

import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from one_hwp.native_engine import EngineError, RhwpEngine, UnsupportedDocumentError


ROOT = Path(__file__).resolve().parents[1]
REAL_ENGINE = os.environ.get("HWP_EASY_NATIVE_TESTS") == "1"


def real_fixture(options=None):
    """Generate a genuine CFB/HWP 5 document entirely from synthetic source."""
    script = (
        'import {fixture} from "./tests/rhwp_fixtures.mjs";'
        'import fs from "node:fs";'
        'process.stdout.write(fixture(JSON.parse(fs.readFileSync(0,"utf8"))).toString("base64"));'
    )
    process = subprocess.run([shutil.which("node"), "--input-type=module", "-e", script],
                             input=json.dumps(options or {}), text=True, encoding="utf-8",
                             capture_output=True, cwd=ROOT, timeout=30, check=True)
    return base64.b64decode(process.stdout, validate=True)


def real_trailer_fixture():
    """Extend only stream padding of a generated HWP, using Node's stdlib."""
    script = (
        'import {fixture} from "./tests/rhwp_fixtures.mjs";'
        'import {withCheckedDeflateTrailers} from "./probes/sites-runtime/tests/trailer-fixtures.mjs";'
        'const bytes=withCheckedDeflateTrailers(fixture());'
        'process.stdout.write(Buffer.from(bytes).toString("base64"));'
    )
    process = subprocess.run([shutil.which("node"), "--input-type=module", "-e", script],
                             text=True, encoding="utf-8",
                             capture_output=True, cwd=ROOT, timeout=30, check=True)
    return base64.b64decode(process.stdout, validate=True)


class EngineFailureTests(unittest.TestCase):
    def test_no_runtime_does_not_install_or_start_anything(self):
        engine = RhwpEngine(node="unused")
        engine.node = None
        with self.assertRaises(EngineError):
            engine.capabilities()

    def test_upstream_error_text_is_not_forwarded(self):
        engine = RhwpEngine(node="unused")
        secret = "SYNTHETIC_PRIVATE_BODY_NOT_AN_ERROR_MESSAGE"
        result = subprocess.CompletedProcess([], 1, secret, secret)
        with mock.patch("one_hwp.native_engine.subprocess.run", return_value=result):
            with self.assertRaises(EngineError) as failure:
                engine.capabilities()
        self.assertNotIn(secret, str(failure.exception))

    def test_timeout_is_a_safe_failure(self):
        engine = RhwpEngine(node="unused")
        with mock.patch("one_hwp.native_engine.subprocess.run", side_effect=subprocess.TimeoutExpired([], 1)):
            with self.assertRaisesRegex(EngineError, "timed out"):
                engine.capabilities()

    def test_fixed_bridge_and_action_no_shell(self):
        result = subprocess.CompletedProcess([], 0, '{"ok":true,"result":{"engine":"test"}}', "")
        with mock.patch("one_hwp.native_engine.subprocess.run", return_value=result) as run:
            RhwpEngine(node="fixed-node").capabilities()
        args, kwargs = run.call_args
        self.assertEqual(args[0][0], "fixed-node")
        self.assertEqual(Path(args[0][-1]).name, "rhwp_bridge.mjs")
        self.assertNotIn("shell", kwargs)
        self.assertEqual(json.loads(kwargs["input"]), {"action": "capabilities"})


@unittest.skipUnless(REAL_ENGINE, "set HWP_EASY_NATIVE_TESTS=1 for real pinned WASM tests")
class RealEngineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = RhwpEngine()
        cls.bytes = real_fixture()

    def test_real_hwp_body_table_read_and_read_only_preview(self):
        before = hashlib.sha256(self.bytes).hexdigest()
        inspection = self.engine.inspect(self.bytes)
        self.assertEqual(inspection["unsupported"], [])
        self.assertIn("마지막 합성 문단", [block["text"] for block in inspection["blocks"]])
        self.assertEqual(len(inspection["tables"][0]["cells"]), 4)
        self.assertIn("<svg", self.engine.preview(self.bytes, 0)["svg"])
        self.assertEqual(hashlib.sha256(self.bytes).hexdigest(), before)

    def test_real_targeted_body_cell_edit_independent_cfb_stream_check(self):
        for options in ({}, {"bold": True, "table": False}, {"boldCell": True}, {"merged": True}):
            with self.subTest(options=options):
                data = self.bytes if not options else real_fixture(options)
                before = self.engine.inspect(data)
                targets = []
                for kind in ("paragraph", "cell"):
                    block = next((block for block in before["blocks"] if block["kind"] == kind and block["editable"]), None)
                    if block:
                        targets.append(block)
                if options.get("bold") or options.get("boldCell"):
                    self.assertTrue(any(block["style"]["char_shape_ids"] != [0] for block in targets))
                operations = [{"target_id": block["id"], "expected_old": block["text"], "new_text": "실제 수정 한글 😀"}
                              for block in targets]
                output = self.engine.edit(data, operations)
                after = self.engine.inspect(output)
                values = {block["id"]: block for block in after["blocks"]}
                for block in targets:
                    self.assertEqual(values[block["id"]]["text"], "실제 수정 한글 😀")
                    self.assertEqual(values[block["id"]]["style"], block["style"])
                self.assertEqual(after["tables"], before["tables"])

    def test_real_header_features_are_rejected_before_bridge(self):
        import olefile
        stream = io.BytesIO(self.bytes)
        with olefile.OleFileIO(stream, write_mode=True) as container:
            header = bytearray(container.openstream("FileHeader").read())
            struct.pack_into("<I", header, 36, struct.unpack_from("<I", header, 36)[0] | 2)
            container.write_stream("FileHeader", bytes(header))
        with self.assertRaises(UnsupportedDocumentError):
            self.engine.inspect(stream.getvalue())

    def test_real_checked_trailer_hwp_read_edit_save_restore(self):
        from one_hwp.native_service import NativeService
        from one_hwp.native_storage import PathPolicy, SafeStore
        data = real_trailer_fixture()
        original = self.engine.inspect(data)
        self.assertEqual(original["unsupported"], [])
        # Both body and DocInfo trailers reach the independent guards.
        self.assertIn("<svg", self.engine.preview(data, 0)["svg"])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "synthetic-trailer.hwp"
            source.write_bytes(data)
            service = NativeService(self.engine, SafeStore(PathPolicy([root]), root / "backup"))
            page = service.read(source)
            targets = [next(block for block in page["blocks"] if block["kind"] == kind and block["editable"])
                       for kind in ("paragraph", "cell")]
            operations = [{"target_id": block["target_id"], "expected_old": block["text"],
                           "new_text": "꼬리 정보 검증 후 합성 수정 😀"} for block in targets]
            self.assertFalse(service.plan(source, page["source_sha256"], operations)["write_performed"])
            saved = service.edit(source, page["source_sha256"], operations, "synthetic-trailer-save")
            self.assertEqual(saved["mode"], "save")
            after = self.engine.inspect(source.read_bytes())
            target_ids = {service._raw_id(target["target_id"], page["source_sha256"]) for target in targets}
            self.assertEqual(len(target_ids), 2)
            values = {block["id"]: block["text"] for block in after["blocks"]}
            for block in original["blocks"]:
                self.assertEqual(values[block["id"]], "꼬리 정보 검증 후 합성 수정 😀"
                                 if block["id"] in target_ids else block["text"])
            self.assertEqual(after["tables"], original["tables"])
            self.assertEqual(service.edit(source, page["source_sha256"], operations, "synthetic-trailer-save"), saved)
            service.restore(source, saved["backup_id"], saved["sha256"])
            self.assertEqual(source.read_bytes(), data)

    def test_real_large_single_paragraph_reads_to_end_without_mutation(self):
        from one_hwp.native_service import NativeService
        from one_hwp.native_storage import PathPolicy, SafeStore
        data = real_fixture({"table": False, "paragraphs": ["가" * 12_345, "마지막 확인 문단"]})
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "synthetic.hwp"
            source.write_bytes(data)
            service = NativeService(self.engine, SafeStore(PathPolicy([root]), root / "backup"))
            cursor, fragments = None, []
            for _ in range(30):
                page = service.read(source, cursor=cursor, max_chars=1000)
                fragments.extend(block["text"] for block in page["blocks"])
                cursor = page["next_cursor"]
                if page["complete"]:
                    break
            self.assertIsNone(cursor)
            self.assertEqual("".join(fragments), "가" * 12_345 + "마지막 확인 문단")
            self.assertEqual(source.read_bytes(), data)

    def test_real_service_default_save_save_as_restore_and_retries(self):
        from one_hwp.native_service import NativeService
        from one_hwp.native_storage import PathPolicy, SafeStore
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "synthetic.hwp"
            source.write_bytes(self.bytes)
            service = NativeService(self.engine, SafeStore(PathPolicy([root]), root / "backup"))
            page = service.read(source)
            block = next(item for item in page["blocks"] if item["editable"])
            operation = {"target_id": block["target_id"], "expected_old": block["text"], "new_text": "기본 저장 확인 😀"}
            plan = service.plan(source, page["source_sha256"], [operation])
            self.assertFalse(plan["write_performed"])
            self.assertEqual(source.read_bytes(), self.bytes)
            saved = service.edit(source, page["source_sha256"], [operation], "synthetic-save-1")
            self.assertEqual(saved["mode"], "save")
            self.assertEqual(service.edit(source, page["source_sha256"], [operation], "synthetic-save-1"), saved)
            current = source.read_bytes()
            page2 = service.read(source)
            block2 = next(item for item in page2["blocks"] if item["editable"])
            operation2 = {"target_id": block2["target_id"], "expected_old": block2["text"], "new_text": "별도 사본 확인"}
            output = root / "explicit-copy.hwp"
            copied = service.edit(source, page2["source_sha256"], [operation2], "synthetic-save-as", output=output)
            self.assertEqual(copied["mode"], "save_as")
            self.assertEqual(source.read_bytes(), current)
            service.restore(source, saved["backup_id"], saved["sha256"])
            self.assertEqual(source.read_bytes(), self.bytes)
            self.assertFalse(any(path.suffix.lower() in (".pdf", ".docx", ".hwpx") for path in root.rglob("*")))

    @unittest.skipUnless(importlib.util.find_spec("mcp"), "optional MCP SDK not installed")
    def test_real_stdio_mcp_read_plan_edit_preview_restore(self):
        import asyncio
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        async def check(root, source):
            parameters = StdioServerParameters(command=sys.executable,
                args=["-m", "one_hwp.native_mcp", "--allow-root", str(root), "--backup-dir", str(root / "backup")],
                env={**os.environ, "PYTHONPATH": str(ROOT / "src")})
            async with stdio_client(parameters) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    tools = {tool.name: tool for tool in (await session.list_tools()).tools}
                    self.assertTrue(tools["hwp_edit"].annotations.destructiveHint)
                    read_result = await session.call_tool("hwp_read", {"source": str(source)})
                    self.assertFalse(read_result.isError)
                    page = read_result.structuredContent
                    block = next(item for item in page["blocks"] if item["editable"])
                    operations = [{"target_id": block["target_id"], "expected_old": block["text"], "new_text": "MCP 실제 수정 😀"}]
                    planned = await session.call_tool("hwp_plan", {"source": str(source), "expected_sha256": page["source_sha256"], "operations": operations})
                    self.assertFalse(planned.isError)
                    edited = await session.call_tool("hwp_edit", {"source": str(source), "expected_sha256": page["source_sha256"],
                                                                  "operations": operations, "request_id": "stdio-synthetic"})
                    self.assertFalse(edited.isError)
                    saved = edited.structuredContent
                    preview = await session.call_tool("hwp_preview", {"source": str(source), "expected_sha256": saved["sha256"], "page": 0})
                    self.assertFalse(preview.isError)
                    self.assertIn("<svg", preview.structuredContent["svg"])
                    restored = await session.call_tool("hwp_restore", {"source": str(source), "backup_id": saved["backup_id"], "expected_sha256": saved["sha256"]})
                    self.assertFalse(restored.isError)
                    self.assertEqual(source.read_bytes(), self.bytes)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "synthetic.hwp"
            source.write_bytes(self.bytes)
            asyncio.run(asyncio.wait_for(check(root, source), timeout=60))


if __name__ == "__main__":
    unittest.main()
