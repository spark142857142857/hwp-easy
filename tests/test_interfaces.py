"""CLI/MCP facade tests. No Hancom process, personal files, or host config."""
from __future__ import annotations

import asyncio
from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest import mock

from one_hwp import cli, mcp_server


class InterfaceTests(unittest.TestCase):
    def setUp(self):
        workspace = tempfile.TemporaryDirectory(prefix="one-hwp-interface-")
        self.addCleanup(workspace.cleanup)
        self.workspace = Path(workspace.name)
        self.service = mock.Mock()
        self.service.inspect.return_value = {"status": "inspected", "text": "합성 본문"}
        self.service.edit.return_value = {"status": "edited", "layout_verified": False}
        self.service.export.return_value = {"status": "exported", "layout_verified": False}
        self.service.doctor.return_value = {"status": "diagnosed", "com_launched": False}

    def invoke(self, *arguments):
        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.object(cli, "_service_for", return_value=self.service) as factory:
            with redirect_stdout(stdout), redirect_stderr(stderr):
                code = cli.main(["--workspace", str(self.workspace), *arguments])
        return code, stdout.getvalue(), stderr.getvalue(), factory

    def manifest(self, value):
        path = self.workspace / "plan.json"
        path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        return path

    def plan(self):
        return {"source": "input.hwp", "output": "output.hwpx",
                "operations": [{"kind": "replace_text", "old": "원문", "new": "수정", "expected_count": 1}],
                "exports": [{"output": "review.pdf", "format": "pdf"}], "expected_sha256": "a" * 64}

    def test_inspect_routes_explicit_source_and_json_is_encoding_safe(self):
        code, stdout, stderr, factory = self.invoke("inspect", "합성.hwp")
        self.assertEqual(code, 0)
        self.assertTrue(stdout.isascii())
        self.assertEqual(json.loads(stdout)["text"], "합성 본문")
        self.assertEqual(stderr, "")
        factory.assert_called_once_with(self.workspace)
        self.service.inspect.assert_called_once_with("합성.hwp")
        self.service.edit.assert_not_called()

    def test_edit_routes_guarded_request_without_mutating_manifest(self):
        value = self.plan()
        path = self.manifest(value)
        before = path.read_bytes()
        code, stdout, _, _ = self.invoke("edit", "--manifest", str(path))
        self.assertEqual(code, 0)
        self.assertFalse(json.loads(stdout)["layout_verified"])
        self.service.edit.assert_called_once_with(**value)
        self.assertEqual(path.read_bytes(), before)

    def test_optional_edit_fields_remain_optional(self):
        value = self.plan()
        del value["exports"], value["expected_sha256"]
        code, _, _, _ = self.invoke("edit", "--manifest", str(self.manifest(value)))
        self.assertEqual(code, 0)
        self.service.edit.assert_called_once_with(**value, exports=None, expected_sha256=None)

    def test_export_routes_format_and_selected_digest(self):
        code, stdout, _, _ = self.invoke("export", "input.hwpx", "output.docx", "--format", "docx",
                                       "--expected-sha256", "b" * 64)
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(stdout)["status"], "exported")
        self.service.export.assert_called_once_with(source="input.hwpx", output="output.docx",
                                                   format="docx", expected_sha256="b" * 64)

    def test_doctor_only_calls_metadata_method(self):
        code, stdout, _, _ = self.invoke("doctor")
        self.assertEqual(code, 0)
        self.assertFalse(json.loads(stdout)["com_launched"])
        self.service.doctor.assert_called_once_with()
        self.service.inspect.assert_not_called()
        self.service.edit.assert_not_called()

    def test_unknown_manifest_fields_rejected_before_service_creation(self):
        value = self.plan()
        value["python_code"] = "do not execute"
        code, stdout, _, factory = self.invoke("edit", "--manifest", str(self.manifest(value)))
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(stdout)["status"], "error")
        factory.assert_not_called()

    def test_duplicate_json_keys_at_any_level_rejected(self):
        path = self.workspace / "invalid.json"
        path.write_text('{"source":"a.hwp","output":"b.hwp","operations":[{"kind":"replace_text","old":"a","old":"b"}]}',
                        encoding="utf-8")
        code, stdout, _, factory = self.invoke("edit", "--manifest", str(path))
        self.assertEqual(code, 2)
        self.assertIn("Duplicate", json.loads(stdout)["error"])
        factory.assert_not_called()

    def test_nonfinite_json_rejected(self):
        for value in ("NaN", "Infinity", "1e999"):
            with self.subTest(value=value):
                path = self.workspace / "invalid.json"
                path.write_text('{"source":"a.hwp","output":"b.hwp","operations":[{"expected_count":' + value + "}]}",
                                encoding="utf-8")
                code, _, _, factory = self.invoke("edit", "--manifest", str(path))
                self.assertEqual(code, 2)
                factory.assert_not_called()

    def test_manifest_outer_types_rejected(self):
        for field, invalid in (("source", True), ("output", []), ("operations", {}), ("exports", None),
                               ("expected_sha256", True)):
            with self.subTest(field=field):
                value = self.plan()
                value[field] = invalid
                code, _, _, factory = self.invoke("edit", "--manifest", str(self.manifest(value)))
                self.assertEqual(code, 2)
                factory.assert_not_called()

    def test_missing_manifest_has_json_input_error(self):
        code, stdout, _, factory = self.invoke("edit", "--manifest", str(self.workspace / "missing.json"))
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(stdout)["error_type"], "RequestError")
        factory.assert_not_called()

    def test_service_failure_is_not_success(self):
        self.service.export.side_effect = RuntimeError("simulated native failure")
        code, stdout, _, _ = self.invoke("export", "a.hwp", "b.pdf", "--format", "pdf")
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(stdout)["status"], "error")

    def test_serve_is_explicit_and_has_no_cli_stdout(self):
        server = mock.Mock()
        with mock.patch.object(mcp_server, "create_server", return_value=server):
            code, stdout, stderr, factory = self.invoke("serve")
        self.assertEqual(code, 0)
        self.assertEqual(stdout, "")
        self.assertEqual(stderr, "")
        factory.assert_not_called()
        server.run.assert_called_once_with(transport="stdio")

    def test_serve_error_goes_to_stderr_not_protocol_stdout(self):
        with mock.patch.object(mcp_server, "create_server", side_effect=RuntimeError("SDK not installed")):
            code, stdout, stderr, _ = self.invoke("serve")
        self.assertEqual(code, 1)
        self.assertEqual(stdout, "")
        self.assertEqual(json.loads(stderr)["status"], "error")

    def test_mcp_handlers_route_without_optional_sdk(self):
        handlers = mcp_server.tool_handlers(self.workspace, service=self.service)
        self.assertEqual(set(handlers), {"hwp_inspect", "hwp_edit", "hwp_export", "hwp_doctor"})
        handlers["hwp_inspect"]("a.hwp")
        handlers["hwp_edit"](**self.plan())
        handlers["hwp_export"]("a.hwp", "b.pdf", "pdf", "c" * 64)
        handlers["hwp_doctor"]()
        self.service.inspect.assert_called_once_with("a.hwp")
        self.service.edit.assert_called_once_with(**self.plan())
        self.service.export.assert_called_once_with(source="a.hwp", output="b.pdf", format="pdf",
                                                   expected_sha256="c" * 64)
        self.service.doctor.assert_called_once_with()

    def test_mcp_does_not_wrap_failed_operation_as_success(self):
        self.service.edit.side_effect = ValueError("wrong replacement count")
        handler = mcp_server.tool_handlers(self.workspace, service=self.service)["hwp_edit"]
        with self.assertRaises(ValueError):
            handler(**self.plan())

    def test_mcp_annotations_distinguish_readonly_and_fresh_output(self):
        for name in ("hwp_inspect", "hwp_doctor"):
            self.assertTrue(mcp_server.TOOL_METADATA[name]["readOnlyHint"])
        for name in ("hwp_edit", "hwp_export"):
            self.assertFalse(mcp_server.TOOL_METADATA[name]["readOnlyHint"])
            self.assertFalse(mcp_server.TOOL_METADATA[name]["destructiveHint"])
            self.assertFalse(mcp_server.TOOL_METADATA[name]["idempotentHint"])

    def test_sdk_facade_registers_only_fixed_tools_without_install_dependencies(self):
        class FakeServer:
            def __init__(self, name, **kwargs):
                self.name, self.settings, self.tools = name, kwargs, {}
            def add_tool(self, handler, *, name, description, annotations):
                self.tools[name] = (handler, description, annotations)

        modules = {name: ModuleType(name) for name in ("mcp", "mcp.server", "mcp.server.fastmcp", "mcp.types")}
        modules["mcp.server.fastmcp"].FastMCP = FakeServer
        modules["mcp.types"].ToolAnnotations = SimpleNamespace
        with mock.patch.dict("sys.modules", modules):
            server = mcp_server.create_server(self.workspace, service=self.service)
        self.assertEqual(server.name, "one-hwp")
        self.assertEqual(server.settings["dependencies"], ())
        self.assertEqual(set(server.tools), set(mcp_server.TOOL_METADATA))
        self.assertIn("explicit user authorization", server.settings["instructions"])
        self.assertTrue(server.tools["hwp_inspect"][2].readOnlyHint)
        self.assertFalse(server.tools["hwp_edit"][2].destructiveHint)
        self.assertEqual(server.tools["hwp_doctor"][0](), self.service.doctor.return_value)

    @unittest.skipUnless(importlib.util.find_spec("mcp"), "optional official MCP SDK not installed")
    def test_real_optional_sdk_lists_endpoint_annotations(self):
        server = mcp_server.create_server(self.workspace, service=self.service)
        tools = asyncio.run(server.list_tools())
        indexed = {tool.name: tool for tool in tools}
        self.assertEqual(set(indexed), set(mcp_server.TOOL_METADATA))
        self.assertTrue(indexed["hwp_inspect"].annotations.readOnlyHint)
        self.assertFalse(indexed["hwp_edit"].annotations.destructiveHint)
        self.assertFalse(indexed["hwp_export"].annotations.idempotentHint)


if __name__ == "__main__":
    unittest.main()
