/** Local structural edits. Kept separate from the submitted remote text profile. */
import { createEngineApi } from './rhwp_api.mjs';
import { readHwp } from '../../probes/sites-runtime/guard/container.mjs';
import { GuardError, parseRecords } from '../../probes/sites-runtime/guard/records.mjs';
import { canonicalRecord, textControlBytes } from '../../probes/sites-runtime/guard/preservation.mjs';
import { mapRawTargets } from '../../probes/sites-runtime/engine/document.mjs';
import { expectedEditedBlock } from './text_font_selection.mjs';

const fail = (code) => { throw new GuardError(code); };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bytesEqual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const copy = (o) => structuredClone(o);
function text(value) {
  if (typeof value !== 'string' || !value.isWellFormed() || value.length > 100000
    || /[\r\u0000-\u0008\u000b-\u001f]/.test(value)) fail('INVALID_EDIT_TEXT');
  return value;
}
function checked(result) { if (JSON.parse(result).ok !== true) fail('ENGINE_OPERATION_FAILED'); }
function rawId(id, hash) {
  if (typeof id !== 'string' || !id.startsWith(`hwp5:${hash}:`)) fail('VERSION_CONFLICT');
  const encoded = id.slice(70);
  const result = Buffer.from(encoded, 'base64url').toString('utf8');
  if (Buffer.from(result).toString('base64url') !== encoded) fail('INVALID_TARGET');
  return result;
}
function withoutPosition(block) {
  const result = copy(block);
  for (const key of ['id', 'section', 'paragraph', 'cell_paragraph']) delete result[key];
  return result;
}
function recordsByBlock(raw, model) {
  mapRawTargets(raw, model.blocks);
  const result = new Map();
  for (const { section } of raw.profile.sections) {
    const blocks = model.blocks.filter(b => b.section === section);
    let index = -1;
    for (const record of parseRecords(raw.streams.get(`BodyText/Section${section}`))) {
      if (record.tag === 66) result.set(blocks[++index].id, []);
      if (index < 0) fail('TARGET_MAPPING_UNVERIFIED');
      result.get(blocks[index].id).push(record);
    }
  }
  return result;
}
// A table insertion may append border definitions. Existing definitions and
// IDs remain byte-exact, and only the border count is permitted to increase.
function verifyDocInfo(a, b, allowBorders) {
  const left = [...parseRecords(a)], right = [...parseRecords(b)];
  const groups = (records) => {
    const result = new Map();
    for (const r of records) { if (!result.has(r.tag)) result.set(r.tag, []); result.get(r.tag).push(r); }
    return result;
  };
  const lg = groups(left), rg = groups(right);
  if (!equal([...lg.keys()], [...rg.keys()])) fail('PRESERVATION_MISMATCH');
  const borders = (rg.get(20)?.length ?? 0) - (lg.get(20)?.length ?? 0);
  if (borders < 0 || borders > (allowBorders ? 2 : 0)) fail('PRESERVATION_MISMATCH');
  let seenBorders = 0;
  const existingRight = right.filter(r => r.tag !== 20 || ++seenBorders <= (lg.get(20)?.length ?? 0));
  if (left.length !== existingRight.length || left.some((r,i)=>r.tag!==existingRight[i].tag||r.level!==existingRight[i].level)) fail('PRESERVATION_MISMATCH');
  for (const [tag, list] of lg) {
    const saved = rg.get(tag);
    if (saved.length !== list.length + (tag === 20 ? borders : 0)) fail('PRESERVATION_MISMATCH');
    list.forEach((r, i) => {
      if (r.level !== saved[i].level) fail('PRESERVATION_MISMATCH');
      const x = r.payload.slice(), y = saved[i].payload.slice();
      if (tag === 16) { x.fill(0, 14, 26); y.fill(0, 14, 26); }
      if (tag === 17 && borders) {
        if (view(y).getUint32(32, true) !== view(x).getUint32(32, true) + borders) fail('PRESERVATION_MISMATCH');
        x.fill(0, 32, 36); y.fill(0, 32, 36);
      }
      if (!bytesEqual(x, y)) fail('PRESERVATION_MISMATCH');
    });
  }
}
function verifyOutsideBody(before, after, tableAdded) {
  if (!equal([...before.streams.keys()].sort(), [...after.streams.keys()].sort())) fail('STREAM_SET_CHANGED');
  for (const [name, original] of before.streams) {
    if (name.startsWith('BodyText/') || name === 'PrvText' || name === 'PrvImage') continue;
    const saved = after.streams.get(name);
    if (name === 'DocInfo') verifyDocInfo(original, saved, tableAdded);
    else if (!bytesEqual(original, saved)) fail('PRESERVATION_MISMATCH');
  }
}
function compareRecords(left, right, changed) {
  if(changed) {
    const controls=records=>{
      const textRecords=records.filter(r=>r.tag===67);
      if(textRecords.length>1)fail('PRESERVATION_MISMATCH');
      const raw=textRecords.length?textControlBytes(textRecords[0].payload):new Uint8Array([13,0]);
      // Explicit whole-text replacement may remove old LF controls, replacing
      // requested newlines with real paragraph boundaries. Extended controls stay exact.
      const result=[];
      for(let offset=0;offset<raw.length;) {
        const code=view(raw).getUint16(offset,true),extended=(code>=1&&code<=9)||code===11||code===12||(code>=14&&code<=23);
        const width=extended?16:2;
        if(code!==10)result.push(...raw.subarray(offset,offset+width));offset+=width;
      }
      return Uint8Array.from(result);
    };
    // The writer can add a missing empty PARA_TEXT or omit one on clearing.
    // Actual control slots still match; visible text is checked via raw/model mapping.
    if(!bytesEqual(controls(left),controls(right)))fail('PRESERVATION_MISMATCH');
  }
  // Cell list headers are compared in their ordered table lists below. A
  // split moves the following cell's header to the newly inserted paragraph.
  const normalize = (records) => records.filter(r => ![69,72].includes(r.tag) && !(changed&&r.tag===67)).map(r => {
    const canonical = canonicalRecord(r, 0, changed ? new Set([0]) : new Set());
    const payload = canonical.payload.slice();
    if (r.tag === 66) {
      // End-of-list flags are checked separately against exact resulting order.
      view(payload).setUint32(0, view(payload).getUint32(0, true) & 0x7fffffff, true);
      if(changed)view(payload).setUint32(4,view(payload).getUint32(4,true)&~(1<<10),true);
    }
    return { tag: r.tag, level: r.level, payload };
  });
  const a = normalize(left), b = normalize(right);
  if (a.length !== b.length || a.some((r, i) => r.tag !== b[i].tag || r.level !== b[i].level
    || !bytesEqual(r.payload, b[i].payload))) fail('PRESERVATION_MISMATCH');
}
function verifyCellHeaders(beforeRaw, afterRaw, translate, newHost) {
  const headers = raw => {
    const result = [];
    for (const {section} of raw.profile.sections) {
      let host = -1;
      for (const r of parseRecords(raw.streams.get(`BodyText/Section${section}`))) {
        if (r.tag === 66 && r.level === 0) host++;
        if (r.tag === 72) result.push({section,host,payload:r.payload});
      }
    }
    return result;
  };
  const left = headers(beforeRaw),right = headers(afterRaw).filter(r=>!(newHost
    && r.section===newHost.section && r.host===newHost.paragraph));
  if(left.length!==right.length)fail('CELL_PRESERVATION_MISMATCH');
  left.forEach((r,i)=>{
    const target=translate({section:r.section,paragraph:r.host,kind:'paragraph'}),saved=right[i];
    if(saved.section!==target.section||saved.host!==target.paragraph)fail('CELL_PRESERVATION_MISMATCH');
    const a=r.payload.slice(),b=saved.payload.slice();
    // Counts were independently checked against the complete model and raw
    // ordering. Every remaining cell-header byte stays unchanged.
    a.fill(0,0,2);b.fill(0,0,2);
    if(!bytesEqual(a,b))fail('CELL_PRESERVATION_MISMATCH');
  });
}
function verifyListCounts(raw, model) {
  for (const { section } of raw.profile.sections) {
    const blocks = model.blocks.filter(b => b.section === section);
    let index = -1;
    for (const r of parseRecords(raw.streams.get(`BodyText/Section${section}`))) {
      if (r.tag === 66) {
        const block = blocks[++index];
        const later = blocks.slice(index + 1).filter(b => block.kind === 'paragraph'
          ? b.kind === 'paragraph' : b.kind === 'cell' && b.paragraph === block.paragraph
          && b.control === block.control && b.cell === block.cell);
        if (Boolean(view(r.payload).getUint32(0, true) & 0x80000000) !== (later.length === 0)) fail('LIST_END_MISMATCH');
      }
      if (r.tag === 72) {
        const row = view(r.payload).getUint16(10, true), col = view(r.payload).getUint16(8, true);
        const host = blocks[index].paragraph;
        const cells = model.blocks.filter(b => b.kind === 'cell' && b.section === section
          && b.paragraph === host && b.row === row && b.column === col);
        if (view(r.payload).getUint16(0, true) !== cells.length) fail('CELL_PARAGRAPH_COUNT_MISMATCH');
      }
    }
  }
}

