/**
 * In-memory browser/Node document contract. No paths, auth, uploads or storage.
 * The host owns file transfer, isolation and conditional durable saves.
 */
import { createEngineApi } from '../../../src/one_hwp/rhwp_api.mjs';
import { readHwp } from '../guard/container.mjs';
import { GuardError, parseRecords } from '../guard/records.mjs';
import { verifyPreservation } from '../guard/preservation.mjs';
import { pageNumberPreservationProfile } from '../guard/page-number.mjs';
import { preserveZeroCellListWords } from './cell-list-preservation.mjs';
import { rawTargetRestrictions } from './raw-target-restrictions.mjs';
import { emptyCellFillProfiles, projectVerifiedCellTextTransitions } from '../guard/empty-cell-fill.mjs';
import { cellTextClearProfiles } from '../guard/empty-cell-clear.mjs';
import { enforceRawTextBudget } from '../guard/text-budget.mjs';
import { enforceHostedTextBudget } from '../guard/hosted-workload.mjs';
import { indexUnicodeText } from './unicode-text.mjs';
import { describeEditability } from './editability.mjs';
import { mixedStyleEdit } from '../../../src/one_hwp/mixed_style.mjs';
import { mixedStyleProfiles, verifyMixedStylePreservation } from './mixed-style.mjs';

