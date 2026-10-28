import assert from 'node:assert/strict';
import test from 'node:test';
import { boundedBytes, configuredFileOrigins, fileDescriptorOrigin, fetchInputFile } from '../host/transfer.mjs';
import { documentTools, validateArguments } from '../host/tools.mjs';
const code = (expected) => (e) => e.code === expected && e.message === expected;
function chunks(values) {
  let index = 0, cancelled = false;
  const body = new ReadableStream({ pull(controller) {
    if (index === values.length) controller.close(); else controller.enqueue(values[index++]);
  }, cancel() { cancelled = true; } });
  return { body, cancelled: () => cancelled };
}

test('transfer copies offset views and releases its reader', async () => {
  const source = new Uint8Array([9, 1, 2, 9]), input = chunks([source.subarray(1, 3), new Uint8Array([3])]);
  const result = await boundedBytes(input.body, 3, null);
  assert.deepEqual(result, new Uint8Array([1, 2, 3])); assert.equal(input.body.locked, false);
  source[1] = 99; assert.equal(result[0], 1);
});
test('transfer cancels byte overflow even if cancellation fails', async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(6)); },
    cancel() { cancelled = true; throw new Error('private upstream failure'); } });
  await assert.rejects(() => boundedBytes(body, 5, '1'), code('TRANSFER_LIMIT_EXCEEDED'));
  assert.equal(cancelled, true); assert.equal(body.locked, false);
});
test('declared oversized and invalid lengths are rejected before reads', async () => {
  for (const length of ['6', 'NaN', '-1', '3.2']) {
    const input = chunks([new Uint8Array([1])]);
    await assert.rejects(() => boundedBytes(input.body, 5, length), code('TRANSFER_LIMIT_EXCEEDED'));
    assert.equal(input.cancelled(), true); assert.equal(input.body.locked, false);
  }
});
test('transfer rejects unreasonable internal limits', async () => {
  for (const maximum of [0, -1, Infinity, 1.1, 4 * 1024 * 1024 + 1]) {
    await assert.rejects(() => boundedBytes(null, maximum, null), code('INVALID_TRANSFER_LIMIT'));
  }
});
test('transfer rejects unreasonable internal deadlines before reading', async () => {
  for (const timeout of [0, -1, Infinity, 1.1, 30001]) {
    await assert.rejects(() => boundedBytes(null, 5, null, timeout), code('INVALID_TRANSFER_TIMEOUT'));
  }
});
test('a stalled stream times out, cancels and releases its reader', { timeout: 1000 }, async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  await assert.rejects(() => boundedBytes(body, 5, null, 20), code('TRANSFER_TIMEOUT'));
  assert.equal(cancelled, true); assert.equal(body.locked, false);
});
test('a deadline is total rather than reset by each arriving chunk', { timeout: 1000 }, async () => {
  let timer, cancelled = false;
  const body = new ReadableStream({
    start(c) { timer = setInterval(() => c.enqueue(new Uint8Array([1])), 5); },
    cancel() { clearInterval(timer); cancelled = true; },
  });
  try {
    await assert.rejects(() => boundedBytes(body, 1000, null, 30), code('TRANSFER_TIMEOUT'));
    assert.equal(cancelled, true); assert.equal(body.locked, false);
  } finally { clearInterval(timer); }
});
test('a never-settling cancellation cannot retain an overflowed reader', { timeout: 1000 }, async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(6)); },
    cancel() { cancelled = true; return new Promise(() => {}); } });
  await assert.rejects(() => boundedBytes(body, 5, null, 20), code('TRANSFER_LIMIT_EXCEEDED'));
  assert.equal(cancelled, true); assert.equal(body.locked, false);
});
test('a never-settling cancellation cannot hold a stalled read', { timeout: 1000 }, async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } });
  await assert.rejects(() => boundedBytes(body, 5, null, 20), code('TRANSFER_TIMEOUT'));
  assert.equal(cancelled, true); assert.equal(body.locked, false);
});
test('a declared overflow never waits for the upstream cancellation', { timeout: 1000 }, async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } });
  await assert.rejects(() => boundedBytes(body, 5, '6'), code('TRANSFER_LIMIT_EXCEEDED'));
  assert.equal(cancelled, true); assert.equal(body.locked, false);
});
test('fragmentation is bounded independently of total bytes', { timeout: 5000 }, async () => {
  let cancelled = false;
  const body = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array([1])); }, cancel() { cancelled = true; } });
  await assert.rejects(() => boundedBytes(body, 20000, null), code('TRANSFER_LIMIT_EXCEEDED'));
  assert.equal(cancelled, true); assert.equal(body.locked, false);
});
test('empty-chunk streams cannot loop forever', { timeout: 5000 }, async () => {
  let cancelled = false;
  const body = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(0)); }, cancel() { cancelled = true; } });
  await assert.rejects(() => boundedBytes(body, 5, null), code('TRANSFER_LIMIT_EXCEEDED'));
  assert.equal(cancelled, true); assert.equal(body.locked, false);
});
test('stream failures and non-byte chunks return fixed errors', async () => {
  const failed = new ReadableStream({ start(c) { c.error(new Error('private filename and signed URL')); } });
  await assert.rejects(() => boundedBytes(failed, 5, null), code('TRANSFER_READ_FAILED'));
  let cancelled = false;
  const wrong = new ReadableStream({ start(c) { c.enqueue('not bytes'); }, cancel() { cancelled = true; } });
  await assert.rejects(() => boundedBytes(wrong, 5, null), code('TRANSFER_READ_FAILED'));
  assert.equal(cancelled, true); assert.equal(wrong.locked, false);
});
test('empty transfers never produce an output HWP', async () => {
  await assert.rejects(() => boundedBytes(chunks([]).body, 5, '0'), code('EMPTY_TRANSFER'));
  await assert.rejects(() => boundedBytes(null, 5, null), code('EMPTY_TRANSFER'));
});
test('file origin configuration rejects unsafe or missing hosts', () => {
  for (const value of [undefined, 'bad JSON', '{}', '[]', '["http://example.com"]',
    '["https://127.0.0.1"]', '["https://localhost"]', '["https://example.com/path"]',
    '["https://user:secret@example.com"]', '["https://example.com:8443"]']) {
    assert.throws(() => configuredFileOrigins(value), code('FILE_HOST_NOT_CONFIGURED'));
  }
});
test('file URL rejection occurs before any network request', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(new Uint8Array([1])); };
  for (const download_url of ['https://other.invalid/file', 'https://files.example.invalid:8443/file',
    'https://user:secret@files.example.invalid/file', 'https://files.example.invalid/file#secret',
    'http://files.example.invalid/file']) {
    await assert.rejects(() => fetchInputFile({ file_id: 'synthetic', download_url },
      '["https://files.example.invalid"]', fetcher), code('FILE_URL_NOT_ALLOWED'));
  }
  assert.equal(calls, 0);
});
test('failed and redirected file responses are cancelled with fixed errors', async () => {
  for (const status of [302, 403, 500]) {
    const input = chunks([new Uint8Array([1])]);
    await assert.rejects(() => fetchInputFile({ file_id: 'synthetic', download_url: 'https://files.example.invalid/file' },
      '["https://files.example.invalid"]', async () => new Response(input.body, { status })), code('FILE_FETCH_FAILED'));
    assert.equal(input.cancelled(), true);
  }
});
test('failed file responses do not wait for a never-settling cancellation', { timeout: 1000 }, async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } });
  await assert.rejects(() => fetchInputFile({ file_id: 'synthetic', download_url: 'https://files.example.invalid/file' },
    '["https://files.example.invalid"]', async () => new Response(body, { status: 403 })), code('FILE_FETCH_FAILED'));
  assert.equal(cancelled, true); assert.equal(body.locked, false);
});
test('tool metadata declares complete optional file properties and safe action hints', () => {
  assert.equal(documentTools.length, 12);
  const descriptor = documentTools.find((t) => t.name === 'hwp_import');
  assert.deepEqual(descriptor._meta['openai/fileParams'], ['file']);
  assert.deepEqual(descriptor.inputSchema.properties.file.required, ['download_url', 'file_id']);
  assert.deepEqual(Object.keys(descriptor.inputSchema.properties.file.properties).sort(),
    ['download_url', 'file_id', 'file_name', 'mime_type']);
  for (const name of ['hwp_import', 'hwp_transfer_probe', 'hwp_edit', 'hwp_restore', 'hwp_delete', 'hwp_workflow_probe']) {
    assert.equal(documentTools.find((t) => t.name === name).annotations.readOnlyHint, false);
  }
  for (const name of ['hwp_read', 'hwp_plan', 'hwp_versions', 'hwp_download', 'hwp_preview']) {
    assert.equal(documentTools.find((t) => t.name === name).annotations.readOnlyHint, true);
  }
  assert.equal(documentTools.find((t) => t.name === 'hwp_edit').annotations.destructiveHint, true);
  assert.equal(documentTools.find((t) => t.name === 'hwp_delete').annotations.destructiveHint, true);
  assert.equal(validateArguments('hwp_delete', { document_id: crypto.randomUUID(), expected_version: crypto.randomUUID(),
    request_id: crypto.randomUUID(), confirmation: 'delete_everything' }), false);
  assert.equal(validateArguments('hwp_workflow_probe', { document_id: crypto.randomUUID() }), false);
  assert.equal(validateArguments('hwp_capabilities', { owner: 'untrusted' }), false);
});
test('diagnostic file metadata contains only the origin, never signed path or file identifiers', () => {
  const input = { download_url: 'https://files.example.invalid/private-name?token=private',
    file_id: 'private-id', file_name: 'private-name.hwp', mime_type: 'private-type' };
  assert.equal(fileDescriptorOrigin(input), 'https://files.example.invalid');
  assert.equal(fileDescriptorOrigin({ file_id: 'test', download_url: input.download_url }), 'https://files.example.invalid');
  for (const download_url of ['http://files.example.invalid/x', 'https://127.0.0.1/x', 'https://localhost/x',
    'https://files.internal/x', 'https://files.example.invalid/x#secret', 'https://user:secret@files.example.invalid/x']) {
    assert.throws(() => fileDescriptorOrigin({ ...input, download_url }), code('FILE_URL_NOT_ALLOWED'));
  }
});
test('synthetic probe file schema rejects caller-supplied hashes and host allowlists', () => {
  const file = { file_id: 'synthetic', download_url: 'https://files.example.invalid/signed' };
  const descriptor = documentTools.find((t) => t.name === 'hwp_transfer_probe');
  assert.deepEqual(descriptor._meta['openai/fileParams'], ['file']);
  assert.equal(descriptor.annotations.openWorldHint, true);
  assert.equal(validateArguments('hwp_transfer_probe', { file }), true);
  for (const args of [{ file, sha256: '0'.repeat(64) }, { file, origin: 'https://files.example.invalid' },
    { file, owner: 'user:x' }, { file: { ...file, sha256: '0'.repeat(64) } }]) {
    assert.equal(validateArguments('hwp_transfer_probe', args), false);
  }
});