export function structuralEdit(HwpDocument, source, hash, operation) {
  const api = createEngineApi(HwpDocument,{existingLineBreaksEditable:true}), raw = readHwp(source), doc = api.openDocument(source);
  try {
    const before = api.inspectDocument(doc, source);
    mapRawTargets(raw, before.blocks);
    verifyListCounts(raw, before);
    if (before.unsupported.length || raw.profile.unsupported.length) fail('UNSUPPORTED_EDIT_PROFILE');
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) fail('INVALID_OPERATION');
    const schemas = {
      replace_text: ['type', 'target_id', 'expected_old', 'new_text'],
      insert_paragraphs: ['type', 'target_id', 'expected_old', 'paragraphs'],
      create_table: ['type', 'target_id', 'expected_old', 'cells'],
    };
    const schema = schemas[operation.type];
    if (!schema || !equal(Object.keys(operation).sort(), [...schema].sort())) fail('INVALID_OPERATION');
    const id = rawId(operation.target_id, hash), block = before.blocks.find(b => b.id === id);
    if (!block || !block.editable || block.style.char_shape_ids.length !== 1) fail('TARGET_NOT_EDITABLE');
    if (operation.expected_old !== block.text) fail('EXPECTED_OLD_MISMATCH');
    const sourceRecords = recordsByBlock(raw, before);
    // Structural targets cannot carry hidden controls, range tags or binary objects.
    if (block.kind==='cell' && sourceRecords.get(id).some(r => ![66, 67, 68, 69, 72].includes(r.tag))) fail('STRUCTURAL_TARGET_HAS_CONTROLS');
    const shape = block.style.char_shape_ids[0];
    const lines = operation.type === 'replace_text' ? text(operation.new_text).split('\n')
      : operation.type === 'insert_paragraphs' ? operation.paragraphs : undefined;
    if (lines && (!Array.isArray(lines) || !lines.length || lines.length > 100
      || lines.some(line => text(line).includes('\n')) || lines.reduce((n, s) => n + s.length, 0) > 100000)) fail('INVALID_PARAGRAPHS');
    let added = 0, tableAdded = false, tableHost;
    if (operation.type !== 'replace_text' && block.kind !== 'paragraph') fail('BODY_PARAGRAPH_REQUIRED');
    const replace = (position, oldText, value) => {
      const count = [...value].length;
      if (block.kind === 'paragraph') {
        checked(doc.replaceText(block.section, position, 0, [...oldText].length, value));
        checked(doc.setCharShapeId(block.section, position, 0, count, shape));
      } else {
        checked(doc.deleteTextInCell(block.section, block.paragraph, block.control, block.cell, position, 0, [...oldText].length));
        checked(doc.insertTextInCell(block.section, block.paragraph, block.control, block.cell, position, 0, value));
        checked(doc.setCharShapeIdInCell(block.section, block.paragraph, block.control, block.cell, position, 0, count, shape));
      }
    };
    const split = (position, offset) => checked(block.kind === 'paragraph'
      ? doc.splitParagraph(block.section, position, offset)
      : doc.splitParagraphInCell(block.section, block.paragraph, block.control, block.cell, position, offset));
    if (operation.type === 'replace_text') {
      const start = block.kind === 'paragraph' ? block.paragraph : block.cell_paragraph;
      replace(start, block.text, lines[0]);
      for (let i = 1; i < lines.length; i++) {
        split(start + i - 1, [...lines[i - 1]].length);
        replace(start + i, '', lines[i]);
      }
      added = lines.length - 1;
    } else if (operation.type === 'insert_paragraphs') {
      let previous = block.text;
      for (let i = 0; i < lines.length; i++) {
        split(block.paragraph + i, [...previous].length);
        replace(block.paragraph + i + 1, '', lines[i]); previous = lines[i];
      }
      added = lines.length;
    } else {
      const cells = operation.cells;
      if (!Array.isArray(cells) || !cells.length || cells.length > 50 || !Array.isArray(cells[0])
        || !cells[0].length || cells[0].length > 50 || cells.length * cells[0].length > 256
        || cells.some(row => !Array.isArray(row) || row.length !== cells[0].length
          || row.some(value => text(value).includes('\n')))
        || cells.flat().reduce((n, s) => n + s.length, 0) > 100000) fail('INVALID_TABLE');
      const location = JSON.parse(doc.createTable(block.section, block.paragraph, [...block.text].length, cells.length, cells[0].length));
      if (!location.ok || location.paraIdx !== block.paragraph + 1 || location.controlIdx !== 0) fail('TABLE_POSITION_UNVERIFIED');
      tableHost = location.paraIdx;
      // The engine inserts two trailing empty paragraphs; retain one as the caret paragraph.
      checked(doc.deleteParagraph(block.section, tableHost + 2));
      cells.forEach((row, r) => row.forEach((value, c) => {
        checked(doc.insertTextInCell(block.section, tableHost, 0, r * row.length + c, 0, 0, value));
      }));
      added = 2; tableAdded = true;
    }
    const output = api.exportChecked(doc), reopened = api.openDocument(output);
    let after;
    try { after = api.inspectDocument(reopened, output); } finally { reopened.free(); }
    const savedRaw = readHwp(output), savedRecords = recordsByBlock(savedRaw, after);
    if (after.unsupported.length || savedRaw.profile.unsupported.length) fail('UNSUPPORTED_EDIT_PROFILE');
    const translate = (old) => {
      const result = copy(old);
      if (old.section === block.section) {
        if (block.kind === 'paragraph' && old.paragraph > block.paragraph) result.paragraph += added;
        else if (block.kind === 'cell' && old.kind === 'cell' && old.paragraph === block.paragraph
          && old.control === block.control && old.cell === block.cell && old.cell_paragraph > block.cell_paragraph) result.cell_paragraph += added;
      }
      result.id = `s${result.section}:p${result.paragraph}` + (result.kind === 'cell'
        ? `:t${result.control}:c${result.cell}:p${result.cell_paragraph}` : '');
      return result;
    };
    const originalIds = new Set();
    for (const old of before.blocks) {
      let expected = translate(old);
      const saved = after.blocks.find(b => b.id === expected.id);
      originalIds.add(expected.id);
      if (!saved) fail('CONTENT_MISMATCH');
      if (old.id === id && operation.type === 'replace_text') expected=expectedEditedBlock(expected,lines[0],true);
      if (!equal(withoutPosition(expected), withoutPosition(saved))) fail('CONTENT_MISMATCH');
      compareRecords(sourceRecords.get(old.id), savedRecords.get(expected.id), old.id === id && operation.type === 'replace_text');
    }
    const inserted = after.blocks.filter(b => !originalIds.has(b.id));
    if (tableAdded) {
      if (inserted.length !== 2 + operation.cells.flat().length || inserted.some(b => b.section !== block.section)) fail('CONTENT_MISMATCH');
      const tables = after.tables.filter(t => t.section === block.section && t.paragraph === tableHost);
      if (tables.length !== 1 || tables[0].dimensions.rowCount !== operation.cells.length
        || tables[0].dimensions.colCount !== operation.cells[0].length
        || tables[0].dimensions.cellCount !== operation.cells.flat().length) fail('TABLE_CONTENT_MISMATCH');
      for (const fresh of inserted) {
        if (fresh.kind === 'paragraph') { if (fresh.text || ![tableHost, tableHost + 1].includes(fresh.paragraph)) fail('CONTENT_MISMATCH'); }
        else if (fresh.paragraph !== tableHost || fresh.control !== 0 || fresh.cell_paragraph !== 0
          || fresh.row_span !== 1 || fresh.column_span !== 1 || fresh.text !== operation.cells[fresh.row]?.[fresh.column]) fail('TABLE_CONTENT_MISMATCH');
      }
    } else {
      const wanted = operation.type === 'replace_text' ? lines.slice(1) : lines;
      if (inserted.length !== wanted.length) fail('CONTENT_MISMATCH');
      inserted.forEach((fresh, i) => {
        const expectedPosition = (block.kind === 'paragraph' ? block.paragraph : block.cell_paragraph) + i + 1;
        const expectedId = `s${block.section}:p${block.kind === 'paragraph' ? expectedPosition : block.paragraph}`
          + (block.kind === 'cell' ? `:t${block.control}:c${block.cell}:p${expectedPosition}` : '');
        if (fresh.text !== wanted[i] || fresh.kind !== block.kind || fresh.section !== block.section
          || fresh.id !== expectedId
          || fresh.style.char_shape_ids.length !== 1 || fresh.style.char_shape_ids[0] !== shape
          || !equal(fresh.style.paragraph, block.style.paragraph)) fail('CONTENT_MISMATCH');
        if(!equal(withoutPosition(expectedEditedBlock(block,fresh.text,true)),withoutPosition(fresh)))fail('INSERTED_PARAGRAPH_STYLE_MISMATCH');
        if(savedRecords.get(fresh.id).some(r=>![66,67,68,69,72].includes(r.tag)))fail('INSERTED_PARAGRAPH_HAS_CONTROLS');
      });
    }
    const expectedTables = before.tables.map(t => {
      const result = copy(t), delta = t.section === block.section && block.kind === 'paragraph' && t.paragraph > block.paragraph ? added : 0;
      result.paragraph += delta; result.id = `s${t.section}:p${result.paragraph}:t${t.control}`;
      result.cells.forEach(cell => {
        cell.id = `${result.id}:c${cell.cell}`;
        cell.paragraph_ids = after.blocks.filter(b => b.kind === 'cell' && b.section === t.section
          && b.paragraph === result.paragraph && b.control === t.control && b.cell === cell.cell).map(b => b.id);
      });
      return result;
    });
    const existingTables = after.tables.filter(t => !(tableAdded && t.section === block.section && t.paragraph === tableHost));
    if (!equal(expectedTables, existingTables)) fail('TABLE_PRESERVATION_MISMATCH');
    verifyListCounts(savedRaw, after);
    verifyCellHeaders(raw,savedRaw,translate,tableAdded?{section:block.section,paragraph:tableHost}:null);
    verifyOutsideBody(raw, savedRaw, tableAdded);
    return { bytes: output, content_verified: true, raw_preservation_verified: true,
      raw_preservation_scope: 'existing_blocks_and_streams_with_explicit_structure_changes',
      structure_changed: true, layout_verified: false };
  } finally { doc.free(); }
}
