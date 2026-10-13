"""Independent OLE/record/style/field/matrix checks; no JS model or Hancom needed."""
from collections import Counter
from pathlib import Path
import importlib.util
import json
import math
import struct
import sys


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


raw = module('compound', 'check-local-compound.py')
tables = module('flexible', 'check-local-flexible-tables.py')
def compose(a,b):
    return [a[0]*b[0]+a[1]*b[3],a[0]*b[1]+a[1]*b[4],a[0]*b[2]+a[1]*b[5]+a[2],a[3]*b[0]+a[4]*b[3],a[3]*b[1]+a[4]*b[4],a[3]*b[2]+a[4]*b[5]+a[5]]
def inverse(m):
    a,b,x,c,d,y=m;det=a*d-b*c
    return [d/det,-b/det,(b*y-d*x)/det,-c/det,a/det,(c*x-a*y)/det]
def geometry(payload):
    base=8 if payload[:4]==payload[4:8] else 4
    matrix=lambda at:list(struct.unpack_from('<6d',payload,base+at))
    result=matrix(44)
    for i in range(struct.unpack_from('<H',payload,base+42)[0]):result=compose(compose(result,matrix(140+i*96)),matrix(92+i*96))
    return base,matrix,result


def styled_units(rs):
    units = []
    for group in raw.record_groups(rs):
        payload, ids = raw.own(group, 67), raw.style_ids(group)
        for unit, length, visible, code, value in raw.tokens(payload):
            if code != 13:
                units.extend((payload[i*2:i*2+2], ids[i]) for i in range(unit, unit+length))
    return units


