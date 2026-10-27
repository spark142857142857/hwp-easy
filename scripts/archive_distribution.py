"""Archive an audited marketplace and npm tarball into a fresh release asset folder."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import tarfile
import zipfile


def archive_release(marketplace: Path, npm_tarball: Path, plugin_zip: Path, output: Path):
    metadata = json.loads((marketplace / "package.json").read_text(encoding="utf-8"))
    version = metadata["version"]
    assert re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", version)
    manifest = json.loads((marketplace / "release-manifest.json").read_text(encoding="utf-8"))
    assert metadata["name"] == "hwp-easy" and manifest["version"] == version
    files = [".agents/plugins/marketplace.json", ".gitattributes", "LICENSE", "README.md", "package.json",
             "release-manifest.json", "bin/hwp-easy.mjs", "lib/plugin.mjs", "lib/install.mjs",
             *("plugins/hwp-easy/" + name for name in manifest["plugin_files"])]
    assert len(files) == 34 and len(set(files)) == 34
    for name in files:
        assert not name.startswith("/") and "\\" not in name and ":" not in name
        assert all(part not in ("", ".", "..") for part in name.split("/"))
        assert all(not (marketplace / Path(*Path(name).parts[:index])).is_symlink()
                   for index in range(1, len(Path(name).parts) + 1))
    for name, digest in manifest["plugin_files"].items():
        assert hashlib.sha256((marketplace / "plugins/hwp-easy" / name).read_bytes()).hexdigest() == digest
    with zipfile.ZipFile(plugin_zip) as plugin:
        assert set(plugin.namelist()) == set(manifest["plugin_files"])
        assert all(plugin.read(name) == (marketplace / "plugins/hwp-easy" / name).read_bytes() for name in plugin.namelist())
    with tarfile.open(npm_tarball) as tar:
        members = tar.getmembers()
        expected = {"package/" + name for name in files if name != ".gitattributes"}
        assert {member.name for member in members} == expected
        assert all(member.isfile() for member in members)
        assert all(tar.extractfile(member).read() == (marketplace / member.name.removeprefix("package/")).read_bytes() for member in members)
    output.mkdir()
    marketplace_zip = output / f"hwp-easy-marketplace-{version}.zip"
    with zipfile.ZipFile(marketplace_zip, "w", compression=zipfile.ZIP_DEFLATED) as result:
        for name in files:
            assert not (marketplace / name).is_symlink()
            result.writestr(name, (marketplace / name).read_bytes())
    shutil.copyfile(npm_tarball, output / f"hwp-easy-{version}.tgz")
    shutil.copyfile(plugin_zip, output / f"hwp-easy-{version}.zip")
    shutil.copyfile(marketplace / "release-manifest.json", output / "release-manifest.json")
    sums = {file.name: hashlib.sha256(file.read_bytes()).hexdigest() for file in sorted(output.iterdir())}
    (output / "SHA256SUMS").write_text("".join(f"{digest}  {name}\n" for name, digest in sums.items()), encoding="utf-8")
    return {"directory": str(output.resolve()), "version": version, "sha256": sums, "publication": "NOT_RUN"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["marketplace", "npm_tarball", "plugin_zip", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    print(json.dumps(archive_release(args.marketplace, args.npm_tarball, args.plugin_zip, args.output)))
