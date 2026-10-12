"""Local installation preparation must preserve existing paths and reject bad ZIPs."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("local_marketplace", Path(__file__).resolve().parents[1] / "scripts/prepare_local_marketplace.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LocalMarketplaceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="hwp-easy-marketplace-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.destination = self.root / "local marketplace"
        self.archive = self.root / "plugin.zip"
        self.files = {
            "plugin.json": json.dumps({"name": "hwp-easy", "version": "0.2.15"}).encode(),
            "build-manifest.json": json.dumps({"package": "hwp-easy", "version": "0.2.15",
                "runner_sha256": hashlib.sha256(b"synthetic JS").hexdigest(),
                "wasm_sha256": hashlib.sha256(b"synthetic WASM").hexdigest()}).encode(),
            "skills/edit-local-hwp/agents/openai.yaml": b"policy:\n  allow_implicit_invocation: false\n",
            "skills/edit-local-hwp/SKILL.md": b"---\nname: edit-local-hwp\ndescription: Synthetic skill\n---\nRead references before editing.\n",
            "skills/edit-local-hwp/references/requests.md": b"Synthetic request reference",
            "skills/edit-local-hwp/references/editing.md": b"Synthetic editing reference",
            "skills/edit-local-hwp/scripts/local-runner.mjs": b"synthetic JS",
            "skills/edit-local-hwp/scripts/rhwp_bg.wasm": b"synthetic WASM",
        }

    def write_archive(self):
        with zipfile.ZipFile(self.archive, "w") as archive:
            for name, data in self.files.items():
                archive.writestr(name, data)

    def test_valid_package_produces_discoverable_catalog_without_installing(self):
        self.write_archive()
        report = module.prepare(self.archive, self.destination)
        catalog = json.loads((self.destination / ".agents/plugins/marketplace.json").read_text())
        plugin = self.destination / catalog["plugins"][0]["source"]["path"]
        self.assertTrue(plugin.is_dir())
        self.assertEqual((plugin / "skills/edit-local-hwp/scripts/local-runner.mjs").read_bytes(), b"synthetic JS")
        self.assertEqual(report["installation"], "NOT_RUN")
        self.assertFalse(report["global_configuration_changed"])

    def test_existing_destination_is_never_overwritten(self):
        self.destination.mkdir()
        marker = self.destination / "keep.txt"
        marker.write_text("existing installation")
        self.write_archive()
        with self.assertRaises(ValueError):
            module.prepare(self.archive, self.destination)
        self.assertEqual(marker.read_text(), "existing installation")

    def test_path_traversal_is_rejected_before_extracting_anything(self):
        self.files["../../outside.txt"] = b"must not escape"
        self.write_archive()
        with self.assertRaises(ValueError):
            module.prepare(self.archive, self.destination)
        self.assertFalse(self.destination.exists())
        self.assertFalse((self.root / "outside.txt").exists())

    def test_changed_runtime_hash_is_rejected_before_extracting(self):
        self.files["skills/edit-local-hwp/scripts/local-runner.mjs"] = b"changed JS"
        self.write_archive()
        with self.assertRaises(ValueError):
            module.prepare(self.archive, self.destination)
        self.assertFalse(self.destination.exists())


    def test_oversized_utf8_skill_is_rejected_before_extracting(self):
        # Fewer than 8000 characters can still exceed the host's byte limit.
        self.files["skills/edit-local-hwp/SKILL.md"] = ("한" * 2667).encode("utf-8")
        self.write_archive()
        with self.assertRaisesRegex(ValueError, "8000-byte"):
            module.prepare(self.archive, self.destination)
        self.assertFalse(self.destination.exists())

    def test_exact_prompt_byte_limit_is_accepted(self):
        self.files["skills/edit-local-hwp/SKILL.md"] = b"x" * 8000
        self.write_archive()
        module.prepare(self.archive, self.destination)
        self.assertEqual((self.destination / "plugins/hwp-easy/skills/edit-local-hwp/SKILL.md").stat().st_size, 8000)

    def test_missing_detailed_reference_is_rejected_before_extracting(self):
        del self.files["skills/edit-local-hwp/references/editing.md"]
        self.write_archive()
        with self.assertRaisesRegex(ValueError, "reference"):
            module.prepare(self.archive, self.destination)
        self.assertFalse(self.destination.exists())


if __name__ == "__main__":
    unittest.main()
