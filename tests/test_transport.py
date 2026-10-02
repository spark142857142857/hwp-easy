"""Actual stdio handshake and safe error path; never launches Hancom."""
import asyncio
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest


@unittest.skipUnless(importlib.util.find_spec("mcp"), "optional MCP SDK not installed")
class StdioTests(unittest.TestCase):
    def test_stdio_doctor_and_invalid_source(self):
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        async def check(workspace):
            parameters = StdioServerParameters(
                command=sys.executable,
                args=["-m", "one_hwp.mcp_server", "--workspace", str(workspace)],
            )
            async with stdio_client(parameters) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    available = await session.list_tools()
                    self.assertEqual({tool.name for tool in available.tools}, {"hwp_inspect", "hwp_edit", "hwp_export", "hwp_doctor"})
                    doctor = await session.call_tool("hwp_doctor", {})
                    self.assertFalse(doctor.isError)
                    self.assertFalse(doctor.structuredContent["native_engine_tested"])
                    denied = await session.call_tool("hwp_inspect", {"source": "../outside.hwp"})
                    self.assertTrue(denied.isError)
                    self.assertEqual(list(Path(workspace).iterdir()), [])

        with tempfile.TemporaryDirectory() as workspace:
            asyncio.run(asyncio.wait_for(check(workspace), timeout=20))


if __name__ == "__main__":
    unittest.main()