def verify(folder, case):
    name, op = case['name'], case['operations'][0]
    before, after = [folder / (name + '-' + state + '.hwp') for state in ('before', 'after')]
    assert before.read_bytes() == (folder / (name + '-restored.hwp')).read_bytes()
    pa, a = raw.reader.load(before)
    pb, b = raw.reader.load(after)
    assert pa.keys() == pb.keys()
    for stream in pa:
        if stream not in ('BodyText/Section0', 'PrvText', 'PrvImage'):
            assert pa[stream] == pb[stream], (name, stream)
    ra, rb = [raw.records(s['BodyText/Section0']) for s in (a, b)]
    for rs in (ra, rb):
        for i, r in enumerate(rs):
            if r[0] == 71 and r[2][:4] == b' lbt':
                tables.table_at(rs, i)
        for g in raw.record_groups(rs):
            assert struct.unpack_from('<I', g[0][2])[0] & 0x7fffffff == len(raw.own(g, 67)) // 2
    for snapshot, rs in ((case['before'], ra), (case['after'], rb)):
        groups = raw.record_groups(rs)
        for block in snapshot['blocks']:
            ordinal = int(block['id'].split(':r')[1])
            actual = ''.join(t[4] for t in raw.tokens(raw.own(groups[ordinal], 67)))
            assert actual == block['text'], (name, ordinal)
    assert Counter(r[2] for r in ra if r[0] == 85) == Counter(r[2] for r in rb if r[0] == 85)
    if op['type'] in ('split_paragraph', 'merge_paragraph'):
        assert styled_units(ra) == styled_units(rb)
        # Complete retained control metadata is exact; only the outer cell's
        # paragraph count changes. Nested table cells retain their headers.
        for tag in (71, 73, 74, 75, 76, 77, 85, 87):
            assert [r[2] for r in ra if r[0] == tag] == [r[2] for r in rb if r[0] == tag], (name, tag)
        fa = {key: value[2] for g in raw.record_groups(ra) for key, value in raw.fields(g).items()}
        fb = {key: value[2] for g in raw.record_groups(rb) for key, value in raw.fields(g).items()}
        assert fa == fb
    elif op['type'] in ('transform_picture_group', 'rotate_group_picture'):
        assert len(ra) == len(rb)
        changed = [i for i, (x, y) in enumerate(zip(ra, rb)) if x != y]
        group = case['before']['picture_groups'][0]
        ordinal = int(group['block_id'].split(':r')[1])
        para = [i for i, r in enumerate(ra) if r[0] == 66][ordinal]
        header = next(i for i in range(para+1, len(ra)) if ra[i][0] == 71 and ra[i][2][:4] == b' osg')
        if op['type'] == 'transform_picture_group':
            original, current = ra[header+1][2], rb[header+1][2]
            base,old_matrix,old=geometry(original)
            expected_angle = op['props'].get('rotationAngle', group['rotationAngle'])
            assert struct.unpack_from('<h', current, base+32)[0] == expected_angle
            w, h = struct.unpack_from('<II', original, base+12)
            fw=op['props'].get('width',group['frame_size']['width']);fh=op['props'].get('height',group['frame_size']['height'])
            theta = math.radians(expected_angle)
            c, s = math.cos(theta), math.sin(theta)
            points = [(0,0),(fw,0),(0,fh),(fw,fh)]
            wanted = [c*fw/w, -s*fh/h, -min(c*x-s*y for x,y in points), s*fw/w, c*fh/h, -min(s*x+c*y for x,y in points)]
            delta=compose(wanted,inverse(old))
            components=[i for i in range(header+1,tables.end_of(ra,header)) if ra[i][0]==76]
            assert set(changed)<=set(components+[header])
            for i in components:
                base,matrix,_=geometry(ra[i][2]);_,_,actual=geometry(rb[i][2])
                wanted_rotation=compose(inverse(matrix(44)),compose(delta,compose(matrix(44),matrix(140))))
                assert all(abs(x-y)<1e-6 for x,y in zip(wanted_rotation,struct.unpack_from('<6d',rb[i][2],base+140)))
                x,y=bytearray(ra[i][2]),bytearray(rb[i][2])
                allowed=[(base+140,base+188)]+([(base+32,base+42)] if i==header+1 else [])
                for start,end in allowed:x[start:end]=y[start:end]=b'\0'*(end-start)
                assert x==y  # T, scale, later pairs, geometry, image IDs and hierarchy exact.
            base,_,_=geometry(original)
            for key, offset in [('width',16),('height',20)]:
                value=round(abs(c)*fw+abs(s)*fh) if key=='width' else round(abs(s)*fw+abs(c)*fh)
                assert struct.unpack_from('<I', rb[header][2], offset)[0]==value
        else:
            pics = [i for i in range(header+1, tables.end_of(ra, header)) if ra[i][0] == 85]
            at = pics[op['picture_index']] - 1
            assert changed == [at]
            assert struct.unpack_from('<h', rb[at][2], 36)[0] == op['props']['rotationAngle']
            x, y = bytearray(ra[at][2]), bytearray(rb[at][2])
            for start,end in [(36,46),(144,192)]:
                x[start:end] = y[start:end] = b'\0' * (end-start)
            assert x == y  # Including every later ancestor transform pair.
    elif op['type'] == 'fit_table_to_cell':
        assert case['verification']['layout_diagnostics']['geometry_overflows'] == 0
        assert styled_units(ra) == styled_units(rb)
    else:
        assert [o['type'] for o in case['operations']] == ['insert_paragraphs','duplicate_paragraph','delete_paragraph']
        assert 'added 😀' in [b['text'] for b in case['after']['blocks']]
    return {'case': name, 'status': 'PASS', 'exact_restore': True, 'independent_raw_check': True}


if __name__ == '__main__':
    folder = Path(sys.argv[1] if len(sys.argv)>1 else 'outputs/local-freedom-check')
    results = [verify(folder,c) for c in json.loads((folder/'cases.json').read_text(encoding='utf-8'))]
    summary = dict(status='PASS',cases=len(results),results=results,layout_verified=False)
    (folder/'independent-summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'status':'PASS','cases':len(results),'independent_raw_check':True}))
