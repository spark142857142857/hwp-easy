// Developer verification only. Captured MCP results do not prove where a
// client ran or whether it displayed an attachment. Accept fixed synthetic
// source/edited bytes only; never a personal document or a download URL.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHwpChunkCollector } from '../host/document-chunks.mjs';
import { createDocumentEngine } from '../engine/document.mjs';
import { transferFixture, verifyTransferFixture, SYNTHETIC_TRANSFER_SHA256,
  SYNTHETIC_TRANSFER_BYTES } from '../host/synthetic-transfer.mjs';
import { syntheticDownloadBytes, SYNTHETIC_DOWNLOAD_SHA256,
  SYNTHETIC_DOWNLOAD_BYTES } from '../host/synthetic-download.mjs';

export const MAX_SYNTHETIC_CHUNK_INPUT_BYTES = 256 * 1024;
const fail = () => { throw new Error('SYNTHETIC_CHUNK_RESULT_INVALID'); };

export async function readSyntheticChunkInput(stream) {
  const parts = []; let size = 0;
  for await (const part of stream) {
    const bytes = Buffer.from(part);
    size += bytes.length;
    if (size > MAX_SYNTHETIC_CHUNK_INPUT_BYTES) fail();
    if (bytes.length) parts.push(bytes);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts, size))); }
  catch { fail(); }
}

export async function verifySyntheticChunkResult(input, HwpDocument) {
  if (!input || input.schema_version !== 1 || !input.pin
    || !Array.isArray(input.results) || !input.results.length || input.results.length > 32) fail();
  // Snapshot input before awaiting hashing/engine operations.
  const pin = { ...input.pin }, results = structuredClone(input.results);
  const source = pin.sha256 === SYNTHETIC_TRANSFER_SHA256;
  const edited = pin.sha256 === SYNTHETIC_DOWNLOAD_SHA256;
  if ((!source && !edited) || pin.byte_size !== (source ? SYNTHETIC_TRANSFER_BYTES : SYNTHETIC_DOWNLOAD_BYTES)) fail();
  const collector = createHwpChunkCollector(pin, pin.byte_size);
  let uniqueChunks = 0, retries = 0;
  for (const envelope of results) {
    const result = envelope?.result ?? envelope;
    const report = result?.structuredContent;
    const resources = result?.content?.filter(c => c.type === 'resource');
    if (result?.isError || report?.stage !== 'private-development' || resources?.length !== 1) fail();
    const accepted = await collector.accept(report.data, resources[0]);
    if (accepted.replayed) retries++; else uniqueChunks++;
  }
  const engine = createDocumentEngine(HwpDocument);
  const bytes = await collector.finalize(b => engine.open(b));
  // A caller-supplied hash and successful reopen are insufficient to authorize
  // this synthetic-only helper. Independently reproduce the complete fixture.
  const expected = source ? transferFixture(HwpDocument) : await syntheticDownloadBytes(HwpDocument);
  if (source) await verifyTransferFixture(expected);
  assert.deepEqual(Buffer.from(bytes), Buffer.from(expected));
  return { bytes, report: {
    document_id: pin.document_id, version_id: pin.version_id, sha256: pin.sha256,
    bytes: bytes.length, variant: source ? 'fixed_source' : 'fixed_edited',
    unique_chunks: uniqueChunks, exact_retries: retries,
    synthetic_only: true, whole_hash_verified: true, local_reopen_verified: true,
    independently_reproduced_bytes_match: true, native_client_transport_verified: false,
    native_file_attachment_verified: false, codex_cloud_client_verified: false,
    dots_client_verified: false, layout_verified: false,
  } };
}

export async function saveSyntheticChunkResult(input, HwpDocument, root) {
  const verified = await verifySyntheticChunkResult(input, HwpDocument);
  const outputRoot = path.join(root, 'outputs'), directory = path.join(outputRoot, 'synthetic-chunks');
  for (const target of [outputRoot, directory]) {
    try { await fs.mkdir(target); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = await fs.lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
  }
  const actual = await fs.realpath(directory), relative = path.relative(await fs.realpath(root), actual);
  if (relative.startsWith('..') || path.isAbsolute(relative)) fail();
  const id = randomUUID(), temporary = path.join(actual, `.pending-${id}.part`);
  const destination = path.join(actual, `retrieved-${id}.hwp`);
  let created = false;
  try {
    const file = await fs.open(temporary, 'wx', 0o600); created = true;
    try { await file.writeFile(verified.bytes); await file.sync(); }
    finally { await file.close(); }
    assert.deepEqual(await fs.readFile(temporary), Buffer.from(verified.bytes));
    // No overwrite and no partial final HWP. Unsupported hardlinks fail closed.
    await fs.link(temporary, destination);
  } finally { if (created) await fs.unlink(temporary); }
  return { ...verified.report, path: destination, local_file_saved: true };
}
