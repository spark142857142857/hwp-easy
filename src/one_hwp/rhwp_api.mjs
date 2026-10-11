/** Host-free pinned-engine operations shared by Node and browser ESM adapters. */
import { MAX_MIXED_STYLE_RUNS, mixedStyleEdit } from './mixed_style.mjs';
import { expectedEditedBlock } from './text_font_selection.mjs';
export function createEngineApi(HwpDocument, { mixedStyleSameLength = false, languageFontSelection = false, uniformStyleProofs, plainStyleProofs, existingLineBreaksEditable = false } = {}) {
  // Internal host opt-in: callers must independently prove exact raw style
  // anchors before/after saving. The local adapter retains its default profile.
  if (typeof mixedStyleSameLength !== 'boolean') throw new Error('Invalid mixed style profile');
  // Remote opt-in only while full language mappings and independent raw font/
  // style definitions are preserved. Local bridge remains conservative.
  if (typeof languageFontSelection !== 'boolean') throw new Error('Invalid language font profile');
  // Local structural inspection only: the host must prove requested LF/control
  // transitions and all existing/new raw records before publishing bytes.
  if (typeof existingLineBreaksEditable !== 'boolean') throw new Error('Invalid structural line break profile');
  if (uniformStyleProofs !== undefined && typeof uniformStyleProofs !== 'function') throw new Error('Invalid uniform style proof provider');
  if (plainStyleProofs !== undefined && typeof plainStyleProofs !== 'function') throw new Error('Invalid plain style proof provider');
  const EDIT_LIMIT = 100_000;
  const json = (value) => JSON.parse(value);
  const checked = (value) => {
    const result = json(value);
    if (result.ok !== true) throw new Error('Engine operation rejected');
    return result;
  };

  function openDocument(bytes) {
    if (!(bytes instanceof Uint8Array) || ![208, 207, 17, 224, 161, 177, 26, 225].every((v, i) => bytes[i] === v)) {
      throw new Error('Only binary HWP input is supported');
    }
    const document = new HwpDocument(new Uint8Array(bytes));
    if (document.getSourceFormat().toLowerCase() !== 'hwp') {
      document.free();
      throw new Error('Only binary HWP input is supported');
    }
    return document;
  }

  function charProperties(document, block, offset) {
    return json(block.kind === 'paragraph'
      ? document.getCharPropertiesAt(block.section, block.paragraph, offset)
      : document.getCellCharPropertiesAt(block.section, block.paragraph, block.control,
        block.cell, block.cell_paragraph, offset));
  }

  function needsCharShapeRestore(document, block, count, shapeId, start = 0) {
    // Insert/replace can already retain the requested shape. Check the entire
    // inserted code-point range before skipping a setter that repaginates the
    // whole document. Final reopened model/raw checks remain authoritative.
    // The upstream property query walks to each offset to determine its language.
    // Avoid adding another long-range scan: larger replacements keep the old
    // unconditional restore path. This is an optimization bound, not an edit limit.
    if (count > 1024) return true;
    for (let offset = 0; offset < count; offset++) {
      if (charProperties(document, block, start + offset).charShapeId !== shapeId) return true;
    }
    return false;
  }

  function formatProfile(document, block, budget, provenShapeId, provenRuns) {
    const paragraph = json(block.kind === 'paragraph'
      ? document.getParaPropertiesAt(block.section, block.paragraph)
      : document.getCellParaPropertiesAt(block.section, block.paragraph, block.control,
        block.cell, block.cell_paragraph));
    const count = [...block.text].length;
    if (count > EDIT_LIMIT) return { paragraph, profile: 'edit_limit_exceeded' };
    if (!existingLineBreaksEditable && /[\r\n]/.test(block.text)) return { paragraph, profile: 'existing_line_breaks_not_editable' };
    const cost = Math.max(1, count);
    if (cost > budget.remaining) return { paragraph, profile: 'style_scan_limit_exceeded' };
    budget.remaining -= cost;
    const ids = new Set();
    const first = charProperties(document, block, 0);
    // Local opt-in backed by complete raw text and shape anchors. Check the
    // reopened model at each run's boundaries and midpoint; complete raw
    // before/after preservation still proves every retained UTF-16 unit.
    if(count>2048&&Array.isArray(provenRuns)&&provenRuns.length>0&&provenRuns.length<=MAX_MIXED_STYLE_RUNS
      &&provenRuns.every((r,i)=>Number.isSafeInteger(r.start)&&Number.isSafeInteger(r.end)&&r.start===(i?provenRuns[i-1].end:0)
        &&r.end>r.start&&r.end<=count&&Number.isSafeInteger(r.char_shape_id)&&r.char_shape_id>=0)
      &&provenRuns.at(-1).end===count
      &&provenRuns.every(r=>[r.start,Math.floor((r.start+r.end-1)/2),r.end-1].every(offset=>charProperties(document,block,offset).charShapeId===r.char_shape_id))){
      const ids=[...new Set(provenRuns.map(r=>r.char_shape_id))].sort((a,b)=>a-b);
      return {paragraph,char_shape_ids:ids,...(ids.length===1?{char:first}:mixedStyleSameLength?{char_runs:provenRuns.map(r=>({...r}))}:{})};
    }
    // Internal host proof: one plain-text raw paragraph and one shape anchor,
    // matched against the complete ordered model from these exact bytes. Query
    // representative model IDs too; uncertainty keeps the original full scan.
    if (count > 2048 && Number.isSafeInteger(provenShapeId) && provenShapeId >= 0
      && first.charShapeId === provenShapeId
      && [Math.floor(count / 2), count - 1].every((offset) => charProperties(document, block, offset).charShapeId === provenShapeId)) {
      return { paragraph, char_shape_ids: [provenShapeId], char: first };
    }
    ids.add(first.charShapeId);
    const runs = [{ start: 0, end: count, char_shape_id: first.charShapeId }];
    let runsOverflow = false;
    for (let index = 1; index < count; index++) {
      const id = charProperties(document, block, index).charShapeId;
      ids.add(id);
      if (!runsOverflow && id !== runs.at(-1).char_shape_id) {
        runs.at(-1).end = index;
        if (runs.length === MAX_MIXED_STYLE_RUNS) runsOverflow = true;
        else runs.push({ start: index, end: count, char_shape_id: id });
      }
    }
    return { paragraph, char_shape_ids: [...ids].sort((a, b) => a - b),
      ...(mixedStyleSameLength && ids.size > 1 && !runsOverflow
        && block.text.isWellFormed() && !/[\u0000-\u001f]/.test(block.text) ? { char_runs: runs } : {}),
      ...(ids.size === 1 ? { char: first } : {}) };
  }

  function inspectDocument(document, sourceBytes) {
    const info = json(document.getDocumentInfo());
    const model = json(document.getCursorModel());
    const budget = { remaining: 800_000, text: 0, blocks: 0 };
    const styleOrder = [];
    const queueStyle = (block) => {
      budget.text += block.text.length;
      if (++budget.blocks > 4096 || budget.text > 2_000_000) throw new Error('Content inspection limit exceeded');
      styleOrder.push(block);
    };
    if (document.getSectionCount() > 64 || model.lists.length > 4096) throw new Error('Content inspection limit exceeded');
    const controls = json(document.getControls());
    const unsupported = [];
    for (const control of controls) {
      if (!['secd', 'cold', 'tbl'].includes(control.ctrlId)) {
        unsupported.push({ kind: 'control', control_id: control.ctrlId,
          list: control.list, paragraph: control.para,
          reason: 'Control content is not included in the first read/edit profile' });
      }
    }
    const cellLists = model.lists.filter((list) => list.isCell && list.hostListId === 0);
    for (const list of model.lists) {
      if (list.hostListId !== 0 || !list.isCell) {
        unsupported.push({ kind: 'nested_or_noncell_list', list_id: list.listId,
          reason: 'This text list is outside the first content profile' });
      }
    }
    const tables = new Map();
    const cellBlocks = new Map();
    for (const cell of cellLists) {
      const section = cell.sectionIndex;
      const paragraph = cell.hostPara;
      const control = cell.controlIndex;
      const id = `s${section}:p${paragraph}:t${control}`;
      if (!tables.has(id)) {
        tables.set(id, { id, section, paragraph, control,
          dimensions: json(document.getTableDimensions(section, paragraph, control)),
          properties: json(document.getTableProperties(section, paragraph, control)), cells: [] });
      }
      const cellId = `${id}:c${cell.cellIndex}`;
      const metadata = json(document.getCellInfo(section, paragraph, control, cell.cellIndex));
      const paragraphIds = [];
      const list = [];
      const count = document.getCellParagraphCount(section, paragraph, control, cell.cellIndex);
      for (let index = 0; index < count; index++) {
        const length = document.getCellParagraphLength(section, paragraph, control, cell.cellIndex, index);
        const block = { id: `${cellId}:p${index}`, kind: 'cell', section, paragraph,
          control, cell: cell.cellIndex, cell_paragraph: index,
          row: metadata.row, column: metadata.col, row_span: metadata.rowSpan,
          column_span: metadata.colSpan,
          text: document.getTextInCell(section, paragraph, control, cell.cellIndex, index, 0, length) };
        queueStyle(block);
        list.push(block);
        paragraphIds.push(block.id);
      }
      tables.get(id).cells.push({ id: cellId, cell: cell.cellIndex, ...metadata,
        properties: json(document.getCellProperties(section, paragraph, control, cell.cellIndex)),
        paragraph_ids: paragraphIds });
      const host = `s${section}:p${paragraph}`;
      cellBlocks.set(host, [...(cellBlocks.get(host) || []), ...list]);
    }
    const blocks = [];
    for (let section = 0; section < document.getSectionCount(); section++) {
      for (let paragraph = 0; paragraph < document.getParagraphCount(section); paragraph++) {
        const id = `s${section}:p${paragraph}`;
        const length = document.getParagraphLength(section, paragraph);
        const block = { id, kind: 'paragraph', section, paragraph,
          text: document.getTextRange(section, paragraph, 0, length) };
        queueStyle(block);
        blocks.push(block, ...(cellBlocks.get(id) || []));
      }
    }
    const proofs = uniformStyleProofs && sourceBytes instanceof Uint8Array
      ? uniformStyleProofs(new Uint8Array(sourceBytes), JSON.parse(JSON.stringify(blocks))) : undefined;
    if (proofs !== undefined && !(proofs instanceof Map)) throw new Error('Invalid uniform style proofs');
    const plainProofs=plainStyleProofs&&sourceBytes instanceof Uint8Array
      ?plainStyleProofs(new Uint8Array(sourceBytes),JSON.parse(JSON.stringify(blocks))):undefined;
    if(plainProofs!==undefined&&!(plainProofs instanceof Map))throw new Error('Invalid plain style proofs');
    // Retain the original cells-first style budget order and response fields.
    for (const block of styleOrder) {
      block.style = formatProfile(document, block, budget, proofs?.get(block.id),plainProofs?.get(block.id));
      block.editable = (block.kind === 'cell' || (!cellBlocks.has(block.id)
        && !controls.some((control) => control.ctrlId === 'pgnp' && control.list === 0 && control.para === block.paragraph)))
        && !block.style.profile
        && (block.style.char_shape_ids.length === 1 || Boolean(block.style.char_runs));
      block.edit_limit = EDIT_LIMIT;
    }
    const validation = json(document.getValidationWarnings());
    return { blocks, tables: [...tables.values()], unsupported,
      warnings: [
        'Text coverage is limited to body paragraphs and top-level table cells; unsupported controls are reported separately.',
        'Layout and installed fonts have not been independently certified.',
        ...(validation.count ? ['The upstream parser reported validation warnings.'] : []),
      ], section_count: info.sectionCount, page_count: info.pageCount };
  }

  function exportChecked(document) {
    const exported = document.exportHwpWithReport();
    try {
      const loss = json(exported.contentLoss());
      if (loss.count !== 0) throw new Error('Export reports content loss');
      return new Uint8Array(exported.takeBytes());
    } finally {
      exported.free();
    }
  }

  // Default remains conservative for the local bridge. A host may enable the
  // one preservation-only exception AFTER independent raw shape/anchor checks;
  // it must also independently compare every output control byte before saving.
  function editDocumentChecked(bytes, operations, { preservePageNumbers = false, clearCellTargets = new Set() } = {}) {
    // Remote host opt-in ONLY after independent plain-cell raw profiling. The
    // local default remains unchanged; full model/raw verification is required.
    if (!(clearCellTargets instanceof Set) || clearCellTargets.size > 100) throw new Error('Invalid clear-cell profile');
    return editDocumentPrepared(bytes, () => ({ operations, preservePageNumbers, clearCellTargets }));
  }

  // Internal synchronous preparation hook: hosts validate raw target coverage
  // against this freshly inspected source before any mutation. The callback
  // gets a detached model, never the live WASM document or authoritative model.
  function editDocumentPrepared(bytes, prepare) {
    if (typeof prepare !== 'function') throw new Error('Invalid edit preparation');
    const document = openDocument(bytes);
    try {
      const before = inspectDocument(document, bytes);
      const prepared = prepare(JSON.parse(JSON.stringify(before)));
      if (!prepared || Object.getPrototypeOf(prepared) !== Object.prototype
        || Object.keys(prepared).some((key) => !['operations', 'preservePageNumbers', 'clearCellTargets'].includes(key))) {
        throw new Error('Invalid edit preparation');
      }
      const { operations, preservePageNumbers = false, clearCellTargets = new Set() } = prepared;
      if (!(clearCellTargets instanceof Set) || clearCellTargets.size > 100) throw new Error('Invalid clear-cell profile');
      const blocking = before.unsupported.some((item) => !(preservePageNumbers === true
        && item.kind === 'control' && item.control_id === 'pgnp' && item.list === 0));
      if (blocking || !Array.isArray(operations) || operations.length === 0) {
        throw new Error('Unsupported edit profile');
      }
      const seen = new Set();
      const plans = operations.map((operation) => {
        if (!operation || Object.keys(operation).sort().join(',') !== 'expected_old,new_text,target_id'
          || typeof operation.new_text !== 'string' || !operation.new_text.isWellFormed()
          || /[\r\n\u0000-\u0008\u000b-\u001f]/.test(operation.new_text)
          || [...operation.new_text].length > EDIT_LIMIT || seen.has(operation.target_id)) {
          throw new Error('Invalid edit operation');
        }
        seen.add(operation.target_id);
        const block = before.blocks.find((item) => item.id === operation.target_id);
        if (!block || !block.editable || block.text !== operation.expected_old
          || (!operation.new_text && block.style.char_shape_ids[0] !== 0
            && !(block.kind === 'cell' && block.text && clearCellTargets.has(block.id)))) {
          throw new Error('Target is stale or has unsupported formatting');
        }
        const mixed = block.style.char_runs ? mixedStyleEdit(block.text, operation.new_text, block.style.char_runs) : undefined;
        if (mixed === null) throw new Error('Mixed style replacement is outside the supported profile');
        return { block, operation, mixed };
      });
      for (const { block, operation, mixed } of plans) {
        if (mixed) {
          if (mixed.unchanged) continue;
          // Keep unchanged text/styles, including the paragraph terminator.
          // Replacing the whole mixed paragraph can rewrite its invisible tail.
          if (block.kind === 'paragraph') {
            checked(document.replaceText(block.section, block.paragraph, mixed.start, mixed.count, mixed.new_text));
            if (needsCharShapeRestore(document, block, mixed.count, mixed.char_shape_id, mixed.start)) {
              checked(document.setCharShapeId(block.section, block.paragraph, mixed.start, mixed.start + mixed.count, mixed.char_shape_id));
            }
          } else {
            checked(document.deleteTextInCell(block.section, block.paragraph, block.control,
              block.cell, block.cell_paragraph, mixed.start, mixed.count));
            checked(document.insertTextInCell(block.section, block.paragraph, block.control,
              block.cell, block.cell_paragraph, mixed.start, mixed.new_text));
            if (needsCharShapeRestore(document, block, mixed.count, mixed.char_shape_id, mixed.start)) {
              checked(document.setCharShapeIdInCell(block.section, block.paragraph, block.control,
                block.cell, block.cell_paragraph, mixed.start, mixed.start + mixed.count, mixed.char_shape_id));
            }
          }
          continue;
        }
        const oldCount = [...block.text].length;
        const newCount = [...operation.new_text].length;
        const shapeId = block.style.char_shape_ids[0];
        if (block.kind === 'paragraph') {
          checked(document.replaceText(block.section, block.paragraph, 0, oldCount, operation.new_text));
          if (newCount && needsCharShapeRestore(document, block, newCount, shapeId)) {
            checked(document.setCharShapeId(block.section, block.paragraph, 0, newCount, shapeId));
          }
        } else {
          checked(document.deleteTextInCell(block.section, block.paragraph, block.control,
            block.cell, block.cell_paragraph, 0, oldCount));
          checked(document.insertTextInCell(block.section, block.paragraph, block.control,
            block.cell, block.cell_paragraph, 0, operation.new_text));
          if (newCount && needsCharShapeRestore(document, block, newCount, shapeId)) {
            checked(document.setCharShapeIdInCell(block.section, block.paragraph,
              block.control, block.cell, block.cell_paragraph, 0, newCount, shapeId));
          } else if (!newCount && clearCellTargets.has(block.id)) checked(document.setCharShapeIdInCell(block.section, block.paragraph,
            block.control, block.cell, block.cell_paragraph, 0, 0, shapeId));
        }
      }
      const output = exportChecked(document);
      const reopened = openDocument(output);
      try {
        const after = inspectDocument(reopened, output);
        const expected = before.blocks.map((block) => expectedEditedBlock(block,
          plans.find((plan) => plan.block.id === block.id)?.operation.new_text ?? block.text, languageFontSelection));
        if (JSON.stringify(expected) !== JSON.stringify(after.blocks)
          || JSON.stringify(before.tables) !== JSON.stringify(after.tables)
          || JSON.stringify(before.unsupported) !== JSON.stringify(after.unsupported)) {
          throw new Error('Saved content or structure did not pass preservation checks');
        }
        // The exact exported bytes have been reopened and model-checked here.
        // Hosts may reuse this inspection ONLY while those bytes are unchanged.
        return { bytes: output, inspection: after };
      } finally { reopened.free(); }
    } finally { document.free(); }
  }

  // Preserve the local bridge's byte-only contract and conservative defaults.
  function editDocument(bytes, operations, options) {
    return editDocumentChecked(bytes, operations, options).bytes;
  }

  function previewDocument(document, page) {
    const info = json(document.getDocumentInfo());
    if (!Number.isSafeInteger(page) || page < 0 || page >= info.pageCount) throw new Error('Invalid page');
    const svg = document.renderPageSvg(page);
    // Only return passive SVG. Never let document links/scripts become an active preview.
    const resources = [...svg.matchAll(/(?:href|src)\s*=\s*["']([^"']*)["']/gi)];
    if (/<(?:script|foreignObject)\b|<!DOCTYPE|<!ENTITY|\bon\w+\s*=|@import/i.test(svg)
      || resources.some((match) => !/^(?:#|data:image\/(?:png|jpeg|webp);base64,)/i.test(match[1]))
      || [...svg.matchAll(/url\s*\(\s*["']?([^)'"\s]+)/gi)].some((match) => !match[1].startsWith('#'))) {
      throw new Error('Preview contains unsupported active resources');
    }
    return { svg, page, page_count: info.pageCount, mime_type: 'image/svg+xml',
      warnings: ['Fonts and visual fidelity are unverified; this is a basic HWP preview.'],
      layout_verified: false };
  }

  return { openDocument, inspectDocument, exportChecked, editDocument, editDocumentChecked, editDocumentPrepared, previewDocument };
}
