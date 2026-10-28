/** Local structural edits. Kept separate from the submitted remote text profile. */
import {createLocalEngineApi as createEngineApi} from './local_api.mjs';
import { readHwp } from './guard/container.mjs';
import { GuardError, parseRecords } from './guard/records.mjs';
import { canonicalRecord, textControlBytes } from './guard/preservation.mjs';
import { mapRawTargets } from './engine/document.mjs';
import { expectedEditedBlock } from './text_font_selection.mjs';
import { packStructuralBodyRepairs } from './engine/structural-body-repair.mjs';
import { pageNumberPreservationProfile } from './guard/page-number.mjs';
import { prepareTableChange } from './local_table.mjs';
import { prepareFormatChange } from './local_format.mjs';
import { prepareMergedTableChange } from './local_merged_table.mjs';
import { prepareMergedAxisChange } from './local_merged_axis.mjs';
import {pictureProfile} from './local_picture.mjs';
import {prepareTextSplice} from './local_text.mjs';
import {prepareMultilineSplice} from './local_multiline.mjs';
import {prepareParagraphChange} from './local_paragraph.mjs';

const fail = (code) => { throw new GuardError(code); };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bytesEqual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const copy = (o) => structuredClone(o);
export function structuralProfileSupported(raw, model) {
  const unsupported = [...model.unsupported, ...raw.profile.unsupported];
  const preserved = pageNumberPreservationProfile(raw, unsupported);
  return preserved !== null && unsupported.every(item => preserved.length
    && item.kind === 'control' && item.control_id === 'pgnp');
}
export function preservableStructuralProfile(raw,model) {
  if(structuralProfileSupported(raw,model))return true;
  try{return pictureProfile(raw,model,recordsByBlock(raw,model)).length>0;}
  catch(error){if(!(error instanceof GuardError))throw error;return false;}
}
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
export function recordsByBlock(raw, model) {
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
export function verifyOutsideBody(before, after, tableAdded, definitions) {
  const retained=streams=>[...streams.keys()].filter(n=>n!=='PrvText'&&n!=='PrvImage').sort();
  if (!equal(retained(before.streams), retained(after.streams))) fail('STREAM_SET_CHANGED');
  for (const [name, original] of before.streams) {
    if (name.startsWith('BodyText/') || name === 'PrvText' || name === 'PrvImage') continue;
    const saved = after.streams.get(name);
    if (name === 'DocInfo') definitions?definitions(original,saved):verifyDocInfo(original, saved, tableAdded);
    else if (!bytesEqual(original, saved)) fail('PRESERVATION_MISMATCH');
  }
}
export function compareRecords(left, right, changed) {
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
function cellHeaders(raw) {
    const result = [];
    for (const {section} of raw.profile.sections) {
      let host = -1;
      for (const r of parseRecords(raw.streams.get(`BodyText/Section${section}`))) {
        if (r.tag === 66 && r.level === 0) host++;
        if (r.tag === 72) result.push({section,host,level:r.level,payload:r.payload});
      }
    }
    return result;
}
function matchedCellHeaders(beforeRaw, afterRaw, translate, newHost, cellChange) {
  const left = cellHeaders(beforeRaw).filter(r=>!cellChange||cellChange.header(r)!==null),right = cellHeaders(afterRaw).filter(r=>!(newHost
    && r.section===newHost.section && r.host===newHost.paragraph));
  if(cellChange?.orderHeaders){const ordered=cellChange.orderHeaders(left);left.splice(0,left.length,...ordered);}
  if(cellChange) {
    const fresh=cellChange.freshCoordinates;
    for(let i=right.length-1;i>=0;i--)if(cellChange.inTable(right[i])&&fresh.has(`${view(right[i].payload).getUint16(10,true)}:${view(right[i].payload).getUint16(8,true)}`))right.splice(i,1);
  }
  if(left.length!==right.length)fail('CELL_PRESERVATION_MISMATCH');
  left.forEach((r,i)=>{
    const target=translate({section:r.section,paragraph:r.host,kind:'paragraph'}),saved=right[i];
    if(saved.section!==target.section||saved.host!==target.paragraph||r.level!==2||saved.level!==2
      ||r.payload.length<34||saved.payload.length!==r.payload.length)fail('CELL_PRESERVATION_MISMATCH');
  });
  return left.map((r,i)=>[r,right[i]]);
}
export function verifyCellHeaders(beforeRaw, afterRaw, translate, newHost, cellChange) {
  matchedCellHeaders(beforeRaw,afterRaw,translate,newHost,cellChange).forEach(([r,saved])=>{
    const a=r.payload.slice(),b=saved.payload.slice();
    if(cellChange)cellChange.patchHeader(r,a);
    // Counts were independently checked against the complete model and raw
    // ordering. Every remaining cell-header byte stays unchanged.
    a.fill(0,0,2);b.fill(0,0,2);
    if(!bytesEqual(a,b))fail('CELL_PRESERVATION_MISMATCH');
  });
}
// The pinned writer defaults an opaque zero word to 0x0400. Restore ONLY that
// exact transition after matching complete ordered cell headers, translated
// hosts, and independently verified paragraph counts. New table headers are
// never patched. The full raw/model checks still run on the repaired bytes.
export function preserveStructuralCellWords(beforeRaw, candidate, afterRaw, before, after, translate, newHost, cellChange) {
  verifyListCounts(beforeRaw,before);verifyListCounts(afterRaw,after);
  const patches=new Map();let restored=0;
  const pairs=matchedCellHeaders(beforeRaw,afterRaw,translate,newHost,cellChange);
  if(cellChange?.extraHeaderPairs)pairs.push(...cellChange.extraHeaderPairs(beforeRaw,afterRaw));
  for(const [original,saved] of pairs) {
    const a=original.payload.slice(),b=saved.payload.slice();a.fill(0,0,2);b.fill(0,0,2);
    if(cellChange)cellChange.patchHeader(original,a);
    if(bytesEqual(a,b))continue;
    if(view(a).getUint16(6,true)!==0||view(b).getUint16(6,true)!==0x0400
      ||a.some((byte,i)=>i!==6&&i!==7&&byte!==b[i]))fail('CELL_PRESERVATION_MISMATCH');
    const name=`BodyText/Section${saved.section}`,body=afterRaw.streams.get(name);
    if(!patches.has(name))patches.set(name,body.slice());
    const offset=saved.payload.byteOffset-body.byteOffset;
    patches.get(name).set(original.payload.subarray(6,8),offset+6);restored++;
  }
  if(!restored)return {bytes:candidate,restored_cell_list_words:0};
  return {...packStructuralBodyRepairs(candidate,afterRaw,patches),restored_cell_list_words:restored};
}
export function verifyListCounts(raw, model) {
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
  const formatting=['format_text','format_paragraph'].includes(operation?.type);
  const splicing=operation?.type==='splice_text';
  const paragraphBoundary=['split_paragraph','merge_paragraph','duplicate_paragraph','delete_paragraph'].includes(operation?.type);
  const creatingBoundary=['split_paragraph','duplicate_paragraph'].includes(operation?.type);
  const api = createEngineApi(HwpDocument,{existingLineBreaksEditable:true,mixedStyleSameLength:formatting||splicing||paragraphBoundary}), raw = readHwp(source), doc = api.openDocument(source);
  try {
    const before = api.inspectDocument(doc, source);
    mapRawTargets(raw, before.blocks);
    verifyListCounts(raw, before);
    if (!preservableStructuralProfile(raw,before)) fail('UNSUPPORTED_EDIT_PROFILE');
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) fail('INVALID_OPERATION');
    const schemas = {
      replace_text: ['type', 'target_id', 'expected_old', 'new_text'],
      splice_text: ['type','target_id','expected_old','start','end','new_text'],
      split_paragraph: ['type','target_id','expected_old','offset'],
      duplicate_paragraph: ['type','target_id','expected_old'],
      insert_paragraphs: ['type', 'target_id', 'expected_old', 'paragraphs'],
      create_table: ['type', 'target_id', 'expected_old', 'cells'],
      delete_paragraph: ['type', 'target_id', 'expected_old'],
      merge_paragraph: ['type', 'target_id', 'expected_old', 'previous_target_id', 'expected_previous'],
      insert_table_row: ['type', 'target_id', 'expected_old', 'index', 'texts'],
      insert_table_column: ['type', 'target_id', 'expected_old', 'index', 'texts'],
      delete_table_row: ['type', 'target_id', 'expected_old', 'index', 'expected_cells'],
      delete_table_column: ['type', 'target_id', 'expected_old', 'index', 'expected_cells'],
      format_text: ['type','target_id','expected_old','start','end','props'],
      format_paragraph: ['type','target_id','expected_old','props'],
      split_table_cell: ['type','target_id','expected_old','expected_cells'],
      merge_table_cells: ['type','target_id','expected_old','range','expected_cells'],
    };
    const schema = schemas[operation.type];
    if (!schema || !equal(Object.keys(operation).sort(), [...schema].sort())) fail('INVALID_OPERATION');
    const id = rawId(operation.target_id, hash), block = before.blocks.find(b => b.id === id);
    if (!block || !block.editable || !formatting&&!splicing&&!paragraphBoundary&&block.style.char_shape_ids.length !== 1) fail('TARGET_NOT_EDITABLE');
    if (operation.expected_old !== block.text) fail('EXPECTED_OLD_MISMATCH');
    const sourceRecords = recordsByBlock(raw, before);
    const formatChange=formatting?prepareFormatChange(doc,raw,block,operation,sourceRecords):null;
    const textChange=splicing?(typeof operation.new_text==='string'&&operation.new_text.includes('\n')?prepareMultilineSplice:prepareTextSplice)(doc,block,operation,sourceRecords.get(id)):null;
    const tableChange=['split_table_cell','merge_table_cells'].includes(operation.type)
      ?prepareMergedTableChange(before,block,operation,sourceRecords)
      :operation.type.includes('_table_')?(before.tables.find(t=>t.section===block.section&&t.paragraph===block.paragraph&&t.control===block.control)?.cells.some(c=>c.rowSpan>1||c.colSpan>1)
       ?prepareMergedAxisChange:prepareTableChange)(before,block,operation,sourceRecords,text):null;
    const removing = ['delete_paragraph','merge_paragraph'].includes(operation.type);
    let previous;
    if(removing) {
      // The removed paragraph must be plain; never remove section/page/table controls.
      if(sourceRecords.get(id).some(r=>![66,67,68,69,72].includes(r.tag))
        || sourceRecords.get(id).some(r=>r.tag===67 && !bytesEqual(textControlBytes(r.payload),new Uint8Array([13,0]))))
        fail('STRUCTURAL_TARGET_HAS_CONTROLS');
      const position=block.kind==='cell'?block.cell_paragraph:block.paragraph;
      previous=before.blocks.find(b=>b.section===block.section && b.kind===block.kind
        && (block.kind==='paragraph'?b.paragraph===position-1
          :b.paragraph===block.paragraph&&b.control===block.control&&b.cell===block.cell&&b.cell_paragraph===position-1));
      if(operation.type==='merge_paragraph') {
        if(!previous || rawId(operation.previous_target_id,hash)!==previous.id
          || operation.expected_previous!==previous.text)fail('PREVIOUS_PARAGRAPH_MISMATCH');
        if(!previous.editable
          || !equal(previous.style.paragraph,block.style.paragraph))fail('MERGE_STYLE_MISMATCH');
        text(previous.text+block.text);
      } else if(block.kind==='cell' && !previous)fail('CELL_FIRST_PARAGRAPH_DELETE_UNSUPPORTED');
    }
    const paragraphChange=creatingBoundary||operation.type==='merge_paragraph'
      &&(block.style.char_shape_ids.length!==1||previous.style.char_shape_ids.length!==1
        ||!equal(block.style.char_shape_ids,previous.style.char_shape_ids))
      ?prepareParagraphChange(doc,block,operation,sourceRecords,previous):null;
    // Structural targets cannot carry hidden controls, range tags or binary objects.
    if (block.kind==='cell' && sourceRecords.get(id).some(r => ![66, 67, 68, 69, 72].includes(r.tag))) fail('STRUCTURAL_TARGET_HAS_CONTROLS');
    const shape = block.style.char_shape_ids[0];
    const lines = operation.type === 'replace_text' ? text(operation.new_text).split('\n')
      : operation.type === 'insert_paragraphs' ? operation.paragraphs : undefined;
    if (lines && (!Array.isArray(lines) || !lines.length || lines.length > 100
      || lines.some(line => text(line).includes('\n')) || lines.reduce((n, s) => n + s.length, 0) > 100000)) fail('INVALID_PARAGRAPHS');
    let added = 0, tableAdded = false, tableHost;
    if (!formatting&&!splicing&&!paragraphBoundary&&!tableChange && !['replace_text','delete_paragraph','merge_paragraph'].includes(operation.type) && block.kind !== 'paragraph') fail('BODY_PARAGRAPH_REQUIRED');
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
    if(formatChange)formatChange.apply();
    else if(textChange){textChange.apply();added=textChange.added??0;}
    else if(paragraphChange){paragraphChange.apply();added=creatingBoundary?1:-1;}
    else if(tableChange)tableChange.apply(doc);
    else if(removing) {
      const position=block.kind==='cell'?block.cell_paragraph:block.paragraph;
      if(operation.type==='delete_paragraph'&&block.kind==='paragraph')checked(doc.deleteParagraph(block.section,position));
      else {
        if(operation.type==='delete_paragraph')replace(position,block.text,'');
        checked(block.kind==='paragraph'?doc.mergeParagraph(block.section,position)
          :doc.mergeParagraphInCell(block.section,block.paragraph,block.control,block.cell,position));
      }
      added=-1;
    } else if (operation.type === 'replace_text') {
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
      // The engine reuses an empty paragraph as the host. Split it first so
      // creation still means AFTER the selected paragraph, preserving its ID.
      const emptyHost=block.text.length===0;
      if(emptyHost)split(block.paragraph,0);
      const location = JSON.parse(doc.createTable(block.section, block.paragraph+(emptyHost?1:0), [...block.text].length, cells.length, cells[0].length));
      if (!location.ok || location.paraIdx !== block.paragraph + 1 || location.controlIdx !== 0) fail('TABLE_POSITION_UNVERIFIED');
      tableHost = location.paraIdx;
      // The engine inserts two trailing empty paragraphs; retain one as the caret paragraph.
      if(!emptyHost)checked(doc.deleteParagraph(block.section, tableHost + 2));
      cells.forEach((row, r) => row.forEach((value, c) => {
        checked(doc.insertTextInCell(block.section, tableHost, 0, r * row.length + c, 0, 0, value));
      }));
      added = 2; tableAdded = true;
    }
    let output = api.exportChecked(doc);
    if(tableChange?.repairCandidate)output=tableChange.repairCandidate(output,readHwp(output));
    const reopened = api.openDocument(output);
    let after;
    try { after = api.inspectDocument(reopened, output); } finally { reopened.free(); }
    let savedRaw = readHwp(output);
    if (!preservableStructuralProfile(savedRaw,after)) fail('UNSUPPORTED_EDIT_PROFILE');
    const translate = (old) => {
      if(tableChange)return tableChange.translate(old);
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
    const expectedUnsupported=before.unsupported.map(item=>{
      const result=copy(item);
      if(item.kind==='control'&&item.list===0)result.paragraph=translate({kind:'paragraph',section:0,paragraph:item.paragraph}).paragraph;
      return result;
    });
    if(!equal(expectedUnsupported,after.unsupported))fail('CONTROL_PRESERVATION_MISMATCH');
    const newHost=tableAdded?{section:block.section,paragraph:tableHost}:null;
    const repaired=preserveStructuralCellWords(raw,output,savedRaw,before,after,translate,newHost,tableChange);
    if(repaired.bytes!==output) {
      const repairCheck=api.openDocument(repaired.bytes);
      try{if(!equal(api.inspectDocument(repairCheck,repaired.bytes),after))fail('PRESERVATION_MISMATCH');}
      finally{repairCheck.free();}
      output=repaired.bytes;savedRaw=readHwp(output);
    }
    const savedRecords=recordsByBlock(savedRaw,after);
    const originalIds = new Set();
    for (const old of before.blocks) {
      if(removing && old.id===id)continue;
      let expected = translate(old);
      if(!expected)continue;
      const saved = after.blocks.find(b => b.id === expected.id);
      originalIds.add(expected.id);
      if (!saved) fail('CONTENT_MISMATCH');
      if(formatChange&&old.id===id) {
        const check=api.openDocument(output);
        try{formatChange.verifyBlock(saved,check,savedRaw);}finally{check.free();}
        formatChange.verifyRecords(sourceRecords.get(old.id),savedRecords.get(expected.id),savedRaw);
        continue;
      }
      if(textChange&&old.id===id) {
        const check=api.openDocument(output);
        try{textChange.verifyBlock(saved,check);}finally{check.free();}
        textChange.verifyRecords(sourceRecords.get(old.id),savedRecords.get(expected.id));
        continue;
      }
      if(paragraphChange&&old.id===(creatingBoundary?id:previous.id)) {
        const check=api.openDocument(output);
        try{paragraphChange.verifyBlock(saved,check);}finally{check.free();}
        paragraphChange.verifyRecords(sourceRecords.get(old.id),savedRecords.get(expected.id));
        continue;
      }
      const merged=operation.type==='merge_paragraph' && old.id===previous.id;
      const changed=old.id===id&&operation.type==='replace_text'||merged;
      if (changed) expected=expectedEditedBlock(expected,merged?previous.text+block.text:lines[0],true);
      if (!equal(withoutPosition(expected), withoutPosition(saved))) fail('CONTENT_MISMATCH');
      if(tableChange && old.kind==='paragraph' && tableChange.inTable(old))tableChange.verifyHostRecords(sourceRecords.get(old.id),savedRecords.get(expected.id),compareRecords);
      else compareRecords(sourceRecords.get(old.id), savedRecords.get(expected.id), changed);
    }
    const inserted = after.blocks.filter(b => !originalIds.has(b.id));
    if(splicing&&added>0) {
      if(inserted.length!==added||after.blocks.length!==before.blocks.length+added)fail('TEXT_CONTENT_MISMATCH');
      const check=api.openDocument(output);
      try{inserted.forEach((fresh,i)=>textChange.verifyBlock(fresh,check,i+1));}finally{check.free();}
      inserted.forEach((fresh,i)=>textChange.verifyRecords(sourceRecords.get(id),savedRecords.get(fresh.id),i+1));
    } else if(formatChange||textChange) {
      if(inserted.length||after.blocks.length!==before.blocks.length)fail('FORMAT_CONTENT_MISMATCH');
    } else if(creatingBoundary) {
      if(inserted.length!==1||after.blocks.length!==before.blocks.length+1)fail('PARAGRAPH_CONTENT_MISMATCH');
      const check=api.openDocument(output);
      try{paragraphChange.verifyBlock(inserted[0],check,1);}finally{check.free();}
      paragraphChange.verifyRecords(sourceRecords.get(id),savedRecords.get(inserted[0].id),1);
    } else if(tableChange) {
      tableChange.verifyTable(after,inserted,savedRecords);
      for(const fresh of inserted)if(savedRecords.get(fresh.id).some(r=>![66,67,68,69,72].includes(r.tag)))fail('INSERTED_PARAGRAPH_HAS_CONTROLS');
    } else if(removing) {
      if(inserted.length || after.blocks.length!==before.blocks.length-1)fail('CONTENT_MISMATCH');
    } else if (tableAdded) {
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
    const unaffected=t=>!tableChange||t.id!==tableChange.table.id;
    if (!equal(expectedTables.filter(unaffected), existingTables.filter(unaffected))) fail('TABLE_PRESERVATION_MISMATCH');
    verifyListCounts(savedRaw, after);
    verifyCellHeaders(raw,savedRaw,translate,newHost,tableChange);
    verifyOutsideBody(raw, savedRaw, tableAdded,formatChange?.verifyDefinitions);
    const targetRemap=Object.fromEntries(before.blocks.map(old=>[old.id,
      removing&&old.id===id?null:translate(old)?.id??null]));
    return { bytes: output, _target_remap:targetRemap, content_verified: true, raw_preservation_verified: true,
      raw_preservation_scope: 'existing_blocks_and_streams_with_explicit_structure_changes',
      restored_cell_list_words:repaired.restored_cell_list_words,
      structure_changed: !formatting&&(!splicing||added>0), formatting_changed:formatting, text_range_changed:splicing, layout_verified: false };
  } finally { doc.free(); }
}
