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
import { createEngineApi } from './rhwp_api.mjs';
const api = createEngineApi(HwpDocument);
export const openDocument = api.openDocument;
export const inspectDocument = api.inspectDocument;
export const previewDocument = api.previewDocument;
export const exportChecked = (document) => Buffer.from(api.exportChecked(document));
export const editDocument = (bytes, operations) => ({ data: Buffer.from(api.editDocument(bytes, operations)).toString('base64') });

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
