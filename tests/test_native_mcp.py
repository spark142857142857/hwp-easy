"""Native MCP routing/privacy tests; no Hancom, host configuration or deployment.

Most tests inject a fake service/SDK. Optional real SDK tests verify registration
and error boundaries, not real HWP document fidelity or remote interoperability.
"""
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

from one_hwp import native_mcp
from one_hwp.native_storage import ConflictError, PathPolicyError


SDK_AVAILABLE = importlib.util.find_spec("mcp") is not None


class NativeMcpTests(unittest.TestCase):
    def setUp(self):
        self.service = mock.Mock()
        for method in ("capabilities", "read", "search", "plan", "edit", "preview", "restore"):
            getattr(self.service, method).return_value = {"operation": method, "layout_verified": False}
        self.handlers = native_mcp.tool_handlers(self.service)

    def fake_sdk(self):
        class FakeServer:
            def __init__(self, name, **kwargs):
                self.name, self.settings, self.tools = name, kwargs, {}
                self.runs = []

            def add_tool(self, handler, *, name, description, annotations):
                self.tools[name] = (handler, description, annotations)

            def run(self, *, transport):
                self.runs.append(transport)

        class FakeToolError(RuntimeError):
            pass

        names = ("mcp", "mcp.server", "mcp.server.fastmcp", "mcp.server.fastmcp.exceptions", "mcp.types")
        modules = {name: ModuleType(name) for name in names}
        modules["mcp.server.fastmcp"].FastMCP = FakeServer
        modules["mcp.server.fastmcp.exceptions"].ToolError = FakeToolError
        modules["mcp.types"].ToolAnnotations = SimpleNamespace
        return mock.patch.dict("sys.modules", modules)

    def test_only_seven_fixed_tools_and_no_legacy_export_or_code_tool(self):
        self.assertEqual(set(self.handlers), {"hwp_capabilities", "hwp_read", "hwp_search", "hwp_plan",
                                             "hwp_edit", "hwp_preview", "hwp_restore"})
        self.assertEqual(set(self.handlers), set(native_mcp.TOOL_METADATA))

    def test_capabilities_routes_without_opening_a_document(self):
        result = self.handlers["hwp_capabilities"]()
        self.assertEqual(result, self.service.capabilities.return_value)
        self.service.capabilities.assert_called_once_with()
        self.service.read.assert_not_called()

    def test_read_routes_default_and_continuation_without_write(self):
        self.handlers["hwp_read"]("C:/allowed/source.hwp")
        self.service.read.assert_called_once_with(source="C:/allowed/source.hwp", expected_sha256=None,
                                                 cursor=None, max_chars=8000)
        self.handlers["hwp_read"]("C:/allowed/source.hwp", "a" * 64, "opaque", 4000)
        self.service.read.assert_called_with(source="C:/allowed/source.hwp", expected_sha256="a" * 64,
                                            cursor="opaque", max_chars=4000)
        self.service.edit.assert_not_called()
        self.service.restore.assert_not_called()

    def test_search_and_plan_route_without_edit(self):
        self.handlers["hwp_search"]("source", "a" * 64, "query", "cursor", 4)
        self.service.search.assert_called_once_with(source="source", expected_sha256="a" * 64,
                                                   query="query", cursor="cursor", max_results=4)
        operations = [{"target_id": "version-bound", "expected_old": "old", "new_text": "new"}]
        self.handlers["hwp_plan"]("source", "a" * 64, operations)
        self.service.plan.assert_called_once_with(source="source", expected_sha256="a" * 64,
                                                 operations=operations)
        self.service.edit.assert_not_called()

    def test_edit_defaults_to_current_file_and_routes_save_as_only_when_explicit(self):
        operations = [{"target_id": "id", "expected_old": "old", "new_text": "new"}]
        self.handlers["hwp_edit"]("source", "a" * 64, operations, "request")
        self.service.edit.assert_called_once_with(source="source", expected_sha256="a" * 64,
                                                 operations=operations, request_id="request", output=None,
                                                 expected_destination_sha256=None)
        self.handlers["hwp_edit"]("source", "a" * 64, operations, "another", "output", "b" * 64)
        self.service.edit.assert_called_with(source="source", expected_sha256="a" * 64,
                                            operations=operations, request_id="another", output="output",
                                            expected_destination_sha256="b" * 64)

    def test_preview_and_restore_route_selected_version(self):
        self.handlers["hwp_preview"]("source", "a" * 64, 3)
        self.service.preview.assert_called_once_with(source="source", expected_sha256="a" * 64, page=3)
        self.handlers["hwp_restore"]("source", "opaque", "b" * 64)
        self.service.restore.assert_called_once_with(source="source", backup_id="opaque", expected_sha256="b" * 64)

    def test_read_only_annotations_and_destructive_save_restore_hints(self):
        for name, metadata in native_mcp.TOOL_METADATA.items():
            write = name in ("hwp_edit", "hwp_restore")
            self.assertEqual(metadata["readOnlyHint"], not write)
            self.assertEqual(metadata["destructiveHint"], write)
            self.assertEqual(metadata["idempotentHint"], not write)
            self.assertFalse(metadata["openWorldHint"])

    def test_upstream_failure_is_not_returned_as_success_or_leaked(self):
        secret = "PRIVATE_DOCUMENT_TEXT_AND_PATH"
        for error, category in ((RuntimeError(secret), "NativeMcpError"),
                                (PathPolicyError(secret), "PathPolicyError"),
                                (ConflictError(secret), "ConflictError")):
            self.service.read.side_effect = error
            stdout, stderr = io.StringIO(), io.StringIO()
            with redirect_stdout(stdout), redirect_stderr(stderr):
                with self.assertRaises(native_mcp.NativeMcpError) as captured:
                    self.handlers["hwp_read"]("source")
            self.assertEqual(captured.exception.kind, category)
            self.assertNotIn(secret, str(captured.exception))
            self.assertEqual(stdout.getvalue(), "")
            self.assertEqual(stderr.getvalue(), "")

    def test_fake_sdk_registers_fixed_tools_and_local_security_instructions(self):
        with self.fake_sdk():
            server = native_mcp.create_server(self.service)
        self.assertEqual(server.name, "hwp-easy")
        self.assertEqual(set(server.tools), set(self.handlers))
        self.assertEqual(server.settings["dependencies"], ())
        self.assertEqual(server.settings["log_level"], "WARNING")
        for fragment in ("explicitly requests", "untrusted data", "local stdio only", "process-local"):
            self.assertIn(fragment, server.settings["instructions"])
        self.assertTrue(server.tools["hwp_plan"][2].readOnlyHint)
        self.assertTrue(server.tools["hwp_edit"][2].destructiveHint)
        self.assertTrue(server.tools["hwp_restore"][2].destructiveHint)

    def test_server_rejects_unauthenticated_http_transport(self):
        with self.fake_sdk():
            server = native_mcp.create_server(self.service)
        for transport in ("sse", "streamable-http", "http"):
            with self.assertRaises(native_mcp.NativeMcpError):
                server.run(transport=transport)
        for method in (server.run_sse_async, server.run_streamable_http_async):
            with self.assertRaises(native_mcp.NativeMcpError):
                asyncio.run(method())
        self.assertEqual(server.runs, [])
        server.run(transport="stdio")
        self.assertEqual(server.runs, ["stdio"])

    def test_missing_optional_sdk_has_fixed_error_and_installs_nothing(self):
        missing = {"mcp": None, "mcp.server": None, "mcp.server.fastmcp": None,
                   "mcp.server.fastmcp.exceptions": None, "mcp.types": None}
        with mock.patch.dict("sys.modules", missing):
            with self.assertRaises(native_mcp.NativeMcpError) as captured:
                native_mcp.create_server(self.service)
        self.assertEqual(captured.exception.kind, "SetupError")
        self.service.capabilities.assert_not_called()

    def test_launcher_requires_explicit_roots_and_backups_and_never_logs_raw_arguments(self):
        secret = "PRIVATE_CONFIGURATION_ARGUMENT"
        for argv in ([], ["--allow-root", "path"], ["--allow-root", "path", "--backup-dir", "backup", secret]):
            stdout, stderr = io.StringIO(), io.StringIO()
            with mock.patch.object(native_mcp, "_create_service") as factory:
                with redirect_stdout(stdout), redirect_stderr(stderr):
                    result = native_mcp.main(argv)
            self.assertEqual(result, 1)
            self.assertEqual(stdout.getvalue(), "")
            self.assertNotIn(secret, stderr.getvalue())
            self.assertEqual(json.loads(stderr.getvalue())["error_type"], "SetupError")
            factory.assert_not_called()

    def test_launcher_routes_multiple_allowed_roots_and_stdio_only(self):
        server = mock.Mock()
        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.object(native_mcp, "_create_service", return_value=self.service) as factory:
            with mock.patch.object(native_mcp, "create_server", return_value=server) as create:
                with redirect_stdout(stdout), redirect_stderr(stderr):
                    result = native_mcp.main(["--allow-root", "one", "--allow-root", "two", "--backup-dir", "backups"])
        self.assertEqual(result, 0)
        factory.assert_called_once_with([Path("one"), Path("two")], Path("backups"))
        create.assert_called_once_with(self.service)
        server.run.assert_called_once_with(transport="stdio")
        self.assertEqual(stdout.getvalue(), "")
        self.assertEqual(stderr.getvalue(), "")

    def test_launcher_safe_error_on_stderr_without_protocol_stdout(self):
        for error in (RuntimeError("PRIVATE_DOCUMENT_TEXT"), PathPolicyError("PRIVATE_DOCUMENT_TEXT")):
            stdout, stderr = io.StringIO(), io.StringIO()
            with mock.patch.object(native_mcp, "_create_service", side_effect=error):
                with redirect_stdout(stdout), redirect_stderr(stderr):
                    result = native_mcp.main(["--allow-root", "one", "--backup-dir", "backups"])
            self.assertEqual(result, 1)
            self.assertEqual(stdout.getvalue(), "")
            self.assertNotIn("PRIVATE_DOCUMENT_TEXT", stderr.getvalue())
            self.assertEqual(json.loads(stderr.getvalue())["status"], "error")

    def test_default_service_factory_has_no_com_and_does_not_launch_engine(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            allowed = root / "documents"
            allowed.mkdir()
            with mock.patch.object(native_mcp, "RhwpEngine", return_value="engine") as engine:
                with mock.patch.object(native_mcp, "NativeService", return_value=self.service) as service:
                    result = native_mcp._create_service([allowed], root / "backups")
            self.assertIs(result, self.service)
            engine.assert_called_once_with()
            self.assertEqual(service.call_args.args[0], "engine")
            self.assertEqual(service.call_args.args[1].policy.allowed_roots, (allowed,))

    @unittest.skipUnless(SDK_AVAILABLE, "Optional MCP SDK not installed")
    def test_real_sdk_lists_annotations_and_typed_schemas(self):
        server = native_mcp.create_server(self.service)
        tools = asyncio.run(server.list_tools())
        indexed = {tool.name: tool for tool in tools}
        self.assertEqual(set(indexed), set(self.handlers))
        self.assertTrue(indexed["hwp_plan"].annotations.readOnlyHint)
        self.assertTrue(indexed["hwp_edit"].annotations.destructiveHint)
        self.assertFalse(indexed["hwp_edit"].annotations.idempotentHint)
        self.assertEqual(indexed["hwp_read"].inputSchema["properties"]["source"]["type"], "string")
        self.assertIn("request_id", indexed["hwp_edit"].inputSchema["required"])

    @unittest.skipUnless(SDK_AVAILABLE, "Optional MCP SDK not installed")
    def test_real_sdk_validation_does_not_echo_sensitive_input(self):
        server = native_mcp.create_server(self.service)
        secret = "PRIVATE_MALFORMED_ARGUMENT_CONTENT"
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            with self.assertRaises(Exception) as captured:
                asyncio.run(server.call_tool("hwp_read", {"source": "source", "max_chars": secret}))
        self.assertNotIn(secret, str(captured.exception))
        self.assertIn("RequestError", str(captured.exception))
        self.assertNotIn(secret, stderr.getvalue())
        self.assertEqual(stdout.getvalue(), "")
        self.service.read.assert_not_called()

    @unittest.skipUnless(SDK_AVAILABLE, "Optional MCP SDK not installed")
    def test_real_sdk_service_error_keeps_safe_category_without_original_message(self):
        self.service.read.side_effect = PathPolicyError("PRIVATE_PATH_AND_TEXT")
        server = native_mcp.create_server(self.service)
        with self.assertRaises(Exception) as captured:
            asyncio.run(server.call_tool("hwp_read", {"source": "source"}))
        self.assertIn("PathPolicyError", str(captured.exception))
        self.assertNotIn("PRIVATE_PATH_AND_TEXT", str(captured.exception))

    @unittest.skipUnless(SDK_AVAILABLE, "Optional MCP SDK not installed")
    def test_real_sdk_readonly_invalid_path_never_reaches_engine_or_writes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            allowed = root / "documents"
            allowed.mkdir()
            engine = mock.Mock()
            store = native_mcp.SafeStore(native_mcp.PathPolicy([allowed]), root / "backups")
            service = native_mcp.NativeService(engine, store)
            server = native_mcp.create_server(service)
            source = str(root / "PRIVATE_OUTSIDE_SOURCE.hwp")
            stdout, stderr = io.StringIO(), io.StringIO()
            with redirect_stdout(stdout), redirect_stderr(stderr):
                with self.assertRaises(Exception) as captured:
                    asyncio.run(server.call_tool("hwp_read", {"source": source}))
            self.assertIn("PathPolicyError", str(captured.exception))
            self.assertNotIn("PRIVATE_OUTSIDE_SOURCE", str(captured.exception))
            self.assertEqual(stdout.getvalue(), "")
            self.assertNotIn("PRIVATE_OUTSIDE_SOURCE", stderr.getvalue())
            engine.inspect.assert_not_called()
            engine.edit.assert_not_called()
            self.assertEqual(list(allowed.iterdir()), [])
            self.assertEqual(list(store.backup_dir.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
