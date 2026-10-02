/** Host-free pinned-engine operations shared by Node and browser ESM adapters. */
export function createEngineApi(HwpDocument) {
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

  function formatProfile(document, block, budget) {
    const paragraph = json(block.kind === 'paragraph'
      ? document.getParaPropertiesAt(block.section, block.paragraph)
      : document.getCellParaPropertiesAt(block.section, block.paragraph, block.control,
        block.cell, block.cell_paragraph));
    const count = [...block.text].length;
    if (count > EDIT_LIMIT) return { paragraph, profile: 'edit_limit_exceeded' };
    if (/[\r\n]/.test(block.text)) return { paragraph, profile: 'existing_line_breaks_not_editable' };
    const cost = Math.max(1, count);
    if (cost > budget.remaining) return { paragraph, profile: 'style_scan_limit_exceeded' };
    budget.remaining -= cost;
    const ids = new Set();
    const first = charProperties(document, block, 0);
    ids.add(first.charShapeId);
    for (let index = 1; index < count; index++) {
      ids.add(charProperties(document, block, index).charShapeId);
    }
    return { paragraph, char_shape_ids: [...ids].sort((a, b) => a - b),
      ...(ids.size === 1 ? { char: first } : {}) };
  }

  function inspectDocument(document) {
    const info = json(document.getDocumentInfo());
    const model = json(document.getCursorModel());
    const budget = { remaining: 800_000, text: 0, blocks: 0 };
    const style = (block) => {
      budget.text += block.text.length;
      if (++budget.blocks > 4096 || budget.text > 2_000_000) throw new Error('Content inspection limit exceeded');
      return formatProfile(document, block, budget);
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
        block.style = style(block);
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
        block.style = style(block);
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

  function editDocument(bytes, operations) {
    const document = openDocument(bytes);
    try {
      const before = inspectDocument(document);
      if (before.unsupported.length || !Array.isArray(operations) || operations.length === 0) {
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
      return output;
    } finally { document.free(); }
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

  return { openDocument, inspectDocument, exportChecked, editDocument, previewDocument };
}
