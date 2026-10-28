"""Independent olefile/record read of the fixed packaged synthetic round trip."""
from pathlib import Path
import io
import json
import struct
import sys
import zlib
import olefile

root = Path(__file__).resolve().parents[3]
folder = root / "outputs/local-plugin-20261011"

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
            key = "/".join(name)
            if compressed and (name[0] == "BodyText" or name == ["DocInfo"]):
                value = zlib.decompress(value, -15)
            streams[key] = value
    blocks = []
    for tag, level, payload in records(streams["BodyText/Section0"]):
        if tag == 66:
            blocks.append({"level": level, "text": ""})
        if tag == 67:
            offset, visible = 0, bytearray()
            while offset < len(payload):
                code, = struct.unpack_from("<H", payload, offset)
                extended = 1 <= code <= 9 or code in (11, 12) or 14 <= code <= 23
                width = 16 if extended else 2
                assert offset + width <= len(payload)
                if code >= 32 or code in (9, 10):
                    visible += payload[offset:offset + 2]
                offset += width
            blocks[-1]["text"] += visible.decode("utf-16le")
    return streams, blocks

original_streams, original = decode((folder / "synthetic-original.hwp").read_bytes())
multiline_streams, multiline = decode((folder / "synthetic-multiline.hwp").read_bytes())
structure_streams, structure = decode((folder / "synthetic-structure.hwp").read_bytes())
restructured_streams, restructured = decode((folder / "synthetic-restructured.hwp").read_bytes())
assert [b["text"] for b in multiline if b["level"] == 2] == ["문항", "첫 답변", "둘째 답변 😀", "반복 문구", "반복 문구"]
assert [b["text"] for b in multiline if b["level"] == 0] == [b["text"] for b in original if b["level"] == 0]
assert [b["text"] for b in structure if b["level"] == 2] == ["문항", "첫 답변", "둘째 답변 😀", "반복 문구", "반복 문구", "제목", "새 표", "내용", "표 내용"]
assert [b["text"] for b in structure if b["level"] == 0 and b["text"]] == ["첫 합성 문단", "중간 합성 문단", "추가한 문단", "다음 문단", "마지막 합성 문단"]
assert [b["text"] for b in restructured if b["level"] == 2] == ["문항", "첫 답변둘째 답변 😀", "반복 문구", "반복 문구", "제목", "새 표", "내용", "표 내용"]
assert [b["text"] for b in restructured if b["level"] == 0 and b["text"]] == ["첫 합성 문단", "중간 합성 문단", "마지막 합성 문단"]
for streams in (multiline_streams, structure_streams, restructured_streams):
    assert streams.keys() == original_streams.keys()
    for name, value in original_streams.items():
        if name not in {"PrvText", "PrvImage", "DocInfo"} and not name.startswith("BodyText/"):
            assert streams[name] == value
    # All existing character and paragraph definitions remain exact and ordered.
    for tag in (19, 21, 22, 23, 25, 26):
        assert [(level, payload) for kind, level, payload in records(streams["DocInfo"]) if kind == tag] == [
            (level, payload) for kind, level, payload in records(original_streams["DocInfo"]) if kind == tag]
report = {"status": "PASS", "reader": "Python olefile and independent HWP record decoding",
          "multiline_real_cell_paragraphs": True, "new_body_paragraphs": True, "new_table_cell_text": True,
          "paragraph_deletion_and_merging": True, "table_row_column_insert_delete_round_trip": True,
          "existing_font_and_style_definitions_unchanged": True, "non_body_streams_unchanged": True,
          "layout_verified": False}
(folder / "independent-verification.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report))
