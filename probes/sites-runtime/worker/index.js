// Runtime gate only. No uploaded bytes, document IDs, file paths or persistence.
import wasmModule from './rhwp_bg.wasm';
import { HwpDocument, initSync } from '@rhwp/core';
import { readHwp } from '../guard/container.mjs';
import { GuardError, parseRecords, profileSections } from '../guard/records.mjs';
import { verifyPreservation } from '../guard/preservation.mjs';
const wasm = initSync({ module: wasmModule });
const json = JSON.parse;
const checked = (value) => { if (json(value).ok !== true) throw new Error('operation'); };
const invariant = (condition) => { if (!condition) throw new Error('verification'); };
const memoryBytes = () => wasm.memory.buffer.byteLength;
const initialMemoryBytes = memoryBytes();
const isHwp = (data) => [...data.slice(0, 8)].join(',') === '208,207,17,224,161,177,26,225';
const rawProbeScope = 'fixed_synthetic_fixtures_only';
const rawTargetMappingScope = 'unique_old_visible_text_to_section0_tag66_ordinal';

// This deliberately fixture-only mapping is NOT a product document locator.
// It accepts just Section0 of our built-in documents, with all raw paragraph
// headers covered by the already-fixed body+cell expectations below.
function visibleRecordText(payload) {
  invariant(payload.length % 2 === 0);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const visible = new Uint8Array(payload.length);
  let offset = 0, size = 0;
  while (offset < payload.length) {
    const code = view.getUint16(offset, true);
    const extended = (code >= 1 && code <= 9) || code === 11 || code === 12 || (code >= 14 && code <= 23);
    const width = extended ? 16 : 2;
    invariant(offset + width <= payload.length);
    if (code >= 32) { visible[size++] = payload[offset]; visible[size++] = payload[offset + 1]; }
    offset += width;
  }
  return new TextDecoder('utf-16le', { fatal: true }).decode(visible.subarray(0, size));
}
function fixtureTargets(decoded, oldBody, oldCell, paragraphCount) {
  invariant(decoded.profile.unsupported.length === 0 && decoded.profile.sections.length === 1);
  const paragraphs = [];
  let paragraph = -1;
  for (const record of parseRecords(decoded.streams.get('BodyText/Section0'))) {
    if (record.tag === 66) { paragraph += 1; paragraphs.push(''); }
    if (record.tag === 67) { invariant(paragraph >= 0); paragraphs[paragraph] += visibleRecordText(record.payload); }
  }
  invariant(paragraphs.length === paragraphCount && paragraphs.length === decoded.profile.paragraph_records);
  const targets = [oldBody, oldCell].map((oldText, index) => {
    const matches = paragraphs.flatMap((text, record_index) => text === oldText ? [record_index] : []);
    invariant(matches.length === 1);
    return { section: 0, record_index: matches[0],
      new_text: index === 0 ? '수정된 합성 문단 😀' : '수정된 합성 답변' };
  });
  invariant(targets[0].record_index !== targets[1].record_index);
  return targets;
}
function encodeRecords(records) {
  const length = records.reduce((sum, record) => sum + record.payload.length + (record.payload.length >= 0xfff ? 8 : 4), 0);
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
  let offset = 0;
  for (const record of records) {
    const size = record.payload.length, extended = size >= 0xfff;
    view.setUint32(offset, record.tag | (record.level << 10) | ((extended ? 0xfff : size) << 20), true);
    offset += 4;
    if (extended) { view.setUint32(offset, size, true); offset += 4; }
    bytes.set(record.payload, offset); offset += size;
  }
  return bytes;
}
function expectGuardRejection(action, code) {
  let rejected = false;
  try { action(); } catch (error) { rejected = error instanceof GuardError && error.code === code; }
  invariant(rejected);
}
function preservationNegatives(before, after, targets) {
  const records = [...parseRecords(after.get('BodyText/Section0'))];
  const targeted = new Set(targets.map((target) => target.record_index));
  let paragraph = -1, drop = -1;
  records.forEach((record, index) => {
    if (record.tag === 66) paragraph += 1;
    if (drop < 0 && record.tag === 69 && paragraph >= 0 && !targeted.has(paragraph)) drop = index;
  });
  invariant(drop >= 0);
  // Negatives mutate decoded synthetic maps, not stored or uploaded documents.
  const lost = new Map(after);
  lost.set('BodyText/Section0', encodeRecords(records.filter((_, index) => index !== drop)));
  expectGuardRejection(() => verifyPreservation(before, lost, targets), 'PRESERVATION_MISMATCH');
  const unknown = new Map(before);
  unknown.set('BodyText/Section0', encodeRecords([...parseRecords(before.get('BodyText/Section0')),
    { tag: 1000, level: 0, payload: new Uint8Array() }]));
  invariant(profileSections(unknown).unsupported.length === 1);
  // Refuse this fixed unsupported input without asking the WASM writer to edit.
  expectGuardRejection(() => verifyPreservation(unknown, unknown, targets), 'UNSUPPORTED_BODY_RECORD');
  return { non_target_record_loss_rejected: true, unknown_record_edit_rejected: true };
}
function cells(document, table) {
  return Array.from({ length: 4 }, (_, cell) => document.getTextInCell(0, table.paraIdx, table.controlIdx, cell, 0, 0,
    document.getCellParagraphLength(0, table.paraIdx, table.controlIdx, cell, 0)));
}

