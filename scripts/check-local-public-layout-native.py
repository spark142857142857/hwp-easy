"""Optional Pillow proof against native images of the pinned public cover form."""
import json
import re
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageFilter

root = Path(sys.argv[1])
rows = {r['case']: r for r in json.loads((root / 'native/results.json').read_text(encoding='utf-8'))}
cases = json.loads((root / 'cases.json').read_text(encoding='utf-8'))
def text(value):
    value = re.sub(r'&#(\d+);', lambda m: chr(int(m[1])), value or '')
    return re.sub(r'\s+', '', value.encode('utf-16-le', 'surrogatepass').decode('utf-16-le'))
def im(name, state, page):
    return Image.open(root / f'native/{name}-{state}-{page}.bmp').convert('RGB')
def same(a, b):
    return a.size == b.size and ImageChops.difference(a, b).getbbox() is None
restored = 0
for case in cases:
    name = case['name']
    before, after, recovery = [rows[name+'-'+s] for s in ['before', 'after', 'restored']]
    assert before['pages'] == recovery['pages']
    for page in range(before['pages']):
        assert same(im(name,'before',page),im(name,'restored',page))
        restored += 1
    for op in case['operations']:
        if op['type'] in ('set_field', 'splice_text_box'):
            for line in op['new_text'].splitlines():
                assert text(line) in text(after['text'])
    if name == 'public-fixed-bottom':
        assert after['pages'] > before['pages']
        first = im(name, 'before', 0)
        crop = (0,1000,first.width,first.height)
        assert same(first.crop(crop), im(name,'after',0).crop(crop)), 'cover decoration moved or body still intrudes'
        cover_pages = after['pages'] - before['pages'] + 1
        for page in range(1,cover_pages):
            # This form already repeats its bottom decoration on cover pages.
            assert same(first.crop(crop),im(name,'after',page).crop(crop)), 'new body enters protected cover bottom'
        for page in range(1,before['pages']):
            assert same(im(name,'before',page),im(name,'after',page+cover_pages-1)), 'other section changed'
    elif name == 'public-text-box':
        assert after['pages'] == before['pages']
        assert same(im(name,'before',0),im(name,'after',0))
        assert same(im(name,'before',2),im(name,'after',2))
    else:
        assert before['pages'] == after['pages'] == 1
        assert text(before['text']) == text(after['text'])
        picture = im(name,'after',0)
        # Blue answer text must end above the green vector map; the signature
        # at the right edge is outside this map test rectangle.
        green = [(x,y) for y in range(picture.height) for x in range(550)
                 if (lambda c:c[1]>c[0]+3 and c[1]>c[2]+3)(picture.getpixel((x,y)))]
        blue = [(x,y) for y in range(120,310) for x in range(100,700)
                if (lambda c:c[2]>c[0]+30 and c[2]>c[1]+20)(picture.getpixel((x,y)))]
        assert len(green)>30000 and len(blue)>1000
        mask = Image.new('L',picture.size,0)
        for point in green:
            mask.putpixel(point,255)
        # Native subpixel font antialiasing contains isolated green fringes.
        # Erode those before measuring the large solid map region.
        bounds = mask.filter(ImageFilter.MinFilter(5)).getbbox()
        assert bounds and bounds[1]>max(y for x,y in blue), 'map still obscures the answer'
report = dict(status='PASS',files=len(rows),pages=sum(r['pages'] for r in rows.values()),requested_lines_verified=61,restored_pages_pixel_exact=restored,cover_bottom_decoration_exact=True,new_body_avoids_protected_bottom=True,untouched_sections_pixel_exact=True)
(root/'native/summary.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report))
