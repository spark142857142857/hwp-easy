"""Independent olefile/HWP record verification of local advanced edit artifacts."""
from pathlib import Path
import io
import json
import struct
import zlib
import olefile


def records(data):
    p = 0
    while p < len(data):
        header, = struct.unpack_from('<I', data, p)
        p += 4
        tag, level, size = header & 1023, (header >> 10) & 1023, header >> 20
        if size == 4095:
            size, = struct.unpack_from('<I', data, p)
            p += 4
        assert p + size <= len(data)
        yield tag, level, data[p:p + size]
        p += size
    assert p == len(data)


def decode(file):
    streams = {}
    with olefile.OleFileIO(io.BytesIO(Path(file).read_bytes())) as document:
        compressed = struct.unpack_from('<I', document.openstream('FileHeader').read(), 36)[0] & 1
        for name in document.listdir():
            value = document.openstream(name).read()
            if compressed and (name[0] == 'BodyText' or name == ['DocInfo']):
                value = zlib.decompress(value, -15)
            streams['/'.join(name)] = value
    blocks, headers, host, cell = [], [], -1, None
    for tag, level, payload in records(streams['BodyText/Section0']):
        if tag == 72:
            col, row = struct.unpack_from('<HH', payload, 8)
            cell = (host, row, col)
            headers.append((cell, payload))
        if tag == 66:
            if level == 0:
                host += 1
                cell = None
            blocks.append({'host': host, 'cell': cell, 'records': [], 'text': ''})
        blocks[-1]['records'].append((tag, level, payload))
        if tag == 67:
            p, visible = 0, bytearray()
            while p < len(payload):
                code, = struct.unpack_from('<H', payload, p)
                width = 16 if 1 <= code <= 9 or code in (11, 12) or 14 <= code <= 23 else 2
                assert p + width <= len(payload)
                if code >= 32 or code in (9, 10):
                    visible += payload[p:p + 2]
                p += width
            blocks[-1]['text'] += visible.decode('utf-16le')
    for coordinate, payload in headers:
        count = sum(b['cell'] == coordinate for b in blocks)
        assert struct.unpack_from('<H', payload, 0)[0] == count
    for i, b in enumerate(blocks):
        end = not any(x['cell'] == b['cell'] and (b['cell'] is not None or x['host'] > b['host']) for x in blocks[i + 1:])
        assert bool(struct.unpack_from('<I', b['records'][0][2])[0] & 0x80000000) == end
    return streams, blocks, dict(headers)


def definitions(streams):
    result = {}
    for tag, level, payload in records(streams['DocInfo']):
        result.setdefault(tag, []).append((level, payload))
    return result


def canon(block, ignored=(), fields=()):
    result = []
    for tag, level, payload in block['records']:
        if tag in (*ignored, 69, 72):
            continue
        value = bytearray(payload)
        if tag == 66:
            struct.pack_into('<I', value, 0, struct.unpack_from('<I', value)[0] & 0x7fffffff)
            value[16:18] = bytes(2)
            for start, end in fields:
                value[start:end] = bytes(end - start)
        result.append((tag, level, bytes(value)))
    return result


def char_definition(old, props):
    result = bytearray(old)
    assert len(result) == 74
    flags, = struct.unpack_from('<I', result, 46)
    for key, mask, on in [('bold', 2, 2), ('italic', 1, 1), ('underline', 12, 4), ('strikethrough', 0x180000, 0x80000)]:
        if key in props:
            flags = flags & ~mask | (on if props[key] else 0)
    struct.pack_into('<I', result, 46, flags)
    if 'fontSize' in props:
        struct.pack_into('<I', result, 42, props['fontSize'])
    if 'textColor' in props:
        result[52:56] = bytes.fromhex(props['textColor'][1:]) + b'\0'
    if 'fontIds' in props:
        struct.pack_into('<7H', result, 0, *props['fontIds'])
    return bytes(result)