function exported(document) {
  const report = document.exportHwpWithReport();
  try {
    invariant(json(report.contentLoss()).count === 0);
    return report.takeBytes();
  } finally { report.free(); }
}
function body(document) {
  return Array.from({ length: document.getParagraphCount(0) }, (_, index) =>
    document.getTextRange(0, index, 0, document.getParagraphLength(0, index)));
}
function sample(long = false) {
  let data, table;
  const original = ['첫 합성 문단', long ? '가'.repeat(100_000) : '중간 합성 문단', '마지막 합성 문단'];
  const originalCells = ['문항', '합성 답변 원문', '반복 문구', '반복 문구'];
  const created = HwpDocument.createEmpty();
  try {
    created.createBlankDocument();
    original.forEach((text, index) => {
      if (index) created.splitParagraph(0, index - 1, created.getParagraphLength(0, index - 1));
      created.insertText(0, index, 0, text);
    });
    table = json(created.createTable(0, 0, created.getParagraphLength(0, 0), 2, 2));
    invariant(table.ok === true && table.paraIdx === 1 && table.controlIdx === 0);
    originalCells.forEach((text, index) =>
      created.insertTextInCell(0, table.paraIdx, table.controlIdx, index, 0, 0, text));
    data = exported(created);
  } finally { created.free(); }
  invariant(isHwp(data));
  const loaded = new HwpDocument(data);
  let output, before, target, rawBefore, rawTargets;
  try {
    before = body(loaded);
    invariant(JSON.stringify(before) === JSON.stringify([original[0], '', '', '', original[1], original[2]]));
    invariant(JSON.stringify(cells(loaded, table)) === JSON.stringify(originalCells));
    target = before.indexOf(original[1]);
    invariant(target >= 0 && before.includes(original[2]));
    const oldCell = loaded.getTextInCell(0, table.paraIdx, table.controlIdx, 1, 0, 0,
      loaded.getCellParagraphLength(0, table.paraIdx, table.controlIdx, 1, 0));
    invariant(oldCell === '합성 답변 원문');
    rawBefore = readHwp(data);
    rawTargets = fixtureTargets(rawBefore, original[1], oldCell, before.length + originalCells.length);
    checked(loaded.deleteText(0, target, 0, [...original[1]].length));
    checked(loaded.insertText(0, target, 0, '수정된 합성 문단 😀'));
    checked(loaded.deleteTextInCell(0, table.paraIdx, table.controlIdx, 1, 0, 0, [...oldCell].length));
    checked(loaded.insertTextInCell(0, table.paraIdx, table.controlIdx, 1, 0, 0, '수정된 합성 답변'));
    output = exported(loaded);
  } finally { loaded.free(); }
  invariant(isHwp(output));
  const rawAfter = readHwp(output);
  const preservation = verifyPreservation(rawBefore.streams, rawAfter.streams, rawTargets);
  invariant(preservation.verified === true && preservation.text_verified === false && preservation.layout_verified === false);
  const negativeChecks = preservationNegatives(rawBefore.streams, rawAfter.streams, rawTargets);
  const reopened = new HwpDocument(output);
  try {
    const expected = [...before];
    expected[target] = '수정된 합성 문단 😀';
    invariant(JSON.stringify(body(reopened)) === JSON.stringify(expected));
    invariant(JSON.stringify(cells(reopened, table)) === JSON.stringify(['문항', '수정된 합성 답변', '반복 문구', '반복 문구']));
    invariant(reopened.renderPageSvg(0).includes('<svg'));
    return { scenario: long ? '100k_Korean_paragraph_and_table' : 'three_paragraphs_and_table',
      input_bytes: data.length, output_bytes: output.length,
      binary_hwp: true, read_edit_reopen_svg: true, raw_preservation_probe_passed: true,
      raw_preservation_negative_checks: negativeChecks, wasm_memory_bytes: memoryBytes() };
  } finally { reopened.free(); }
}

