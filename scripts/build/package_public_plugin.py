"""Build an allowlisted MCP-only draft ZIP; this is not portal certification."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
from urllib.parse import urlsplit
import zipfile

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = ROOT / "plugins" / "archive" / "hwp-easy-remote-0.1.9"
FILES = (".codex-plugin/plugin.json", ".mcp.json", "assets/hwp-easy.svg")
# Public identifier returned by Sites. Actual consent, callback and discovery
# succeeded with this declaration on 2026-10-10; it is not a client secret.
VERIFIED_RESOURCE = "https://hwp-easy-runtime-probe.spark142857.chatgpt.site/mcp"
VERIFIED_CLIENT = {
    "mode": "provided",
    "clientId": "oaiapp_595af3501ec716497612db5ef56aabf1c19b06de27ad52cd7137ce0b55223934",
    "tokenEndpointAuthMethod": "none",
}
FORBIDDEN_KEYS = {"clientSecret", "test_credentials", "reviewer_instructions",
                  "password", "access_token", "refresh_token", "cookie"}
SECRET = re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}")


def public_https(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        url = urlsplit(value)
        return bool(url.scheme == "https" and url.hostname and not url.username
                    and not url.password and not url.fragment and url.port in (None, 443))
    except ValueError:
        return False


def check_secrets(value: object) -> None:
    if isinstance(value, dict):
        if FORBIDDEN_KEYS.intersection(value):
            raise ValueError("Private credential or reviewer field is not allowed in the public ZIP")
        for item in value.values():
            check_secrets(item)
    elif isinstance(value, list):
        for item in value:
            check_secrets(item)
    elif isinstance(value, str) and SECRET.search(value):
        raise ValueError("Credential-like content is not allowed in the public ZIP")


def inspect_package(package: Path) -> tuple[dict, dict, list[str]]:
    package = package.absolute()
    actual = set()
    for path in package.rglob("*"):
        if path.is_symlink():
            raise ValueError("Symlinks are not allowed in the package")
        if path.is_file():
            actual.add(path.relative_to(package).as_posix())
    if actual != set(FILES):
        raise ValueError("Package must contain only the declared manifest, MCP config and icon")
    manifest = json.loads((package / ".codex-plugin/plugin.json").read_text(encoding="utf-8"))
    mcp = json.loads((package / ".mcp.json").read_text(encoding="utf-8"))
    check_secrets(manifest)
    check_secrets(mcp)
    if manifest.get("name") != "hwp-easy-public" or not re.fullmatch(r"\d+\.\d+\.\d+", manifest.get("version", "")):
        raise ValueError("Invalid plugin identity or version")
    if "$schema" in manifest or "$schema" in mcp or manifest.get("mcpServers") != "./.mcp.json":
        raise ValueError("Use the documented Codex compatibility manifest and MCP mapping")
    if not isinstance(manifest.get("author", {}).get("name"), str):
        raise ValueError("A draft author label is required; verified publisher metadata is checked separately")
    openai = manifest["extensions"]["com.openai"]
    if any(key in openai or key in manifest for key in ("apps", "hooks")):
        raise ValueError("Public package must not include registered private apps or hooks")
    servers = mcp.get("mcpServers")
    if not isinstance(servers, dict) or set(servers) != {"hwp-easy"}:
        raise ValueError("One HWP Easy server is required")
    server = servers["hwp-easy"]
    if set(server) != {"url", "extensions"} or not public_https(server["url"]):
        raise ValueError("Only a remote HTTPS MCP server without headers is allowed")
    auth = server["extensions"]["com.openai"]["auth"]
    if (set(auth) not in ({"type", "resource"}, {"type", "resource", "client"})
            or auth["type"] != "oauth" or auth["resource"] != server["url"]):
        raise ValueError("Preserve exact OAuth resource; do not guess client credentials or endpoints")
    if "client" in auth and (auth["resource"] != VERIFIED_RESOURCE or auth["client"] != VERIFIED_CLIENT):
        raise ValueError("Only the consent-and-discovery-tested public client declaration is allowed")
    interface = manifest["interface"]
    for field, maximum in (("displayName", 30), ("shortDescription", 30), ("longDescription", 4000)):
        value = interface.get(field)
        if not isinstance(value, str) or not value.strip() or len(value) > maximum:
            raise ValueError("Missing or oversized listing text: " + field)
    if interface.get("composerIcon") != "./assets/hwp-easy.svg" or interface.get("logo") != "./assets/hwp-easy.svg":
        raise ValueError("Icon paths must point at the included asset")
    icon = (package / "assets/hwp-easy.svg").read_text(encoding="utf-8")
    if any(text in icon.lower() for text in ("<script", "<foreignobject", "href=", "url(")):
        raise ValueError("The icon must contain no scripts or external resources")
    cases = openai["review"]["test_cases"]
    if len(cases.get("positive", [])) != 5 or len(cases.get("negative", [])) != 3:
        raise ValueError("Exactly five positive and three negative review cases are required")
    for case in cases["positive"]:
        if not all(isinstance(case.get(field), str) and case[field].strip()
                   for field in ("description", "prompt", "tools_triggered", "expected_behavior")):
            raise ValueError("Incomplete positive review case")
    # This guard recognizes the tested declaration, not a live connection or
    # inspection of the provider's client registry. URLs alone are insufficient.
    missing = [] if "client" in auth else ["oauth_client_registration"]
    if not isinstance(interface.get("developerName"), str) or not interface["developerName"].strip():
        missing.append("verified_publisher_display_name")
    for field in ("websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"):
        if not public_https(interface.get(field)):
            missing.append(field)
    if not public_https(openai["review"].get("demo_recording_url")):
        missing.append("demo_recording_url")
    return manifest, mcp, missing


def build(package: Path, destination: Path, *, draft: bool = False, portable: bool = False) -> dict:
    manifest, mcp, missing = inspect_package(package)
    if missing and not draft:
        raise ValueError("Submission metadata is incomplete; use --draft to prepare a non-submittable archive")
    destination = destination.absolute()
    if destination.suffix != ".zip" or destination.is_relative_to(package.resolve()):
        raise ValueError("Output must be a ZIP outside the package source")
    destination.parent.mkdir(parents=True, exist_ok=True)
    entries = {name: (package / name).read_bytes() for name in FILES}
    if portable:
        # The portal accepted and connected this documented layout. Keep the
        # source in Codex compatibility format, with one validated conversion.
        manifest["extensions"]["com.openai"]["interface"] = manifest.pop("interface")
        manifest.pop("mcpServers")
        manifest["$schema"] = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
        mcp["mcpServers"]["hwp-easy"]["type"] = "streamable-http"
        mcp["$schema"] = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"
        entries = {"plugin.json": (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
                   "mcp.json": (json.dumps(mcp, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
                   "assets/hwp-easy.svg": entries["assets/hwp-easy.svg"]}
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    with zipfile.ZipFile(destination) as archive:
        if tuple(archive.namelist()) != tuple(entries) or archive.testzip() is not None:
            raise ValueError("Archive verification failed")
    return {"package": manifest["name"], "version": manifest["version"],
            "archive": str(destination), "files": list(entries), "draft": draft,
            "format": "portable" if portable else "codex",
            "missing_submission_metadata": missing,
            "portal_validation": "NOT_RUN", "public_publication": "NOT_DONE",
            "note": "Structure and archive checks only. URL accessibility, verified identity, OAuth, reviewer accounts and approval require separate evidence."}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--draft", action="store_true")
    parser.add_argument("--portable", action="store_true", help="Prepare the portal-tested root plugin.json/mcp.json layout")
    parser.add_argument("--output", type=Path, default=ROOT / "outputs" / "public-plugin-20261010" / "hwp-easy-draft.zip")
    args = parser.parse_args()
    try:
        report = build(PACKAGE, args.output, draft=args.draft, portable=args.portable)
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(2, f"Package rejected: {error}\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
