"""One-shot native worker. Never emit document content to stderr."""
import json
import sys

from .hancom import HancomBackend
from .service import run_document_job


def _cleanup_warnings(exc):
    """Serialize only known cleanup stages, never arbitrary exception notes.

    Follow a bounded exception chain because callers can wrap a backend error.
    The original note is not echoed: output is reconstructed from an allowlist.
    """
    prefix = "Private Hancom cleanup failed: "
    stages = ("clear", "quit", "COM uninitialize")
    warnings = []
    seen = set()
    current = exc
    for _ in range(8):
        if current is None or id(current) in seen:
            break
        seen.add(id(current))
        notes = getattr(current, "__notes__", None)
        if type(notes) is list:
            for note in notes[:32]:
                if type(note) is not str or len(note) > 128 or not note.startswith(prefix):
                    continue
                parts = note[len(prefix):].split(", ")
                if not parts or any(part not in stages for part in parts):
                    continue
                message = prefix + ", ".join(stage for stage in stages if stage in parts)
                if message not in warnings:
                    warnings.append(message)
        current = current.__cause__ or current.__context__
    return warnings


def main():
    try:
        payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        result = run_document_job(payload, HancomBackend)
        response = {"ok": True, "result": result}
        code = 0
    except Exception as exc:
        response = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        warnings = _cleanup_warnings(exc)
        if warnings:
            response["cleanup_warnings"] = warnings
            # Existing transport callers surface only response['error']; retain
            # safe diagnostics there too so cleanup failures cannot disappear.
            response["error"] += " | " + "; ".join(warnings)
        code = 1
    sys.stdout.buffer.write(json.dumps(response, ensure_ascii=False).encode("utf-8"))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
