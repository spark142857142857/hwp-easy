"""Independently decode synthetic HWP results from the installed runtime check."""
import io
import json
from pathlib import Path
import struct
import sys
import zlib
import olefile


def records(data):
    offset = 0
    while offset < len(data):
        header, = struct.unpack_from("<I", data, offset)
        offset += 4
        tag, level, size = header & 1023, (header >> 10) & 1023, header >> 20
        if size == 4095:
            size, = struct.unpack_from("<I", data, offset)
            offset += 4
        assert offset + size <= len(data)
        yield tag, level, data[offset:offset + size]
        offset += size
    assert offset == len(data)


def decode(data):
    streams = {}
    with olefile.OleFileIO(io.BytesIO(data)) as document:
        compressed = struct.unpack_from("<I", document.openstream("FileHeader").read(), 36)[0] & 1
        for name in document.listdir():
            value = document.openstream(name).read()
            if compressed and (name[0] == "BodyText" or name == ["DocInfo"]):
                value = zlib.decompress(value, -15)
            streams["/".join(name)] = value
    texts = []
    for tag, _, payload in records(streams["BodyText/Section0"]):
        if tag == 66:
            texts.append("")
        if tag == 67:
            offset, visible = 0, bytearray()
            while offset < len(payload):
                code, = struct.unpack_from("<H", payload, offset)
                width = 16 if 1 <= code <= 9 or code in (11, 12) or 14 <= code <= 23 else 2
                assert offset + width <= len(payload)
                if code >= 32 or code in (9, 10):
                    visible += payload[offset:offset + 2]
                offset += width
            texts[-1] += visible.decode("utf-16le")
    return streams, texts


folder = Path(sys.argv[1])
original = (folder / "synthetic-original.hwp").read_bytes()
edited = (folder / "synthetic-edited.hwp").read_bytes()
assert (folder / "synthetic-restored.hwp").read_bytes() == original
before_streams, before = decode(original)
after_streams, after = decode(edited)
assert set(before_streams) - {'PrvText', 'PrvImage'} == set(after_streams) - {'PrvText', 'PrvImage'}
assert "합성 답변 원문" in before and "중간 합성 문단" in before
assert "설치된 HWP Easy로 수정한 본문" in after
assert "첫째 답변" in after and "둘째 답변 😀" in after
assert "합성 답변 원문" not in after and "중간 합성 문단" not in after
assert len(after) == len(before) + 1
for text in ("첫 합성 문단", "마지막 합성 문단", "문항", "반복 문구"):
    assert before.count(text) == after.count(text)
for name in before_streams:
    if not name.startswith("BodyText/") and name not in ("DocInfo", "PrvText", "PrvImage"):
        assert before_streams[name] == after_streams[name]
for tag in (19, 21, 25):
    assert [(level, payload) for kind, level, payload in records(before_streams["DocInfo"]) if kind == tag] == [
        (level, payload) for kind, level, payload in records(after_streams["DocInfo"]) if kind == tag]
report = {"status": "PASS", "reader": "Python olefile and independent HWP record decoder",
          "body_and_cell_text_verified": True, "cell_line_break_creates_real_paragraph": True,
          "unrelated_text_and_streams_preserved": True, "existing_font_and_style_definitions_preserved": True,
          "restored_bytes_equal_original": True, "external_viewer_layout_verified": False}
(folder / "independent-verification.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report))
