"""Archive the allowlisted generated local skill candidate; never submits it."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "outputs/local-plugin-20261011/hwp-easy-local"
SKILL = "skills/edit-local-hwp"
FILES = ("LICENSE", "plugin.json", "build-manifest.json", f"{SKILL}/SKILL.md", f"{SKILL}/agents/openai.yaml",
         f"{SKILL}/references/requests.md", f"{SKILL}/scripts/local-runner.mjs", f"{SKILL}/scripts/rhwp_bg.wasm",
         *(f"{SKILL}/scripts/{name}" for name in ("RHWP-LICENSE.txt", "RHWP-THIRD-PARTY-LICENSES.md", "PAKO-LICENSE.txt",
                                                  "PAKO-ZLIB-LICENSE.txt", "THIRD-PARTY-NOTICES.json")),
         *(f"licenses/{name}" for name in ("THIRD_PARTY_NOTICES.md", "RHWP-LICENSE.txt", "RHWP-THIRD-PARTY-LICENSES.md",
                                           "PAKO-LICENSE.txt", "PAKO-ZLIB-LICENSE.txt", "CFB-LICENSE.txt")))
manifest = json.loads((PACKAGE / "build-manifest.json").read_text(encoding="utf-8"))
version = manifest["version"]
assert len(version.split(".")) == 3 and all(part.isdecimal() for part in version.split("."))
assert json.loads((PACKAGE / "plugin.json").read_text(encoding="utf-8"))["version"] == version
assert hashlib.sha256((PACKAGE / 'licenses/CFB-LICENSE.txt').read_text(encoding='utf-8').replace('\r\n', '\n').encode()).hexdigest() == manifest['local_cfb_writer']['license_sha256_lf']
DESTINATION = PACKAGE.parent / f"hwp-easy-local-{version}.zip"
for filename, field in ((f"{SKILL}/scripts/local-runner.mjs", "runner_sha256"), (f"{SKILL}/scripts/rhwp_bg.wasm", "wasm_sha256")):
    assert hashlib.sha256((PACKAGE / filename).read_bytes()).hexdigest() == manifest[field]
assert all(not (PACKAGE / name).is_symlink() and (PACKAGE / name).is_file() for name in FILES)
with zipfile.ZipFile(DESTINATION, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for name in FILES:
        archive.writestr(name, (PACKAGE / name).read_bytes())
with zipfile.ZipFile(DESTINATION) as archive:
    assert archive.testzip() is None and tuple(archive.namelist()) == FILES
    assert all(archive.read(name) == (PACKAGE / name).read_bytes() for name in FILES)
print(json.dumps({"archive": str(DESTINATION), "files": len(FILES), "bytes": DESTINATION.stat().st_size,
                  "sha256": hashlib.sha256(DESTINATION.read_bytes()).hexdigest(),
                  "installation": "NOT_RUN", "submission": "NOT_RUN"}))
