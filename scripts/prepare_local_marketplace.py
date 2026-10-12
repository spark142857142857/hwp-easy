"""Extract a release ZIP into a fresh local marketplace; does not install it."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile


def prepare(archive_path: Path, destination: Path) -> dict:
    if destination.exists():
        raise ValueError("Use a fresh destination; existing installations are preserved")
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or len(names) > 64:
            raise ValueError("Invalid package entries")
        for entry in archive.infolist():
            name = entry.filename
            if (name.startswith(("/", "\\")) or "\\" in name or ":" in name
                    or any(part in ("", ".", "..") for part in name.split("/"))
                    or (entry.external_attr >> 16) & 0o170000 == 0o120000
                    or entry.file_size > 16 * 1024 * 1024):
                raise ValueError("Unsafe package entry")
        if sum(entry.file_size for entry in archive.infolist()) > 32 * 1024 * 1024:
            raise ValueError("Package too large")
        metadata = json.loads(archive.read("plugin.json"))
        manifest = json.loads(archive.read("build-manifest.json"))
        if (metadata["name"] != "hwp-easy" or manifest["package"] != metadata["name"]
                or metadata["version"] != manifest["version"]):
            raise ValueError("Package identity mismatch")
        if any(name in names for name in ("mcp.json", ".mcp.json", ".app.json", "hooks/hooks.json")):
            raise ValueError("Local package must not configure remote services or hooks")
        policy = archive.read("skills/edit-local-hwp/agents/openai.yaml").decode("utf-8")
        if "allow_implicit_invocation: false" not in policy:
            raise ValueError("Explicit-only skill policy is required")
        for filename, field in (("local-runner.mjs", "runner_sha256"), ("rhwp_bg.wasm", "wasm_sha256")):
            content = archive.read(f"skills/edit-local-hwp/scripts/{filename}")
            if hashlib.sha256(content).hexdigest() != manifest[field]:
                raise ValueError("Runtime hash mismatch")
        # Every entry was checked before creating any files.
        plugin = destination / "plugins" / metadata["name"]
        plugin.mkdir(parents=True)
        archive.extractall(plugin)
    catalog = {"name": "hwp-easy", "interface": {"displayName": "HWP Easy"}, "plugins": [{
        "name": "hwp-easy", "source": {"source": "local", "path": "./plugins/hwp-easy"},
        "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
        "category": "Productivity"}]}
    catalog_path = destination / ".agents" / "plugins" / "marketplace.json"
    catalog_path.parent.mkdir(parents=True)
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"marketplace_root": str(destination.resolve()), "plugin": str(plugin.resolve()),
            "version": metadata["version"], "archive_sha256": hashlib.sha256(archive_path.read_bytes()).hexdigest(),
            "installation": "NOT_RUN", "global_configuration_changed": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    print(json.dumps(prepare(args.archive, args.destination)))