export function runProbe() {
  const cases = [sample(), sample(true)];
  return { engine: '@rhwp/core', engine_version: '0.8.6', engine_execution_passed: true,
    raw_preservation_probe_passed: true, raw_preservation_probe_scope: rawProbeScope,
    raw_preservation_target_mapping_scope: rawTargetMappingScope,
    runtime: 'worker-esm-precompiled-wasm', cases, initial_wasm_memory_bytes: initialMemoryBytes,
    retained_wasm_memory_bytes: memoryBytes(), total_isolate_memory_measured: false,
    hancom_required: false, cloud_documents_enabled: false, document_upload_supported: false,
    independent_preservation_guard_ported: false, storage_contract_verified: false,
    user_isolation_verified: false, layout_verified: false,
    warning: 'Fixed synthetic engine/raw-preservation test only; not a production document editing service, general locator, or memory/layout/auth/storage certification.' };
}
let cached;
function probeOnce() { return cached ??= runProbe(); }
function response(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' } });
}
const tools = [{ name: 'hwp_runtime_probe',
  description: 'Run built-in synthetic HWP runtime checks only. No uploaded or personal document is accepted.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }];

export default {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    // /runtime-probe is a fixed synthetic diagnostic behind the PRIVATE Site
    // access boundary. Platform service access conveys no user document rights.
    if (request.method === 'GET' && (path === '/' || path === '/runtime-probe')) {
      try { return response(probeOnce()); }
      catch { return response({ error: 'Synthetic engine runtime check failed' }, 500); }
    }
    if (path !== '/mcp') return response({ error: 'Not found; uploads are disabled' }, 404);
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
    let rpc;
    try {
      if (Number(request.headers.get('Content-Length')) > 8192) return response({ error: 'Request too large' }, 413);
      const reader = request.body?.getReader();
      if (!reader) throw new Error();
      let size = 0, chunks = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) { await reader.cancel(); return response({ error: 'Request too large' }, 413); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      rpc = json(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!rpc || Array.isArray(rpc) || rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') throw new Error();
    } catch { return response({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid request' } }, 400); }
    if (rpc.id === undefined) return new Response(null, { status: 202 });
    const reply = (result) => response({ jsonrpc: '2.0', id: rpc.id, result });
    const error = (code, message) => response({ jsonrpc: '2.0', id: rpc.id, error: { code, message } });
    if (rpc.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} },
      serverInfo: { name: 'HWP Easy', version: '0.2.0' },
      instructions: 'Synthetic runtime checks only. Personal documents, storage, editing and uploads are not enabled.' });
    if (rpc.method === 'ping') return reply({});
    if (rpc.method === 'tools/list') return reply({ tools });
    if (rpc.method !== 'tools/call') return error(-32601, 'Method not found');
    if (!request.headers.get('oai-authenticated-user-id')) return response({ error: 'Authentication required' }, 401);
    if (rpc.params?.name !== 'hwp_runtime_probe' || !rpc.params.arguments
      || Array.isArray(rpc.params.arguments) || typeof rpc.params.arguments !== 'object'
      || Object.keys(rpc.params.arguments).length) return error(-32602, 'Invalid tool arguments');
    try {
      const result = probeOnce();
      return reply({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result });
    } catch {
      return reply({ isError: true, content: [{ type: 'text', text: 'Synthetic engine runtime check failed' }] });
    }
  }
};
