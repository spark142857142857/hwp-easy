"""Command-line requests for one-hwp; never installs or enables an MCP server."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys
from typing import Any

from . import __version__

FORMATS = ("hwp", "hwpx", "pdf", "docx")


class RequestError(ValueError):
    """Invalid CLI request before any document operation."""


def _json_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise RequestError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def _finite_float(value):
    parsed = float(value)
    if not math.isfinite(parsed):
        raise RequestError("Non-finite JSON numbers are not supported")
    return parsed


def _nonfinite(value):
    raise RequestError(f"Non-finite JSON value: {value}")


def read_edit_manifest(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8-sig") as stream:
            request = json.load(stream, object_pairs_hook=_json_pairs,
                                parse_constant=_nonfinite, parse_float=_finite_float)
    except (OSError, UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        raise RequestError(f"Cannot read edit manifest: {exc}") from exc
    allowed = {"source", "output", "operations", "exports", "expected_sha256"}
    required = {"source", "output", "operations"}
    if not isinstance(request, dict):
        raise RequestError("Edit manifest must be a JSON object")
    if set(request) - allowed or required - set(request):
        raise RequestError(
            f"Edit manifest unknown fields: {sorted(set(request) - allowed)}; "
            f"missing fields: {sorted(required - set(request))}"
        )
    for field in ("source", "output"):
        if not isinstance(request[field], str) or not request[field]:
            raise RequestError(f"{field} must be a nonempty workspace-relative path string")
    if not isinstance(request["operations"], list) or not all(isinstance(value, dict) for value in request["operations"]):
        raise RequestError("operations must be an array of operation objects")
    if "exports" in request and (
        not isinstance(request["exports"], list) or not all(isinstance(value, dict) for value in request["exports"])
    ):
        raise RequestError("exports must be an array of export objects")
    if "expected_sha256" in request and not isinstance(request["expected_sha256"], str):
        raise RequestError("expected_sha256 must be a lowercase SHA-256 string")
    # The service validates paths, each operation/export, counts, and digests.
    return request


def _service_for(workspace: Path):
    from .service import HwpService

    return HwpService(workspace)


def error_result(exc: Exception) -> dict[str, Any]:
    return {"status": "error", "error": str(exc), "error_type": type(exc).__name__}


def _print_json(result, *, stream=None):
    print(json.dumps(result, ensure_ascii=True, allow_nan=False), file=stream or sys.stdout)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="one-hwp",
        description="Inspect/edit/export only explicit files within the specified local workspace.",
    )
    parser.add_argument("--version", action="version", version=__version__)
    parser.add_argument("--workspace", required=True, type=Path,
                        help="Existing authorized document workspace; document paths are relative to it")
    commands = parser.add_subparsers(dest="command", required=True)
    inspect_parser = commands.add_parser("inspect", help="Read document text/fields; does not write a document")
    inspect_parser.add_argument("source")
    edit_parser = commands.add_parser("edit", help="Apply a guarded JSON manifest into new output files")
    edit_parser.add_argument("--manifest", type=Path, required=True)
    export_parser = commands.add_parser("export", help="Export one source into a new file")
    export_parser.add_argument("source")
    export_parser.add_argument("output")
    export_parser.add_argument("--format", choices=FORMATS, required=True)
    export_parser.add_argument("--expected-sha256")
    commands.add_parser("doctor", help="Read platform/dependency/registration metadata without launching Hancom")
    commands.add_parser("serve", help="Run the optional MCP stdio server; never changes host configuration")
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "serve":
            from .mcp_server import create_server

            create_server(args.workspace).run(transport="stdio")
            return 0  # Protocol owns stdout; no CLI success record is printed.
        request = read_edit_manifest(args.manifest) if args.command == "edit" else None
        service = _service_for(args.workspace)
        if args.command == "inspect":
            result = service.inspect(args.source)
        elif args.command == "edit":
            result = service.edit(
                source=request["source"], output=request["output"], operations=request["operations"],
                exports=request.get("exports"), expected_sha256=request.get("expected_sha256"),
            )
        elif args.command == "export":
            result = service.export(
                source=args.source, output=args.output, format=args.format,
                expected_sha256=args.expected_sha256,
            )
        else:
            result = service.doctor()
        _print_json(result)
        return 0
    except Exception as exc:
        # Never write non-protocol messages to stdout while serving MCP.
        _print_json(error_result(exc), stream=sys.stderr if args.command == "serve" else sys.stdout)
        return 2 if isinstance(exc, RequestError) else 1


if __name__ == "__main__":
    raise SystemExit(main())