def verify_axis(blocks, after, cells, new_cells, target, meta):
    host = target['cell'][0]
    row_axis = meta['type'].endswith('_row')
    adding = meta['type'].startswith('insert_')
    index, axis = meta['index'], 1 if row_axis else 2
    selected = {k: p for k, p in cells.items() if k[0] == host}
    old_host = next(b for b in blocks if b['cell'] is None and b['host'] == host)
    new_host = next(b for b in after if b['cell'] is None and b['host'] == host)
    table = next(p for tag, _, p in old_host['records'] if tag == 77)
    rows, cols = struct.unpack_from('<HH', table, 4)
    widths = [max([struct.unpack_from('<I', p, 16)[0] for (_, _, col), p in selected.items() if col == i and struct.unpack_from('<H', p, 12)[0] == 1], default=0) or 1800 for i in range(cols)]
    heights = [max([struct.unpack_from('<I', p, 20)[0] for (_, row, _), p in selected.items() if row == i and struct.unpack_from('<H', p, 14)[0] == 1], default=0) or 400 for i in range(rows)]
    reference = max(0, index - 1) if adding else index
    unit = (heights if row_axis else widths)[reference]
    control = next(p for tag, _, p in old_host['records'] if tag == 71 and p[:4] == b' lbt')
    size = struct.unpack_from('<I', control, 20 if row_axis else 16)[0]
    display_unit = unit
    if row_axis and size > sum(heights):
        scaled = [max(1, (h * size + sum(heights) // 2) // sum(heights)) for h in heights]
        scaled[-1] += size - sum(scaled)
        display_unit = scaled[reference]
    fresh = {k for k in new_cells if k[0] == host}
    transformed = {}
    for coordinate, p in selected.items():
        pos = coordinate[axis]
        span = struct.unpack_from('<H', p, 14 if row_axis else 12)[0]
        if not adding and pos == index and span == 1:
            continue
        wanted = bytearray(p)
        crosses = pos < index < pos + span if adding else pos <= index < pos + span
        if crosses:
            struct.pack_into('<H', wanted, 14 if row_axis else 12, span + (1 if adding else -1))
            offset = 20 if row_axis else 16
            changed_size = struct.unpack_from('<I', p, offset)[0] + (unit if adding else -unit)
            struct.pack_into('<I', wanted, offset, changed_size)
            if not row_axis:
                assert struct.unpack_from('<I', p, 34)[0] == struct.unpack_from('<I', p, 16)[0]
                struct.pack_into('<I', wanted, 34, changed_size)
        key = list(coordinate)
        if pos >= index if adding else pos > index:
            key[axis] += 1 if adding else -1
        key = tuple(key)
        struct.pack_into('<HH', wanted, 8, key[2], key[1])
        assert new_cells[key] == wanted
        transformed[coordinate] = key
        fresh.remove(key)
        old_blocks = [b for b in blocks if b['cell'] == coordinate]
        new_blocks = [b for b in after if b['cell'] == key]
        assert len(old_blocks) == len(new_blocks)
        assert [canon(b) for b in old_blocks] == [canon(b) for b in new_blocks]
    assert not fresh or adding
    for key in fresh:
        assert key[axis] == index
        opposite = key[2 if row_axis else 1]
        mapped = [(old_key, new_key) for old_key, new_key in transformed.items()]
        def template_at(position):
            return next((old_key for old_key, new_key in mapped if new_key[2 if row_axis else 1] == opposite and struct.unpack_from('<H', selected[old_key], 12 if row_axis else 14)[0] == 1 and new_key[axis] == position), None)
        template = template_at(index + 1) or (template_at(index - 1) if index else None)
        if template is None:
            template = next((old_key for old_key, new_key in mapped if new_key[2 if row_axis else 1] == opposite and struct.unpack_from('<H', selected[old_key], 12 if row_axis else 14)[0] == 1), next(iter(selected)))
        wanted = bytearray(selected[template])
        struct.pack_into('<H', wanted, 0, 1)
        struct.pack_into('<4H', wanted, 8, key[2], key[1], 1, 1)
        width, height = (widths[opposite], unit) if row_axis else (unit, heights[opposite])
        if struct.unpack_from('<I', wanted, 16)[0] != width:
            struct.pack_into('<I', wanted, 34, width)
        struct.pack_into('<II', wanted, 16, width, height)
        assert new_cells[key] == wanted
        new_blocks = [b for b in after if b['cell'] == key]
        assert len(new_blocks) == 1 and new_blocks[0]['text'] == ''
    unaffected = lambda source: [b for b in source if b['host'] != host]
    assert [canon(b) for b in unaffected(blocks)] == [canon(b) for b in unaffected(after)]
    for key, p in cells.items():
        if key[0] != host:
            assert new_cells[key] == p
    assert canon(old_host, (71, 77)) == canon(new_host, (71, 77))
    old_controls = [(t, l, p) for t, l, p in old_host['records'] if t == 71]
    new_controls = [(t, l, p) for t, l, p in new_host['records'] if t == 71]
    assert len(old_controls) == len(new_controls)
    for original, actual in zip(old_controls, new_controls):
        tag, level, p = original
        wanted = bytearray(p)
        if p[:4] == b' lbt':
            if len(wanted) < 46:
                wanted += bytes(46 - len(wanted))
            struct.pack_into('<I', wanted, 20 if row_axis else 16, size + (display_unit if adding else -display_unit))
        assert (tag, level, bytes(wanted)) == actual
    new_rows, new_cols = rows + ((1 if adding else -1) if row_axis else 0), cols + ((1 if adding else -1) if not row_axis else 0)
    wanted = bytearray(table[:18])
    struct.pack_into('<HH', wanted, 4, new_rows, new_cols)
    wanted += b''.join(struct.pack('<H', sum(k[0] == host and k[1] == r for k in new_cells)) for r in range(new_rows)) + table[18 + 2 * rows:]
    assert next(p for t, _, p in new_host['records'] if t == 77) == wanted


def verify_case(before_file, after_file, meta):
    old, blocks, cells = decode(before_file)
    saved, after, new_cells = decode(after_file)
    index, op = meta['target_raw_index'], meta['type']
    target, current = blocks[index], after[index]
    a, b = definitions(old), definitions(saved)
    added_tag = 21 if op == 'format_text' else 25 if op == 'format_paragraph' else 18 if op in ('insert_picture', 'replace_picture') else None
    growth = len(b.get(added_tag, [])) - len(a.get(added_tag, [])) if added_tag else 0
    assert set(b) == set(a) | ({added_tag} if growth else set())
    font_growth = (len(b[19]) - len(a[19])) // 7
    props = dict(meta.get('props', {}))
    if 'fontFamily' in props:
        aliases = dict(json.loads((Path(__file__).resolve().parents[1] / 'src/one_hwp/font_defaults.json').read_text(encoding='utf-8')))
        name = props['fontFamily']
        encoded = name.encode('utf-16le')
        wanted_font = bytes([32 if name in aliases else 0]) + struct.pack('<H', len(encoded) // 2) + encoded
        if name in aliases:
            fallback = aliases[name].encode('utf-16le')
            wanted_font += struct.pack('<H', len(fallback) // 2) + fallback
        counts = struct.unpack_from('<7I', a[17][0][1], 4)
        new_counts = struct.unpack_from('<7I', b[17][0][1], 4)
        assert font_growth in (0, 1) and new_counts == tuple(n + font_growth for n in counts)
        start_old = start_new = 0
        ids = []
        for count, new_count in zip(counts, new_counts):
            assert a[19][start_old:start_old + count] == b[19][start_new:start_new + count]
            if font_growth:
                assert b[19][start_new + count] == (1, wanted_font)
            names = [p[3:3 + struct.unpack_from('<H', p, 1)[0] * 2].decode('utf-16le') for _, p in b[19][start_new:start_new + new_count]]
            ids.append(names.index(name))
            start_old += count
            start_new += new_count
        props['fontIds'] = ids
    else:
        assert font_growth == 0
    for tag, values in a.items():
        assert len(b[tag]) == len(values) + (growth if tag == added_tag else font_growth * 7 if tag == 19 else 0)
        if tag == 19 and font_growth:
            continue
        for i, (level, data) in enumerate(values):
            new_level, new_data = b[tag][i]
            x, y = bytearray(data), bytearray(new_data)
            assert level == new_level
            if tag == 16:
                x[14:26] = y[14:26] = bytes(12)
            if tag == 17 and growth:
                offset = {18: 0, 21: 36, 25: 52}[added_tag]
                assert struct.unpack_from('<I', y, offset)[0] == struct.unpack_from('<I', x, offset)[0] + growth
                x[offset:offset + 4] = y[offset:offset + 4] = bytes(4)
            if tag == 17 and font_growth:
                for offset in range(4, 32, 4):
                    assert struct.unpack_from('<I', y, offset)[0] == struct.unpack_from('<I', x, offset)[0] + font_growth
                    x[offset:offset + 4] = y[offset:offset + 4] = bytes(4)
            assert x == y
    extra_streams = set(saved) - set(old)
    assert set(old) <= set(saved)
    assert len(extra_streams) == (1 if op in ('insert_picture', 'replace_picture') else 0)
    if op in ('insert_picture', 'replace_picture'):
        assert growth == 1
        level, definition = b[18][-1]
        image_id = struct.unpack_from('<H', definition, 2)[0]
        assert level == 1 and image_id > 0
        assert definition == bytes([1, 1]) + struct.pack('<HH', image_id, 3) + 'png'.encode('utf-16le')
        assert extra_streams == {f'BinData/BIN{image_id:04X}.png'}
    for name, value in old.items():
        if not name.startswith('BodyText/') and name not in ('DocInfo', 'PrvText', 'PrvImage'):
            assert saved[name] == value
    if op.startswith('format_'):
        assert len(blocks) == len(after) and cells == new_cells
        for i, (x, y) in enumerate(zip(blocks, after)):
            assert x['text'] == y['text'] and x['cell'] == y['cell']
            if i != index:
                assert canon(x) == canon(y)
        if op == 'format_text':
            assert canon(target, (68,), ((12, 14),)) == canon(current, (68,), ((12, 14),))
            old_runs = next(p for tag, _, p in target['records'] if tag == 68)
            new_runs = next(p for tag, _, p in current['records'] if tag == 68)
            runs = lambda payload: list(struct.iter_unpack('<II', payload))
            offset = 0
            for point, ch in enumerate(target['text']):
                original = a[21][next(shape for pos, shape in reversed(runs(old_runs)) if pos <= offset)][1]
                wanted = char_definition(original, props) if meta['start'] <= point < meta['end'] else original
                for unit in range(len(ch.encode('utf-16le')) // 2):
                    shape = next(shape for pos, shape in reversed(runs(new_runs)) if pos <= offset + unit)
                    assert b[21][shape][1] == wanted
                offset += len(ch.encode('utf-16le')) // 2
        else:
            assert canon(target, fields=((8, 10),)) == canon(current, fields=((8, 10),))
            old_id = struct.unpack_from('<H', target['records'][0][2], 8)[0]
            new_id = struct.unpack_from('<H', current['records'][0][2], 8)[0]
            wanted = bytearray(a[25][old_id][1])
            if len(wanted) == 54:
                wanted += bytes(4)
            props = meta['props']
            if 'alignment' in props:
                flags = struct.unpack_from('<I', wanted)[0] & ~28 | ['justify', 'left', 'right', 'center'].index(props['alignment']) << 2
                struct.pack_into('<I', wanted, 0, flags)
            for key, offset in [('marginLeft', 4), ('marginRight', 8), ('indent', 12), ('spacingBefore', 16), ('spacingAfter', 20), ('lineSpacing', 24)]:
                if key in props:
                    struct.pack_into('<i', wanted, offset, props[key])
            assert b[25][new_id][1] == wanted
    elif op in ('insert_table_row', 'delete_table_row', 'insert_table_column', 'delete_table_column'):
        verify_axis(blocks, after, cells, new_cells, target, meta)
    elif op in ('split_table_cell', 'merge_table_cells'):
        host, row, col = target['cell']
        first = cells[target['cell']]
        colspan, rowspan = struct.unpack_from('<HH', first, 12)
        rect = meta.get('range', {'top': row, 'left': col, 'bottom': row + rowspan - 1, 'right': col + colspan - 1})
        inside = lambda coordinate: coordinate and coordinate[0] == host and rect['top'] <= coordinate[1] <= rect['bottom'] and rect['left'] <= coordinate[2] <= rect['right']
        before_selected = [x for x in blocks if inside(x['cell'])]
        after_selected = [x for x in after if inside(x['cell'])]
        first_paragraphs = [x for x in blocks if x['cell'] == target['cell']]
        retained = before_selected if op == 'split_table_cell' else [x for x in before_selected if x['cell'] == target['cell'] or x['text']]
        assert [x['text'] for x in after_selected[:len(retained)]] == [x['text'] for x in retained]
        for x, y in zip(retained, after_selected):
            assert canon(x) == canon(y)
        if op == 'split_table_cell':
            assert all(x['text'] == '' for x in after_selected[len(first_paragraphs):])
        unaffected = lambda source: [x for x in source if not inside(x['cell']) and not (x['cell'] is None and x['host'] == host)]
        assert [canon(x) for x in unaffected(blocks)] == [canon(x) for x in unaffected(after)]
        for coordinate, data in cells.items():
            if not inside(coordinate):
                assert new_cells[coordinate] == data
        if op == 'split_table_cell':
            width, height = struct.unpack_from('<II', first, 16)
            for coordinate, payload in new_cells.items():
                if not inside(coordinate):
                    continue
                _, r, c = coordinate
                wanted = bytearray(first)
                struct.pack_into('<H', wanted, 0, len(first_paragraphs) if (r, c) == (row, col) else 1)
                struct.pack_into('<HHHH', wanted, 8, c, r, 1, 1)
                struct.pack_into('<II', wanted, 16, width // colspan + (width % colspan if c == col + colspan - 1 else 0), height // rowspan + (height % rowspan if r == row + rowspan - 1 else 0))
                struct.pack_into('<I', wanted, 34, width // colspan)
                assert payload == wanted
        else:
            wanted = bytearray(first)
            width = sum(struct.unpack_from('<I', data, 16)[0] for coordinate, data in cells.items() if inside(coordinate) and coordinate[1] == row)
            height = sum(struct.unpack_from('<I', data, 20)[0] for coordinate, data in cells.items() if inside(coordinate) and coordinate[2] == col)
            struct.pack_into('<H', wanted, 0, len(retained))
            struct.pack_into('<HHII', wanted, 12, rect['right'] - col + 1, rect['bottom'] - row + 1, width, height)
            struct.pack_into('<I', wanted, 34, width)
            assert new_cells[target['cell']] == wanted
        x = next(x for x in blocks if x['cell'] is None and x['host'] == host)
        y = next(x for x in after if x['cell'] is None and x['host'] == host)
        assert canon(x, (77,)) == canon(y, (77,))
        old_table = next(p for tag, _, p in x['records'] if tag == 77)
        new_table = next(p for tag, _, p in y['records'] if tag == 77)
        wanted = bytearray(old_table)
        for r in range(struct.unpack_from('<H', old_table, 4)[0]):
            struct.pack_into('<H', wanted, 18 + r * 2, sum(coordinate[0] == host and coordinate[1] == r for coordinate in new_cells))
        assert new_table == wanted
    else:
        assert len(blocks) == len(after) and cells == new_cells
        for i, (x, y) in enumerate(zip(blocks, after)):
            assert x['text'] == y['text']
            if i != index:
                assert canon(x) == canon(y)
        object_records = lambda block: [(tag, level, payload) for tag, level, payload in block['records'] if tag in (71, 76, 85)]
        def without_picture(block):
            result = canon(block, (67, 71, 76, 85), ((0, 8),))
            payload = next((p for tag, _, p in block['records'] if tag == 67), b'\r\0')
            anchor = bytes([11, 0, 32, 111, 115, 103, 0, 0, 0, 0, 0, 0, 0, 0, 11, 0])
            assert payload.count(anchor) <= 1
            payload = payload.replace(anchor, b'')
            return result, payload
        assert without_picture(target) == without_picture(current)
        if op == 'insert_picture':
            new = object_records(current)
            level = 3 if target['cell'] else 1
            assert [(tag, lev) for tag, lev, _ in new] == [(71, level), (76, level + 1), (85, level + 2)]
            assert struct.unpack_from('<II', new[0][2], 16) == (meta['width'], meta['height'])
            assert struct.unpack_from('<II', new[1][2], 28) == (meta['width'], meta['height'])
            assert zlib.decompress(saved[next(iter(extra_streams))], -15) == Path(meta['image_path']).read_bytes()
            assert current['text'] == target['text']
        elif op == 'replace_picture':
            image = Path(meta['image_path']).read_bytes()
            assert zlib.decompress(saved[next(iter(extra_streams))], -15) == image
            width, height = struct.unpack_from('>II', image, 16)
            new = object_records(current)
            assert len(object_records(target)) == len(new) == 3
            image_id = struct.unpack_from('<H', new[2][2], 71)[0]
            assert image_id == struct.unpack_from('<H', b[18][-1][1], 2)[0]
            for (tag, level, data), (new_tag, new_level, payload) in zip(object_records(target), new):
                wanted = bytearray(data)
                if tag == 85:
                    struct.pack_into('<4i', wanted, 44, 0, 0, width * 75, height * 75)
                    struct.pack_into('<H', wanted, 71, image_id)
                assert (tag, level, bytes(wanted)) == (new_tag, new_level, payload)
        elif op == 'update_picture':
            assert len(object_records(target)) == len(object_records(current)) == 3
            for (tag, level, data), (new_tag, new_level, payload) in zip(object_records(target), object_records(current)):
                wanted = bytearray(data)
                for key, offset in ([('vertOffset', 8), ('horzOffset', 12), ('width', 16), ('height', 20)] if tag == 71 else [('width', 28), ('height', 32)] if tag == 76 else []):
                    if key in meta['props']:
                        struct.pack_into('<i', wanted, offset, meta['props'][key])
                assert (tag, level, bytes(wanted)) == (new_tag, new_level, payload)
        else:
            assert not object_records(current)
    return True


if __name__ == '__main__':
    folder = Path(__file__).resolve().parents[1] / 'outputs/local-plugin-20261011'
    stages = [('synthetic-advanced-before', 'synthetic-format-text', {'type': 'format_text', 'props': {'bold': True, 'fontSize': 1400, 'textColor': '#123456'}, 'start': 0, 'end': 2}, '첫 답변둘째 답변 😀'),
              ('synthetic-format-text', 'synthetic-format-runs', {'type': 'format_text', 'props': {'italic': True}, 'start': 0, 'end': len('첫 답변둘째 답변 😀')}, '첫 답변둘째 답변 😀'),
              ('synthetic-format-runs', 'synthetic-format-paragraph', {'type': 'format_paragraph', 'props': {'alignment': 'center', 'lineSpacing': 190}}, '첫 답변둘째 답변 😀'),
              ('synthetic-format-paragraph', 'synthetic-merge-cells', {'type': 'merge_table_cells', 'range': {'top': 0, 'left': 0, 'bottom': 0, 'right': 1}}, '제목'),
              ('synthetic-merge-cells', 'synthetic-split-cell', {'type': 'split_table_cell'}, '제목'),
              ('synthetic-split-cell', 'synthetic-insert-picture', {'type': 'insert_picture', 'width': 7200, 'height': 3600, 'image_path': str(folder / 'synthetic-image.png')}, '중간 합성 문단'),
              ('synthetic-insert-picture', 'synthetic-update-picture', {'type': 'update_picture', 'props': {'width': 10000, 'height': 5000, 'horzOffset': 200, 'vertOffset': 100}}, '중간 합성 문단'),
              ('synthetic-update-picture', 'synthetic-delete-picture', {'type': 'delete_picture'}, '중간 합성 문단'),
              ('synthetic-delete-picture', 'synthetic-font-family', {'type': 'format_text', 'props': {'fontFamily': '맑은 고딕'}, 'start': 0, 'end': 2}, '첫 답변둘째 답변 😀'),
              ('synthetic-font-family', 'synthetic-merged-axis-before', {'type': 'merge_table_cells', 'range': {'top': 0, 'left': 0, 'bottom': 0, 'right': 1}}, '제목'),
              ('synthetic-merged-axis-before', 'synthetic-merged-insert_table_row', {'type': 'insert_table_row', 'index': 1}, '제목'),
              ('synthetic-merged-insert_table_row', 'synthetic-merged-insert_table_column', {'type': 'insert_table_column', 'index': 1}, '제목'),
              ('synthetic-merged-insert_table_column', 'synthetic-merged-delete_table_row', {'type': 'delete_table_row', 'index': 1}, '제목'),
              ('synthetic-merged-delete_table_row', 'synthetic-merged-delete_table_column', {'type': 'delete_table_column', 'index': 1}, '제목'),
              ('synthetic-merged-delete_table_column', 'synthetic-cell-picture', {'type': 'insert_picture', 'width': 7200, 'height': 3600, 'image_path': str(folder / 'synthetic-image.png')}, '제목'),
              ('synthetic-cell-picture', 'synthetic-cell-replaced', {'type': 'replace_picture', 'image_path': str(folder / 'synthetic-replacement.png')}, '제목'),
              ('synthetic-cell-replaced', 'synthetic-cell-resized', {'type': 'update_picture', 'props': {'width': 6000, 'height': 3000}}, '제목'),
              ('synthetic-cell-resized', 'synthetic-cell-removed', {'type': 'delete_picture'}, '제목')]
    for before, after, meta, text in stages:
        meta['target_raw_index'] = next(i for i, b in enumerate(decode(folder / (before + '.hwp'))[1]) if b['text'] == text)
        verify_case(folder / (before + '.hwp'), folder / (after + '.hwp'), meta)
    report = {'status': 'PASS', 'cases': len(stages), 'reader': 'independent Python olefile and raw HWP definitions, cell headers and object records', 'layout_verified': False}
    (folder / 'advanced-independent-verification.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report))
