"""Independent raw HWP picture, crop, transform and non-target verification."""
from pathlib import Path
import importlib.util
import io
import json
import math
import struct
import sys
import zlib

spec = importlib.util.spec_from_file_location('advanced_checker', Path(__file__).with_name('check-local-advanced.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
try:
    from PIL import Image
except ImportError:
    Image = None


def image_dimensions(data):
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        width, height = struct.unpack_from('>II', data, 16)
        extension = 'png'
    else:
        assert data[:2] == b'\xff\xd8'
        p = 2
        while p < len(data):
            assert data[p] == 255
            p += 1
            while data[p] == 255:
                p += 1
            marker = data[p]
            p += 1
            length = struct.unpack_from('>H', data, p)[0]
            if marker in (192, 194):
                height, width = struct.unpack_from('>HH', data, p + 3)
                break
            p += length
        else:
            raise AssertionError('MISSING_JPEG_FRAME')
        extension = 'jpg'
    if Image is not None:
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            assert image.size == (width, height)
    return width, height, extension


def objects(block):
    selected = [(t, level, p) for t, level, p in block['records'] if t in (76, 85) or t == 71 and p[:4] == b' osg']
    assert len(selected) % 3 == 0
    return [selected[i:i + 3] for i in range(0, len(selected), 3)]


def anchors(data):
    result, p, visible = [], 0, 0
    while p < len(data):
        code = struct.unpack_from('<H', data, p)[0]
        if code == 11:
            assert data[p:p + 16] == bytes([11, 0, 32, 111, 115, 103, 0, 0, 0, 0, 0, 0, 0, 0, 11, 0])
            result.append((p // 2, visible))
            p += 16
        else:
            if code >= 32 or code in (9, 10):
                visible += 1
            p += 2
    return result


def image_bytes(streams, group):
    image_id = struct.unpack_from('<H', group[2][2], 71)[0]
    definition = next(p for _, p in base.definitions(streams)[18] if struct.unpack_from('<H', p, 2)[0] == image_id)
    n = struct.unpack_from('<H', definition, 4)[0]
    extension = definition[6:6 + n * 2].decode('utf-16le')
    return zlib.decompress(streams[f'BinData/BIN{image_id:04X}.{extension}'], -15)


def verify_case(before_file, after_file, meta):
    old, before, cells = base.decode(before_file)
    saved, after, new_cells = base.decode(after_file)
    op, index = meta['type'], meta['target_raw_index']
    adding = op in ('insert_picture', 'replace_picture')
    a, b = base.definitions(old), base.definitions(saved)
    assert len(before) == len(after) and cells == new_cells
    assert set(b) == set(a) | ({18} if adding else set())
    for tag, records in a.items():
        assert len(b[tag]) == len(records) + (1 if adding and tag == 18 else 0)
        for (level, data), (new_level, new_data) in zip(records, b[tag]):
            x, y = bytearray(data), bytearray(new_data)
            if adding and tag == 16:
                x[14:26] = y[14:26] = bytes(12)
            if adding and tag == 17:
                assert struct.unpack_from('<I', y)[0] == struct.unpack_from('<I', x)[0] + 1
                x[:4] = y[:4] = bytes(4)
            assert level == new_level and x == y
    extra = set(saved) - set(old)
    assert set(old) <= set(saved) and len(extra) == int(adding)
    for name, value in old.items():
        if name != 'BodyText/Section0' and not (adding and name in ('DocInfo', 'PrvText', 'PrvImage')):
            assert saved[name] == value
    for i, (x, y) in enumerate(zip(before, after)):
        assert x['text'] == y['text'] and x['cell'] == y['cell']
        if i != index:
            assert x['records'] == y['records']
    target, current = before[index], after[index]
    groups, new_groups = objects(target), objects(current)
    selected = meta.get('picture_index', 0)
    old_text = next((p for t, _, p in target['records'] if t == 67), b'\r\0')
    new_text = next(p for t, _, p in current['records'] if t == 67)
    positions = anchors(old_text)
    delta, point = 0, 0
    if adding:
        data = Path(meta['image_path']).read_bytes()
        width, height, extension = image_dimensions(data)
        level, definition = b[18][-1]
        image_id = struct.unpack_from('<H', definition, 2)[0]
        assert level == 1 and image_id > 0
        assert definition == struct.pack('<HHH', 257, image_id, len(extension)) + extension.encode('utf-16le')
        assert extra == {f'BinData/BIN{image_id:04X}.{extension}'}
        assert zlib.decompress(saved[next(iter(extra))], -15) == data
    if op == 'insert_picture':
        point = len(target['text'][:meta['offset']].encode('utf-16le')) // 2
        selected = sum(visible <= point for _, visible in positions)
        point += selected * 8
        delta = 8
        assert new_groups[:selected] + new_groups[selected + 1:] == groups
        new = new_groups[selected]
        level = 3 if target['cell'] is not None else 1
        assert [(t, l) for t, l, _ in new] == [(71, level), (76, level + 1), (85, level + 2)]
        assert struct.unpack_from('<II', new[0][2], 16) == (meta['width'], meta['height'])
        # HWP format table 70: inline placement must not select percent sizing.
        flags = struct.unpack_from('<I', new[0][2], 4)[0]
        assert (flags >> 15) & 7 == 4 and (flags >> 18) & 3 == 2
        assert struct.unpack_from('<4I', new[1][2], 20) == (meta['width'], meta['height'], meta['width'], meta['height'])
        assert struct.unpack_from('<4i', new[2][2], 44) == (0, 0, width * 75, height * 75)
        assert struct.unpack_from('<H', new[2][2], 71)[0] == image_id
        assert struct.unpack_from('<II', new[2][2], 82) == (width * 75, height * 75)
        assert not target['cell'] or struct.unpack_from('<I', new[0][2], 4)[0] & 1
        assert new_text == old_text[:point * 2] + bytes([11, 0, 32, 111, 115, 103, 0, 0, 0, 0, 0, 0, 0, 0, 11, 0]) + old_text[point * 2:]
    elif op == 'delete_picture':
        assert new_groups == groups[:selected] + groups[selected + 1:]
        point, _ = positions[selected]
        delta = -8
        assert new_text == old_text[:point * 2] + old_text[(point + 8) * 2:]
    else:
        assert len(groups) == len(new_groups) and new_text == old_text
        assert groups[:selected] + groups[selected + 1:] == new_groups[:selected] + new_groups[selected + 1:]
        expected = [(t, l, bytearray(p)) for t, l, p in groups[selected]]
        header, shape, picture = [p for _, _, p in expected]
        if op == 'replace_picture':
            struct.pack_into('<H', picture, 71, image_id)
            struct.pack_into('<4i', picture, 44, 0, 0, width * 75, height * 75)
            struct.pack_into('<II', picture, 82, width * 75, height * 75)
        else:
            props = meta['props']
            old_width, old_height = struct.unpack_from('<II', header, 16)
            old_angle = struct.unpack_from('<h', shape, 40)[0]
            for key, pos in [('vertOffset', 8), ('horzOffset', 12), ('width', 16), ('height', 20)]:
                if key in props:
                    struct.pack_into('<i', header, pos, props[key])
            for key, pos, prior in [('width', 28, old_width), ('height', 32, old_height)]:
                if key in props:
                    value = props[key] if old_angle % 360 == 0 else max(1, math.floor(struct.unpack_from('<I', shape, pos)[0] * props[key] / prior + 0.5))
                    struct.pack_into('<I', shape, pos, value)
            if 'rotationAngle' in props:
                w, h = struct.unpack_from('<II', shape, 28)
                angle = props['rotationAngle']
                c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
                bbox = (max(1, math.floor(w * abs(c) + h * abs(s) + 0.5)), max(1, math.floor(w * abs(s) + h * abs(c) + 0.5)))
                old_w, old_h = struct.unpack_from('<II', header, 16)
                x, y = struct.unpack_from('<i', header, 12)[0] + old_w // 2, struct.unpack_from('<i', header, 8)[0] + old_h // 2
                struct.pack_into('<II', header, 16, *bbox)
                struct.pack_into('<i', header, 12, x - bbox[0] // 2)
                struct.pack_into('<i', header, 8, y - bbox[1] // 2)
                struct.pack_into('<hii', shape, 40, angle, bbox[0] // 2, bbox[1] // 2)
            if 'rotationAngle' in props or old_angle % 360 != 0 and ('width' in props or 'height' in props):
                angle = struct.unpack_from('<h', shape, 40)[0]
                ow, oh, w, h = struct.unpack_from('<4I', shape, 20)
                x, y = struct.unpack_from('<ii', shape, 8)
                c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
                identity = [1, 0, 0, 0, 1, 0]
                matrices = [identity] * 3 if angle % 360 == 0 else [[1, 0, x, 0, 1, y], [w / ow, 0, 0, 0, h / oh, 0], [c, -s, -min(0, w * c, -h * s, w * c - h * s) - x, s, c, -min(0, w * s, h * c, w * s + h * c) - y]]
                struct.pack_into('<H', shape, 50, 1)
                values = [value for matrix in matrices for value in matrix]
                actual = struct.unpack_from('<18d', new_groups[selected][1][2], 52)
                assert all(math.isclose(x, y, rel_tol=1e-12, abs_tol=1e-9) for x, y in zip(values, actual))
                shape[52:196] = new_groups[selected][1][2][52:196]
            if any(k.startswith('crop') for k in props):
                w, h, _ = image_dimensions(image_bytes(old, groups[selected]))
                left, top, right, bottom = struct.unpack_from('<4i', picture, 44)
                struct.pack_into('<4i', picture, 44, props.get('cropLeft', left), props.get('cropTop', top), w * 75 - props['cropRight'] if 'cropRight' in props else right, h * 75 - props['cropBottom'] if 'cropBottom' in props else bottom)
        assert [(t, l, bytes(p)) for t, l, p in expected] == new_groups[selected]
    old_plain = [(t, l, p) for t, l, p in target['records'] if t not in (67, 71, 76, 85)]
    new_plain = [(t, l, p) for t, l, p in current['records'] if t not in (67, 71, 76, 85)]
    assert len(old_plain) == len(new_plain)
    for (t, level, data), actual in zip(old_plain, new_plain):
        wanted = bytearray(data)
        if t == 66:
            high = struct.unpack_from('<I', wanted)[0] & 0x80000000
            struct.pack_into('<II', wanted, 0, high | len(new_text) // 2, 1 << 11 if new_groups else 0)
        if t == 68 and delta:
            for offset in range(0, len(wanted), 8):
                position = struct.unpack_from('<I', wanted, offset)[0]
                if position > point:
                    struct.pack_into('<I', wanted, offset, position + delta)
        assert (t, level, bytes(wanted)) == actual
    assert len(anchors(new_text)) == len(new_groups)
    return True


if __name__ == '__main__':
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / 'outputs/local-plugin-20261011/picture-cases'
    manifest = json.loads((folder / 'verification.json').read_text(encoding='utf-8'))
    for case in manifest['cases']:
        verify_case(folder / case['before_file'], folder / case['after_file'], case)
    report = {'status': 'PASS', 'cases': len(manifest['cases']), 'independent_reader': 'Python olefile and raw HWP records', 'raster_decode_checked': Image is not None, 'layout_verified': False}
    (folder / 'independent-verification.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report))
