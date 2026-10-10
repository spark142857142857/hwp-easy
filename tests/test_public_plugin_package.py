"""Prevent private wiring or credentials from leaking through release packaging."""
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("public_plugin_package", ROOT / "scripts/package_public_plugin.py")
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class PublicPluginPackageTests(unittest.TestCase):
    def setUp(self):
        outputs = ROOT / "outputs"
        outputs.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="public-plugin-package-test-", dir=outputs)
        self.root = Path(self.temp.name).resolve()
        self.assertTrue(self.root.is_relative_to(outputs.resolve()))
        self.package = self.root / "package"
        shutil.copytree(packager.PACKAGE, self.package)

    def tearDown(self):
        self.assertTrue(self.root.is_relative_to((ROOT / "outputs").resolve()))
        self.temp.cleanup()

    def change(self, name, edit):
        path = self.package / name
        data = json.loads(path.read_text(encoding="utf-8"))
        edit(data)
        path.write_text(json.dumps(data), encoding="utf-8")

    def test_draft_contains_only_reviewable_public_files(self):
        self.change(".codex-plugin/plugin.json", lambda data:
                    data["extensions"]["com.openai"]["review"].pop("demo_recording_url", None))
        target = self.root / "draft.zip"
        report = packager.build(self.package, target, draft=True)
        self.assertEqual(report["public_publication"], "NOT_DONE")
        self.assertIn("demo_recording_url", report["missing_submission_metadata"])
        self.assertNotIn("oauth_client_registration", report["missing_submission_metadata"])
        with zipfile.ZipFile(target) as archive:
            self.assertEqual(set(archive.namelist()), set(packager.FILES))
            mcp = json.loads(archive.read(".mcp.json"))
            self.assertEqual(mcp["mcpServers"]["hwp-easy"]["extensions"]["com.openai"]["auth"]["type"], "oauth")

    def test_incomplete_submission_does_not_create_release_zip(self):
        self.change(".codex-plugin/plugin.json", lambda data:
                    data["extensions"]["com.openai"]["review"].pop("demo_recording_url", None))
        target = self.root / "release.zip"
        with self.assertRaisesRegex(ValueError, "metadata is incomplete"):
            packager.build(self.package, target)
        self.assertFalse(target.exists())

    def test_demo_url_does_not_make_unregistered_oauth_submittable(self):
        self.change(".mcp.json", lambda data:
                    data["mcpServers"]["hwp-easy"]["extensions"]["com.openai"]["auth"].pop("client"))
        self.change(".codex-plugin/plugin.json", lambda data:
                    data["extensions"]["com.openai"]["review"].update(
                        demo_recording_url="https://example.invalid/synthetic-demo"))
        _, _, missing = packager.inspect_package(self.package)
        self.assertEqual(missing, ["oauth_client_registration"])
        target = self.root / "release.zip"
        with self.assertRaisesRegex(ValueError, "metadata is incomplete"):
            packager.build(self.package, target)
        self.assertFalse(target.exists())

    def test_untested_client_declarations_are_rejected(self):
        for change in ({"clientId": "synthetic-other-client"},
                       {"tokenEndpointAuthMethod": "client_secret_basic"},
                       {"mode": "dcr"}):
            with self.subTest(change=change):
                self.change(".mcp.json", lambda data:
                            data["mcpServers"]["hwp-easy"]["extensions"]["com.openai"]["auth"].update(
                                client={**packager.VERIFIED_CLIENT, **change}))
                with self.assertRaisesRegex(ValueError, "tested public client"):
                    packager.inspect_package(self.package)

    def test_verified_client_cannot_be_reused_on_another_server(self):
        def relocate(data):
            server = data["mcpServers"]["hwp-easy"]
            server["url"] = "https://example.invalid/mcp"
            server["extensions"]["com.openai"]["auth"]["resource"] = server["url"]
        self.change(".mcp.json", relocate)
        with self.assertRaisesRegex(ValueError, "tested public client"):
            packager.inspect_package(self.package)

    def test_portable_archive_preserves_oauth_and_unicode(self):
        original = (self.package / ".codex-plugin/plugin.json").read_bytes()
        source = json.loads(original)
        target = self.root / "portable.zip"
        report = packager.build(self.package, target, draft=True, portable=True)
        self.assertEqual(report["portal_validation"], "NOT_RUN")
        self.assertEqual(report["public_publication"], "NOT_DONE")
        with zipfile.ZipFile(target) as archive:
            self.assertEqual(set(archive.namelist()), {"plugin.json", "mcp.json", "assets/hwp-easy.svg"})
            manifest = json.loads(archive.read("plugin.json"))
            self.assertNotIn("interface", manifest)
            self.assertNotIn("mcpServers", manifest)
            self.assertEqual(manifest["extensions"]["com.openai"]["interface"], source["interface"])
            self.assertEqual(manifest["author"]["name"], source["author"]["name"])
            self.assertEqual(manifest["extensions"]["com.openai"]["publication"],
                             source["extensions"]["com.openai"]["publication"])
            mcp = json.loads(archive.read("mcp.json"))
            self.assertEqual(mcp["$schema"], "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json")
            server = mcp["mcpServers"]["hwp-easy"]
            self.assertEqual(server["type"], "streamable-http")
            self.assertEqual(server["extensions"]["com.openai"]["auth"]["client"], packager.VERIFIED_CLIENT)
            self.assertNotIn("headers", server)
        self.assertEqual((self.package / ".codex-plugin/plugin.json").read_bytes(), original)

    def test_extra_private_file_is_never_packed(self):
        (self.package / ".env").write_text("synthetic=not-a-real-credential", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "only the declared"):
            packager.build(self.package, self.root / "bad.zip", draft=True)
        self.assertFalse((self.root / "bad.zip").exists())

    def test_bearer_header_is_rejected(self):
        self.change(".mcp.json", lambda data: data["mcpServers"]["hwp-easy"].update(headers={"Authorization": "Bearer synthetic"}))
        with self.assertRaisesRegex(ValueError, "without headers"):
            packager.inspect_package(self.package)

    def test_client_secret_and_reviewer_credentials_are_rejected(self):
        for key in ("clientSecret", "test_credentials", "reviewer_instructions"):
            with self.subTest(key=key):
                self.change(".codex-plugin/plugin.json", lambda data: data.update({key: "synthetic-only"}))
                with self.assertRaisesRegex(ValueError, "credential or reviewer"):
                    packager.inspect_package(self.package)
                self.change(".codex-plugin/plugin.json", lambda data: data.pop(key))

    def test_client_secret_in_mcp_auth_never_creates_an_archive(self):
        self.change(".mcp.json", lambda data:
                    data["mcpServers"]["hwp-easy"]["extensions"]["com.openai"]["auth"]["client"].update(
                        clientSecret="synthetic-only"))
        target = self.root / "bad.zip"
        with self.assertRaisesRegex(ValueError, "credential or reviewer"):
            packager.build(self.package, target, draft=True, portable=True)
        self.assertFalse(target.exists())

    def test_private_registered_app_and_hooks_are_rejected(self):
        for key in ("apps", "hooks"):
            with self.subTest(key=key):
                self.change(".codex-plugin/plugin.json", lambda data: data["extensions"]["com.openai"].update({key: "./private.json"}))
                with self.assertRaisesRegex(ValueError, "private apps or hooks"):
                    packager.inspect_package(self.package)
                self.change(".codex-plugin/plugin.json", lambda data: data["extensions"]["com.openai"].pop(key))

    def test_oauth_cannot_be_downgraded_or_resource_changed(self):
        self.change(".mcp.json", lambda data: data["mcpServers"]["hwp-easy"]["extensions"]["com.openai"]["auth"].update(type="none"))
        with self.assertRaisesRegex(ValueError, "exact OAuth resource"):
            packager.inspect_package(self.package)

    def test_external_icon_resources_are_rejected(self):
        (self.package / "assets/hwp-easy.svg").write_text('<svg><image href="https://example.invalid/pixel"/></svg>', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "no scripts or external resources"):
            packager.inspect_package(self.package)


if __name__ == "__main__":
    unittest.main()
