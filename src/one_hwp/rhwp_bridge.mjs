/** Fixed JSON bridge to the pinned WASM API. No paths, network, or arbitrary actions. */
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

// A packaged Python bridge can use an operator-selected, separately packaged
// npm runtime. Document requests cannot select this directory or executable.
const runtimeRoot = process.env.HWP_EASY_RUNTIME_DIR;
const require = createRequire(runtimeRoot
  ? pathToFileURL(path.resolve(runtimeRoot, 'package.json')) : import.meta.url);
const runtimePath = require.resolve('@rhwp/core');
const runtimeVersion = JSON.parse(fs.readFileSync(new URL('./package.json', pathToFileURL(runtimePath)), 'utf8')).version;
if (runtimeVersion !== '0.8.6') throw new Error('Pinned HWP engine version is required');
const { HwpDocument, initSync } = await import(pathToFileURL(runtimePath).href);
initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(runtimePath))) });
const EDIT_LIMIT = 100_000;
const json = (value) => JSON.parse(value);
const checked = (value) => {
  const result = json(value);
  if (result.ok !== true) throw new Error('Engine operation rejected');
  return result;
};

export function openDocument(bytes) {
  if (!Buffer.from(bytes).subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) {
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

function formatProfile(document, block) {
  const paragraph = json(block.kind === 'paragraph'
    ? document.getParaPropertiesAt(block.section, block.paragraph)
    : document.getCellParaPropertiesAt(block.section, block.paragraph, block.control,
      block.cell, block.cell_paragraph));
  const count = [...block.text].length;
  if (count > EDIT_LIMIT) return { paragraph, profile: 'edit_limit_exceeded' };
  if (/[\r\n]/.test(block.text)) return { paragraph, profile: 'existing_line_breaks_not_editable' };
  const ids = new Set();
  const first = charProperties(document, block, 0);
  ids.add(first.charShapeId);
  for (let index = 1; index < count; index++) {
    ids.add(charProperties(document, block, index).charShapeId);
  }
  return { paragraph, char_shape_ids: [...ids].sort((a, b) => a - b),
    ...(ids.size === 1 ? { char: first } : {}) };
}

export function inspectDocument(document) {
  const info = json(document.getDocumentInfo());
  const model = json(document.getCursorModel());
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
      block.style = formatProfile(document, block);
      block.editable = !block.style.profile && block.style.char_shape_ids.length === 1;
      block.edit_limit = EDIT_LIMIT;
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
      block.style = formatProfile(document, block);
      // Table-host paragraphs are read-only; their individual cell paragraphs are targets.
      block.editable = !cellBlocks.has(id) && !block.style.profile
        && block.style.char_shape_ids.length === 1;
      block.edit_limit = EDIT_LIMIT;
      blocks.push(block, ...(cellBlocks.get(id) || []));
    }
  }
  const validation = json(document.getValidationWarnings());
  return { blocks, tables: [...tables.values()], unsupported,
    warnings: [
      'Text coverage is limited to body paragraphs and top-level table cells; unsupported controls are reported separately.',
      'Layout and installed fonts have not been independently certified.',
      ...(validation.count ? ['The upstream parser reported validation warnings.'] : []),
    ], section_count: info.sectionCount, page_count: info.pageCount };
}

export function exportChecked(document) {
  const exported = document.exportHwpWithReport();
  try {
    const loss = json(exported.contentLoss());
    if (loss.count !== 0) throw new Error('Export reports content loss');
    return Buffer.from(exported.takeBytes());
  } finally {
    exported.free();
  }
}

export function editDocument(bytes, operations) {
  const document = openDocument(bytes);
  try {
    const before = inspectDocument(document);
    if (before.unsupported.length || !Array.isArray(operations) || operations.length === 0) {
      throw new Error('Unsupported edit profile');
    }
    const seen = new Set();
    const plans = operations.map((operation) => {
      if (!operation || Object.keys(operation).sort().join(',') !== 'expected_old,new_text,target_id'
        || typeof operation.new_text !== 'string' || /[\r\n\u0000-\u0008\u000b-\u001f]/.test(operation.new_text)
        || [...operation.new_text].length > EDIT_LIMIT || seen.has(operation.target_id)) {
        throw new Error('Invalid edit operation');
      }
      seen.add(operation.target_id);
      const block = before.blocks.find((item) => item.id === operation.target_id);
      if (!block || !block.editable || block.text !== operation.expected_old
        || (!operation.new_text && block.style.char_shape_ids[0] !== 0)) {
        throw new Error('Target is stale or has unsupported formatting');
      }
      return { block, operation };
    });
    for (const { block, operation } of plans) {
      const oldCount = [...block.text].length;
      const newCount = [...operation.new_text].length;
      const shapeId = block.style.char_shape_ids[0];
      if (block.kind === 'paragraph') {
        checked(document.replaceText(block.section, block.paragraph, 0, oldCount, operation.new_text));
        if (newCount) checked(document.setCharShapeId(block.section, block.paragraph, 0, newCount, shapeId));
      } else {
        checked(document.deleteTextInCell(block.section, block.paragraph, block.control,
          block.cell, block.cell_paragraph, 0, oldCount));
        checked(document.insertTextInCell(block.section, block.paragraph, block.control,
          block.cell, block.cell_paragraph, 0, operation.new_text));
        if (newCount) checked(document.setCharShapeIdInCell(block.section, block.paragraph,
          block.control, block.cell, block.cell_paragraph, 0, newCount, shapeId));
      }
    }
    const output = exportChecked(document);
    const reopened = openDocument(output);
    try {
      const after = inspectDocument(reopened);
      const expected = before.blocks.map((block) => ({ ...block,
        text: plans.find((plan) => plan.block.id === block.id)?.operation.new_text ?? block.text }));
      if (JSON.stringify(expected) !== JSON.stringify(after.blocks)
        || JSON.stringify(before.tables) !== JSON.stringify(after.tables)
        || JSON.stringify(before.unsupported) !== JSON.stringify(after.unsupported)) {
        throw new Error('Saved content or structure did not pass preservation checks');
      }
    } finally { reopened.free(); }
    return { data: output.toString('base64') };
  } finally { document.free(); }
}

export function previewDocument(document, page) {
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

export function handle(request) {
  if (request.action === 'capabilities') return {
    engine: '@rhwp/core', engine_version: '0.8.6', format: 'hwp5',
    read_profile: 'body paragraphs and top-level table cells',
    edit_profile: 'uniform character style, existing single paragraphs/cells, no existing or inserted line breaks',
    preview_format: 'svg', no_pdf_or_docx: true,
    unsupported_features: ['nested tables', 'fields and non-table controls', 'mixed character styles for editing'],
  };
  if (typeof request.data !== 'string') throw new Error('Missing HWP bytes');
  const bytes = Buffer.from(request.data, 'base64');
  if (request.action === 'edit') return editDocument(bytes, request.operations);
  const document = openDocument(bytes);
  try {
    if (request.action === 'inspect') return inspectDocument(document);
    if (request.action === 'preview') return previewDocument(document, request.page);
    throw new Error('Unknown engine operation');
  } finally { document.free(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const input = fs.readFileSync(0, 'utf8');
    if (input.length > 24 * 1024 * 1024) throw new Error('Input limit exceeded');
    process.stdout.write(JSON.stringify({ ok: true, result: handle(JSON.parse(input)) }));
  } catch {
    process.stdout.write(JSON.stringify({ ok: false, error: 'Document operation failed' }));
    process.exitCode = 1;
  }
}
