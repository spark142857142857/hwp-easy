"""Internal differential oracle for generated synthetic HWP bytes only.

One stdin JSON batch and one captured stdout JSON response; no paths are
accepted, no documents are persisted, and no network or Hancom is used. The
Node caller generates the fixed corpus and consumes this machine response in
memory. Never print its stream payloads or exception details to a user log.
"""
from __future__ import annotations

import base64
import contextlib
import io
import json
from pathlib import Path
import struct
import sys


PROTOCOL = 1
MAX_BATCH_BYTES = 16 * 1024 * 1024
MAX_DOCUMENT_BYTES = 4 * 1024 * 1024
MAX_CASES = 20


def _records_json(records):
    return [[tag, level, base64.b64encode(payload).decode("ascii")]
            for tag, level, payload in records]


def _check_batch(request):
    # Imports stay inside the caught protocol boundary. A missing dependency
    # must not emit a traceback, environment path, or document exception.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
    import olefile
    from one_hwp.native_engine import RhwpEngine

    if (not isinstance(request, dict) or set(request) != {"protocol", "cases"}
            or request["protocol"] != PROTOCOL or not isinstance(request["cases"], list)
            or not 1 <= len(request["cases"]) <= MAX_CASES):
        raise ValueError()
    results = []
    for case in request["cases"]:
        if not isinstance(case, dict) or set(case) != {"data"} or not isinstance(case["data"], str):
            raise ValueError()
        data = base64.b64decode(case["data"], validate=True)
        if not 0 < len(data) <= MAX_DOCUMENT_BYTES:
            raise ValueError()
        # This is the original scanner with actual olefile, not a mocked CFB.
        profile = RhwpEngine._body_profile(data)
        streams = []
        sections = []
        docinfo_canonical = None
        with olefile.OleFileIO(io.BytesIO(data)) as container:
            header = container.openstream("FileHeader").read()
            compressed = bool(struct.unpack_from("<I", header, 36)[0] & 1)
            remaining = RhwpEngine.MAX_EXPANDED_BYTES
            for name in sorted(container.listdir()):
                source = container.openstream(name).read()
                raw = source
                if name == ["DocInfo"]:
                    docinfo_canonical = base64.b64encode(
                        RhwpEngine._docinfo_content(source, compressed)).decode("ascii")
                    raw = RhwpEngine._inflate(source, compressed, 8 * 1024 * 1024)
                elif name[0] == "BodyText":
                    raw = RhwpEngine._inflate(source, compressed, remaining)
                    remaining -= len(raw)
                    none = RhwpEngine._body_preservation_records(source, compressed, set())
                    count = sum(tag == 66 for tag, _, _ in none)
                    selectors = {"none": set(), "all": set(range(count)),
                                 "subset": set(range(0, count, 2))}
                    sections.append({
                        "section": int(name[1][7:]),
                        "paragraph_records": count,
                        "record_count": len(none),
                        "expanded_bytes": len(raw),
                        "canonical": {
                            selector: _records_json(none if selector == "none" else
                                RhwpEngine._body_preservation_records(source, compressed, targets))
                            for selector, targets in selectors.items()
                        },
                    })
                streams.append({"name": "/".join(name),
                                "bytes": base64.b64encode(raw).decode("ascii")})
        if docinfo_canonical is None:
            raise ValueError()
        sections.sort(key=lambda section: section["section"])
        results.append({"profile": profile, "streams": streams,
                        "sections": sections, "docinfo_canonical": docinfo_canonical})
    return {"protocol": PROTOCOL, "ok": True, "cases": results}


def main() -> int:
    try:
        raw = sys.stdin.buffer.read(MAX_BATCH_BYTES + 1)
        if len(raw) > MAX_BATCH_BYTES:
            raise ValueError()
        # Only the deliberate machine response leaves stdout. Internal prints,
        # warnings, and exception objects cannot become document/user logs.
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = _check_batch(json.loads(raw))
    except Exception:
        result = {"protocol": PROTOCOL, "ok": False, "code": "ORACLE_FAILED"}
    sys.stdout.write(json.dumps(result, ensure_ascii=True, separators=(",", ":")))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
