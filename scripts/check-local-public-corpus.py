"""Independent OLE/record checks for public corpus edit copies, without Hancom."""
import hashlib
import io
import json
from pathlib import Path
import struct
import sys
import zlib
import olefile

def unpack(data):
    packed = {}
    with olefile.OleFileIO(io.BytesIO(data)) as document:
        for name in document.listdir():
            packed['/'.join(name)] = document.openstream(name).read()
    compressed = struct.unpack_from('<I', packed['FileHeader'], 36)[0] & 1
    expanded = {name: zlib.decompress(value, -15) if compressed and (name == 'DocInfo' or name.startswith('BodyText/')) else value for name, value in packed.items()}
    return packed, expanded

def records(data):
    result, offset = [], 0
    while offset < len(data):
        header, = struct.unpack_from('<I', data, offset)
        offset += 4
        tag, level, size = header & 1023, (header >> 10) & 1023, header >> 20
        if size == 4095:
            size, = struct.unpack_from('<I', data, offset)
            offset += 4
        assert offset + size <= len(data)
        result.append((tag, level, data[offset:offset + size]))
        offset += size
    assert offset == len(data)
    return result

def text(payload):
    visible, offset = bytearray(), 0
    while offset < len(payload):
        code, = struct.unpack_from('<H', payload, offset)
        width = 16 if 1 <= code <= 9 or code in (11, 12) or 14 <= code <= 23 else 2
        assert offset + width <= len(payload)
        if code >= 32 or code == 10:
            visible += payload[offset:offset + 2]
        elif code == 9:
            visible += b'\x09\x00'
        offset += width
    return visible.decode('utf-16le')

folder = Path(sys.argv[1])
summary = json.loads((folder / 'results.json').read_text(encoding='utf-8'))
verified = []
for entry in summary['documents']:
    if entry['edit'] != 'PASS':
        continue
    case_dir = folder / str(entry['id'])
    case = json.loads((case_dir / 'case.json').read_text(encoding='utf-8'))
    before = (case_dir / 'before.hwp').read_bytes()
    after = (case_dir / 'after.hwp').read_bytes()
    assert (case_dir / 'restored.hwp').read_bytes() == before
    assert hashlib.sha256(before).hexdigest() == case['source_sha256']
    assert hashlib.sha256(after).hexdigest() == case['edited_sha256']
    old_packed, old = unpack(before)
    new_packed, new = unpack(after)
    assert old.keys() - {'PrvText', 'PrvImage'} == new.keys() - {'PrvText', 'PrvImage'}
    target = case['before_target']
    body = f"BodyText/Section{target['section']}"
    for name, value in old_packed.items():
        if name not in (body, 'PrvText', 'PrvImage'):
            assert value == new_packed[name], name
    # Independently decode the derived UTF-16 excerpt and Windows BMP header.
    excerpt = b''
    for name in sorted((n for n in new if n.startswith('BodyText/Section')), key=lambda n: int(n[16:])):
        for tag, level, payload in records(new[name]):
            if tag == 67:
                excerpt += text(payload).encode('utf-16le') + b'\r\x00\n\x00'
        if len(excerpt) >= 8192:
            break
    excerpt = excerpt[:8192]
    if len(excerpt) >= 2 and 0xD800 <= struct.unpack_from('<H', excerpt, len(excerpt) - 2)[0] <= 0xDBFF:
        excerpt = excerpt[:-2]
    assert new['PrvText'] == excerpt, (entry['id'], len(new['PrvText']), len(excerpt), next((i for i, (a, b) in enumerate(zip(new['PrvText'], excerpt)) if a != b), None))
    bmp = new['PrvImage']
    if bmp:
        assert bmp[:2] == b'BM' and struct.unpack_from('<I', bmp, 2)[0] == len(bmp)
        assert struct.unpack_from('<I', bmp, 10)[0] == 54 and struct.unpack_from('<I', bmp, 14)[0] == 40
        width, height = struct.unpack_from('<ii', bmp, 18)
        assert 1 <= width <= 180 and 1 <= height <= 180
        assert struct.unpack_from('<HHI', bmp, 26) == (1, 24, 0)
        assert len(bmp) == 54 + ((width * 3 + 3) & ~3) * height
    original_records, saved_records = records(old[body]), records(new[body])
    original_headers = [i for i, r in enumerate(original_records) if r[0] == 66]
    saved_headers = [i for i, r in enumerate(saved_records) if r[0] == 66]
    assert len(original_headers) == len(saved_headers)
    ordinal = int(target['id'].split(':r')[1])
    for index, (a, b) in enumerate(zip(original_headers, saved_headers)):
        left = original_records[a:original_headers[index + 1] if index + 1 < len(original_headers) else len(original_records)]
        right = saved_records[b:saved_headers[index + 1] if index + 1 < len(saved_headers) else len(saved_records)]
        if index != ordinal:
            assert left == right, (entry['id'], index)
            continue
        level = left[0][1]
        texts = [r[2] for r in right if r[0] == 67 and r[1] == level + 1]
        assert len(texts) == 1 and text(texts[0]) == case['wanted']
        def opaque(rs):
            return [r for r in rs if not (r[0] == 66 and r[1] == level or r[0] in (67, 68, 69) and r[1] == level + 1)]
        assert opaque(left) == opaque(right)
        original_header, saved_header = bytearray(left[0][2]), bytearray(right[0][2])
        assert (struct.unpack_from('<I', original_header, 0)[0] ^ struct.unpack_from('<I', saved_header, 0)[0]) & 0x80000000 == 0
        assert (struct.unpack_from('<I', original_header, 4)[0] ^ struct.unpack_from('<I', saved_header, 4)[0]) & ~(1 << 10) == 0
        for start, end in ((0, 4), (4, 8), (12, 14), (16, 18)):
            original_header[start:end] = b'\0' * (end - start)
            saved_header[start:end] = b'\0' * (end - start)
        assert original_header == saved_header
    verified.append(entry['id'])
result = {'status': 'PASS', 'independent_reader': 'Python olefile and raw HWP records', 'verified_document_ids': verified, 'exact_restore': True, 'non_preview_packed_streams_and_opaque_records_preserved': True, 'derived_utf16_preview_and_bmp_verified': True, 'external_viewer_layout_verified': False}
(folder / 'independent-verification.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps(result))
