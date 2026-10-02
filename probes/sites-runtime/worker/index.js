// Runtime gate only. No uploaded bytes, document IDs, file paths or persistence.
import wasmModule from './rhwp_bg.wasm';
import { HwpDocument, initSync } from '@rhwp/core';
const wasm = initSync({ module: wasmModule });
const json = JSON.parse;
const checked = (value) => { if (json(value).ok !== true) throw new Error('operation'); };
const invariant = (condition) => { if (!condition) throw new Error('verification'); };
const memoryBytes = () => wasm.memory.buffer.byteLength;
const initialMemoryBytes = memoryBytes();
const isHwp = (data) => [...data.slice(0, 8)].join(',') === '208,207,17,224,161,177,26,225';
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
  let output, before, target;
  try {
    before = body(loaded);
    invariant(JSON.stringify(before) === JSON.stringify([original[0], '', '', '', original[1], original[2]]));
    invariant(JSON.stringify(cells(loaded, table)) === JSON.stringify(originalCells));
    target = before.indexOf(original[1]);
    invariant(target >= 0 && before.includes(original[2]));
    const oldCell = loaded.getTextInCell(0, table.paraIdx, table.controlIdx, 1, 0, 0,
      loaded.getCellParagraphLength(0, table.paraIdx, table.controlIdx, 1, 0));
    invariant(oldCell === '합성 답변 원문');
    checked(loaded.deleteText(0, target, 0, [...original[1]].length));
    checked(loaded.insertText(0, target, 0, '수정된 합성 문단 😀'));
    checked(loaded.deleteTextInCell(0, table.paraIdx, table.controlIdx, 1, 0, 0, [...oldCell].length));
    checked(loaded.insertTextInCell(0, table.paraIdx, table.controlIdx, 1, 0, 0, '수정된 합성 답변'));
    output = exported(loaded);
  } finally { loaded.free(); }
  invariant(isHwp(output));
  const reopened = new HwpDocument(output);
  try {
    const expected = [...before];
    expected[target] = '수정된 합성 문단 😀';
    invariant(JSON.stringify(body(reopened)) === JSON.stringify(expected));
    invariant(JSON.stringify(cells(reopened, table)) === JSON.stringify(['문항', '수정된 합성 답변', '반복 문구', '반복 문구']));
    invariant(reopened.renderPageSvg(0).includes('<svg'));
    return { scenario: long ? '100k_Korean_paragraph_and_table' : 'three_paragraphs_and_table',
      input_bytes: data.length, output_bytes: output.length,
      binary_hwp: true, read_edit_reopen_svg: true, wasm_memory_bytes: memoryBytes() };
  } finally { reopened.free(); }
}

export function runProbe() {
  const cases = [sample(), sample(true)];
  return { engine: '@rhwp/core', engine_version: '0.8.6', engine_execution_passed: true,
    runtime: 'worker-esm-precompiled-wasm', cases, initial_wasm_memory_bytes: initialMemoryBytes,
    retained_wasm_memory_bytes: memoryBytes(), total_isolate_memory_measured: false,
    hancom_required: false, cloud_documents_enabled: false, document_upload_supported: false,
    independent_preservation_guard_ported: false, storage_contract_verified: false,
    user_isolation_verified: false, layout_verified: false,
    warning: 'Synthetic runtime test only; not a production document editing service.' };
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
      serverInfo: { name: 'hwp-easy-runtime-probe', version: '0.1.0' },
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