const fail = (code) => { throw new GuardError(code); };
const copy = (value) => JSON.parse(JSON.stringify(value));
const hashPattern = /^[0-9a-f]{64}$/;
const limits = Object.freeze({ max_chars: 64000, max_blocks: 128, max_operations: 100,
  max_new_chars: 500000, max_edit_chars: 100000 });
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).some((key) => !keys.includes(key))) fail('INVALID_ARGUMENTS');
}
function positive(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) fail('INVALID_LIMIT');
  return value;
}
async function sha256(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function targetId(version, id) {
  // Engine IDs are ASCII coordinates, matching the existing Python contract.
  return `hwp5:${version}:${btoa(id).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`;
}

// Only this pinned binding calls console.error with WASM strings. Suppress it
// across SYNCHRONOUS engine calls, restoring in finally before any await/yield.
// This is not a sandbox or proof of platform-wide log confidentiality.
function quietEngine(action) {
  const previous = console.error;
  try {
    console.error = () => {};
    return action();
  } catch (error) {
    // Preparation callbacks run host validation inside the same synchronous
    // engine scope. Preserve our fixed public guard codes, never engine text.
    if (error instanceof GuardError) throw error;
    fail('ENGINE_OPERATION_FAILED');
  } finally { console.error = previous; }
}

function visibleText(payload) {
  if (payload.length % 2) fail('TARGET_MAPPING_UNVERIFIED');
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const visible = new Uint8Array(payload.length);
  let offset = 0, size = 0;
  while (offset < payload.length) {
    const code = view.getUint16(offset, true);
    const extended = (code >= 1 && code <= 9) || code === 11 || code === 12 || (code >= 14 && code <= 23);
    const width = extended ? 16 : 2;
    if (offset + width > payload.length) fail('TARGET_MAPPING_UNVERIFIED');
    if (code >= 32 || code === 9 || code === 10) {
      visible[size++] = payload[offset]; visible[size++] = payload[offset + 1];
    } else if (!extended && code !== 0 && code !== 13) fail('TARGET_MAPPING_UNVERIFIED');
    offset += width;
  }
  try { return new TextDecoder('utf-16le', { fatal: true }).decode(visible.subarray(0, size)); }
  catch { fail('TARGET_MAPPING_UNVERIFIED'); }
}

/** Full ordered coverage, not a first-match text search. Duplicates are valid. */
export function mapRawTargets(decoded, blocks) {
  const mapping = new Map();
  let covered = 0;
  for (let section = 0; section < decoded.profile.sections.length; section++) {
    const paragraphs = [];
    for (const record of parseRecords(decoded.streams.get(`BodyText/Section${section}`))) {
      if (record.tag === 66) paragraphs.push({ level: record.level, text: '' });
      if (record.tag === 67) {
        if (!paragraphs.length) fail('TARGET_MAPPING_UNVERIFIED');
        const last = paragraphs.at(-1);
        if (record.level !== last.level + 1) fail('TARGET_MAPPING_UNVERIFIED');
        last.text += visibleText(record.payload);
      }
    }
    const sectionBlocks = blocks.filter((block) => block.section === section);
    if (paragraphs.length !== sectionBlocks.length) fail('TARGET_MAPPING_UNVERIFIED');
    sectionBlocks.forEach((block, index) => {
      const raw = paragraphs[index];
      // The supported profile has only root body lists and first-level cells.
      if (raw.text !== block.text || raw.level !== (block.kind === 'paragraph' ? 0 : 2)
        || mapping.has(block.id)) fail('TARGET_MAPPING_UNVERIFIED');
      mapping.set(block.id, { section, record_index: index });
    });
    covered += paragraphs.length;
  }
  if (covered !== decoded.profile.paragraph_records || covered !== blocks.length) fail('TARGET_MAPPING_UNVERIFIED');
  return mapping;
}

export function createDocumentEngine(HwpDocument, { readInspectionCache, hostedWorkloadBudget = false } = {}) {
  if (typeof hostedWorkloadBudget !== 'boolean') fail('INVALID_ARGUMENTS');
  const api = createEngineApi(HwpDocument, { mixedStyleSameLength: true });
  function inspect(bytes) {
    return quietEngine(() => {
      const document = api.openDocument(bytes);
      try { return api.inspectDocument(document); }
      finally { document.free(); }
    });
  }
  function source(input) {
    if (!(input instanceof Uint8Array)) fail('INVALID_INPUT_BYTES');
    // Bound before cloning or calling the WASM reader. Copy before async hashing.
    if (input.length > 4 * 1024 * 1024) fail('INPUT_LIMIT_EXCEEDED');
    const bytes = new Uint8Array(input);
    const raw = readHwp(bytes);
    const textUnits = enforceRawTextBudget(raw);
    if (hostedWorkloadBudget) enforceHostedTextBudget(textUnits);
    return { bytes, raw, textUnits };
  }
  async function open(input) {
    const { bytes, raw, textUnits } = source(input);
    const inspection = inspect(bytes);
    return createSnapshot(bytes, raw, inspection, await sha256(bytes), textUnits).snapshot;
  }
  async function openRead(input, scope, expectedSourceHash) {
    const { bytes, raw, textUnits } = source(input), version = await sha256(bytes);
    if (version !== expectedSourceHash) fail('BLOB_MISSING_OR_CORRUPT');
    let inspection = readInspectionCache?.get(HwpDocument, scope, version);
    if (!inspection) {
      inspection = inspect(bytes);
      readInspectionCache?.put(HwpDocument, scope, version, inspection);
    }
    // Raw admission, full raw/model mapping and target restrictions are rebuilt
    // from these freshly fetched and hashed bytes even on an inspection hit.
    const snapshot = createSnapshot(bytes, raw, inspection, version, textUnits).snapshot;
    // Only a read handle escapes this method; mutation/preview uses fresh WASM.
    return Object.freeze({ source_sha256: version, read: snapshot.read });
  }
  function forgetReads(scope) { readInspectionCache?.invalidate(scope); }
  function createSnapshot(bytes, raw, inspection, version, textUnits) {
    let mapping, mappingVerified = false;
    try { mapping = mapRawTargets(raw, inspection.blocks); mappingVerified = true; }
    catch (error) {
      if (!(error instanceof GuardError) || error.code !== 'TARGET_MAPPING_UNVERIFIED') throw error;
    }
    const unsupported = [...inspection.unsupported, ...raw.profile.unsupported];
    const pageNumberProfile = pageNumberPreservationProfile(raw, unsupported);
    if (pageNumberProfile === null) unsupported.push({ kind: 'page_number_profile',
      reason: 'Page-number control shape, root anchor or model coverage is unverified' });
    const preservedControls = pageNumberProfile ?? [];
    const emptyCellProfiles = mappingVerified ? emptyCellFillProfiles(raw, inspection.blocks, mapping) : new Map();
    const clearCellProfiles = mappingVerified ? cellTextClearProfiles(raw, inspection.blocks, mapping) : new Map();
    const mixedProfiles = mappingVerified ? mixedStyleProfiles(raw, inspection.blocks, mapping) : new Map();
    const restrictions = mappingVerified ? rawTargetRestrictions(raw, inspection.blocks, mapping, emptyCellProfiles, mixedProfiles) : new Map();
    const targets = new Map(inspection.blocks.map((block) => [targetId(version, block.id), block]));
    const textIndexes = new WeakMap();
    const textIndex = (block) => {
      if (!textIndexes.has(block)) textIndexes.set(block, indexUnicodeText(block.text));
      return textIndexes.get(block);
    };
    const allContentSupported = mappingVerified && unsupported.length === 0;
    const documentProfileSupported = unsupported.every((item) =>
      preservedControls.length && item.kind === 'control' && item.control_id === 'pgnp');
    const editableProfile = mappingVerified && documentProfileSupported;
    const editability = describeEditability({ blocks: inspection.blocks, tables: inspection.tables,
      preservedControls, mappingVerified, editableProfile, documentProfileSupported,
      restrictions, emptyCellProfiles, clearCellProfiles, mixedProfiles });
    const base = () => ({ source_sha256: version, scope: 'supported_paragraph_and_cell_blocks',
      supported_blocks: inspection.blocks.length, table_count: inspection.tables.length,
      all_content_supported: allContentSupported, edit_profile_supported: editableProfile,
      preserved_controls: copy(preservedControls),
      unsupported: copy(unsupported), target_mapping_verified: mappingVerified,
      editability_summary: copy(editability.summary),
      warnings: [...inspection.warnings,
        ...(preservedControls.length ? ['Page-number controls are preserved as opaque bytes only; their host paragraphs are read-only.'] : []),
        ...(restrictions.size ? ['Some targets have unverified raw text/style layouts and are read-only; other targets still require serialization preflight.'] : []),
        ...(!mappingVerified ? ['Raw paragraph coverage could not be matched; editing is disabled.'] : [])],
      layout_verified: false, persistence: 'none' });
    function checkVersion(expected) {
      if (typeof expected !== 'string' || !hashPattern.test(expected)) fail('INVALID_VERSION');
      if (expected !== version) fail('VERSION_CONFLICT');
    }
    function read(options = {}) {
      object(options, ['expected_sha256', 'cursor', 'max_chars', 'max_blocks']);
      checkVersion(options.expected_sha256);
      let budget = positive(options.max_chars ?? 8000, limits.max_chars);
      const maximum = positive(options.max_blocks ?? 128, limits.max_blocks);
      let index = 0, offset = 0;
      if (options.cursor != null) {
        const cursor = options.cursor;
        object(cursor, ['sha256', 'block_index', 'offset']);
        if (cursor.sha256 !== version) fail('CURSOR_VERSION_CONFLICT');
        index = cursor.block_index; offset = cursor.offset;
        const block = inspection.blocks[index];
        if (!Number.isSafeInteger(index) || !block || !Number.isSafeInteger(offset)
          || offset < 0 || offset > textIndex(block).length) fail('INVALID_CURSOR');
      }
      const start = { block_index: index, offset }, fragments = [];
      while (index < inspection.blocks.length && fragments.length < maximum) {
        const block = inspection.blocks[index], text = textIndex(block);
        if (text.length && budget === 0) break;
        const end = Math.min(text.length, offset + budget);
        // Preserve the response shape and deep-copy metadata without cloning
        // the entire source paragraph text merely to return a bounded fragment.
        fragments.push({ ...copy({ ...block, text: '' }), target_id: targetId(version, block.id),
          ...copy(editability.targets.get(block.id)),
          edit_restrictions: copy(restrictions.get(block.id) ?? []), text: text.slice(offset, end),
          start_offset: offset, end_offset: end, total_chars: text.length, fragment_complete: end === text.length });
        budget -= end - offset;
        if (end < text.length) { offset = end; break; }
        index += 1; offset = 0;
      }
      const complete = index === inspection.blocks.length;
      return { ...base(), blocks: fragments, complete, content_complete: complete && allContentSupported,
        content_complete_scope: 'unmodified_cursor_chain_from_start_not_this_page_alone',
        cursor_kind: 'validated_version_bound_position_not_authorization_or_issued_token',
        offsets: 'unicode_code_points', page_starts_at: start,
        next_cursor: complete ? null : { sha256: version, block_index: index, offset },
        edit_expected_old_scope: 'whole_block' };
    }
    function plans(options) {
      object(options, ['expected_sha256', 'operations']);
      checkVersion(options.expected_sha256);
      if (!editableProfile) fail('UNSUPPORTED_EDIT_PROFILE');
      const operations = options.operations;
      if (!Array.isArray(operations) || !operations.length || operations.length > limits.max_operations) fail('INVALID_OPERATIONS');
      const seen = new Set(); let count = 0;
      const planned = operations.map((operation) => {
        object(operation, ['target_id', 'expected_old', 'new_text']);
        if (Object.keys(operation).length !== 3 || typeof operation.target_id !== 'string'
          || typeof operation.expected_old !== 'string' || typeof operation.new_text !== 'string'
          || !operation.new_text.isWellFormed() || /[\r\n\u0000-\u0008\u000b-\u001f]/.test(operation.new_text)) fail('INVALID_OPERATION');
        const length = [...operation.new_text].length;
        count += length;
        if (length > limits.max_edit_chars || count > limits.max_new_chars) fail('EDIT_LIMIT_EXCEEDED');
        if (seen.has(operation.target_id)) fail('DUPLICATE_TARGET');
        seen.add(operation.target_id);
        const block = targets.get(operation.target_id);
        if (!block) fail('TARGET_VERSION_OR_ID_INVALID');
        if (!block.editable || restrictions.has(block.id)
          || (!mixedProfiles.has(block.id) && !length && (block.kind === 'cell' && block.text ? !clearCellProfiles.has(block.id)
            : block.style.char_shape_ids[0] !== 0))) fail('TARGET_NOT_EDITABLE');
        if (emptyCellProfiles.has(block.id) && operation.new_text.includes('\t')) fail('INVALID_OPERATION');
        if (block.text !== operation.expected_old) fail('EXPECTED_OLD_MISMATCH');
        if (mixedProfiles.has(block.id) && !mixedStyleEdit(block.text, operation.new_text, block.style.char_runs)) {
          fail('MIXED_STYLE_EDIT_UNSUPPORTED');
        }
        return { target_id: block.id, expected_old: operation.expected_old, new_text: operation.new_text };
      });
      // Every old value above has been matched to the source. Use UTF-16 units,
      // including surrogate pairs, and check the entire atomic result before
      // any mutation/layout. Never split the user's requested operations.
      if (hostedWorkloadBudget) enforceHostedTextBudget(textUnits + planned.reduce((sum, operation) =>
        sum + operation.new_text.length - operation.expected_old.length, 0));
      return planned;
    }
    function plan(options) {
      const operations = plans(options);
      return { source_sha256: version, valid: true, operation_count: operations.length,
        validation_scope: 'targets_and_values_only', serialization_checked: false,
        storage_checked: false,
        file_changed: false, persistence: 'none', layout_verified: false };
    }
    function prepareEdit(options) {
      const operations = plans(options);
      return { operations, preservePageNumbers: preservedControls.length > 0,
        clearCellTargets: new Set(operations.filter((o) => o.new_text === '' && clearCellProfiles.has(o.target_id)).map((o) => o.target_id)) };
    }
    async function edit(options) {
      const prepared = prepareEdit(options);
      const checked = quietEngine(() => api.editDocumentChecked(bytes, prepared.operations, prepared));
      return finishEdit(prepared.operations, checked);
    }
    async function finishEdit(operations, checked) {
      const candidate = checked.bytes;
      const projection = projectVerifiedCellTextTransitions(raw, readHwp(candidate), operations, emptyCellProfiles, clearCellProfiles);
      const proofSource = { ...raw, streams: projection.streams };
      const repaired = preserveZeroCellListWords(proofSource, candidate, inspection), output = repaired.bytes;
      const reopened = output === candidate ? checked.inspection : inspect(output);
      // The adapter may restore an opaque word, never change the engine model.
      if (output !== candidate && JSON.stringify(reopened) !== JSON.stringify(checked.inspection)) fail('PRESERVATION_MISMATCH');
      const after = readHwp(output);
      verifyMixedStylePreservation(after, operations, mixedProfiles);
      // api.editDocument already reopens and compares exact text/style/table model.
      // Independently match raw AFTER text and nesting to that reopened model.
      // The raw preservation canonicalizer intentionally does not prove text.
      const afterMapping = mapRawTargets(after, reopened.blocks);
      for (const [id, position] of mapping) {
        const saved = afterMapping.get(id);
        if (!saved || saved.section !== position.section || saved.record_index !== position.record_index) fail('TARGET_MAPPING_UNVERIFIED');
      }
      // Recheck exact insertion bytes after any bounded metadata repair.
      projectVerifiedCellTextTransitions(raw, after, operations, emptyCellProfiles, clearCellProfiles);
      const preservation = verifyPreservation(projection.streams, after.streams,
        operations.map((operation) => ({ ...mapping.get(operation.target_id), new_text: operation.new_text })));
      const outputVersion = await sha256(output);
      return { bytes: output, source_sha256: version, output_sha256: outputVersion,
        content_verified: true, raw_preservation_verified: preservation.verified,
        raw_preservation_scope: projection.verified_removals
          ? 'narrow_raw_record_preservation_with_verified_cell_text_transitions' : projection.verified_insertions
          ? 'narrow_raw_record_preservation_with_verified_empty_cell_insertions' : preservation.scope, layout_verified: false,
        empty_cell_text_insertions_verified: projection.verified_insertions,
        cell_text_record_removals_verified: projection.verified_removals,
        restored_cell_list_words: repaired.restored_cell_list_words,
        body_mini_sector_growth: repaired.body_mini_sector_growth,
        saved: false, persistence: 'none' };
    }
    async function preflight(options) {
      const prepared = plan(options);
      // A valid target is not proof that the writer preserves this document.
      // Run the SAME edit/reopen/raw guard as saving, but discard candidate bytes.
      // Never publish an output hash, link, receipt, or stored version here.
      const candidate = await edit(options);
      return preflightResult(prepared, candidate);
    }
    function preflightResult(prepared, candidate) {
      return { ...prepared, validation_scope: 'targets_and_in_memory_serialization',
        serialization_checked: true, content_verified: candidate.content_verified,
        raw_preservation_verified: candidate.raw_preservation_verified,
        restored_cell_list_words: candidate.restored_cell_list_words,
        body_mini_sector_growth: candidate.body_mini_sector_growth,
        empty_cell_text_insertions_verified: candidate.empty_cell_text_insertions_verified,
        cell_text_record_removals_verified: candidate.cell_text_record_removals_verified,
        raw_preservation_scope: candidate.raw_preservation_scope, saved: false };
    }
    function preview(options) {
      object(options, ['expected_sha256', 'page']); checkVersion(options.expected_sha256);
      const result = quietEngine(() => {
        const document = api.openDocument(bytes);
        try { return api.previewDocument(document, options.page); }
        finally { document.free(); }
      });
      return { ...result, source_sha256: version };
    }
    return { snapshot: Object.freeze({ source_sha256: version, read, plan, preflight, edit, preview }),
      prepareEdit, finishEdit, preflightResult };
  }
  // A fresh per-call source session performs the same source inspection, host
  // target/raw checks and writer checks without first opening a throwaway
  // snapshot. No live WASM document survives this call or crosses users.
  async function prepareChecked(input, options, expectedSourceHash) {
    try { options = structuredClone(options); } catch { fail('INVALID_ARGUMENTS'); }
    const { bytes, raw, textUnits } = source(input), version = await sha256(bytes);
    if (expectedSourceHash !== undefined && version !== expectedSourceHash) fail('BLOB_MISSING_OR_CORRUPT');
    let context, prepared;
    const checked = quietEngine(() => api.editDocumentPrepared(bytes, (inspection) => {
      context = createSnapshot(bytes, raw, inspection, version, textUnits);
      prepared = context.prepareEdit(options);
      return prepared;
    }));
    return { context, prepared, checked, options };
  }
  async function edit(input, options, expectedSourceHash) {
    const { context, prepared, checked } = await prepareChecked(input, options, expectedSourceHash);
    return context.finishEdit(prepared.operations, checked);
  }
  async function preflight(input, options, expectedSourceHash) {
    const { context, prepared, checked, options: copied } = await prepareChecked(input, options, expectedSourceHash);
    const result = await context.finishEdit(prepared.operations, checked);
    return context.preflightResult(context.snapshot.plan(copied), result);
  }
  return Object.freeze({ open, openRead, forgetReads, edit, preflight, limits });
}
