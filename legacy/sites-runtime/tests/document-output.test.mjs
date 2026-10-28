import assert from 'node:assert/strict';
import test from 'node:test';
import { documentOutputResource, MAX_EMBEDDED_HWP_BYTES } from '../host/document-output.mjs';
import { documentTools, validateArguments } from '../host/tools.mjs';
const metadata = (bytes) => crypto.subtle.digest('SHA-256', bytes).then((digest) => ({
  document_id: '00000000-0000-4000-8000-000000000001', version_id: '00000000-0000-4000-8000-000000000002',
  sha256: Buffer.from(digest).toString('hex'),
}));
test('embedded resource roundtrips all byte values, exact limit and a sliced Buffer without mutation', async () => {
  for (const length of [1, 256, MAX_EMBEDDED_HWP_BYTES]) {
    const backing = Buffer.alloc(length + 40, 3), source = backing.subarray(17, 17 + length);
    for (let i = 0; i < length; i++) source[i] = i % 256;
    const before = Buffer.from(backing), meta = await metadata(source), r = await documentOutputResource(source, meta);
    assert.equal(r.type, 'resource'); assert.equal(r.resource.mimeType, 'application/x-hwp');
    assert.equal(r.resource.uri, `hwp-easy://documents/${meta.document_id}/versions/${meta.version_id}/${meta.sha256}.hwp`);
    assert.deepEqual(Buffer.from(r.resource.blob, 'base64'), source); assert.deepEqual(backing, before);
  }
});
test('invalid size, metadata or mismatched bytes return only fixed failure codes', async () => {
  const source = Uint8Array.of(1, 2, 3), meta = await metadata(source);
  for (const bytes of [null, new Uint8Array(), new Uint8Array(MAX_EMBEDDED_HWP_BYTES + 1)]) {
    await assert.rejects(documentOutputResource(bytes, meta), { code: 'DOCUMENT_EMBEDDED_OUTPUT_LIMIT_EXCEEDED' });
  }
  for (const item of [null, { ...meta, document_id: '../private' }, { ...meta, version_id: 'https://private.invalid' },
    { ...meta, sha256: 'private text' }]) await assert.rejects(documentOutputResource(source, item), { code: 'INVALID_DOWNLOAD_REQUEST' });
  await assert.rejects(documentOutputResource(Uint8Array.of(4, 5, 6), meta), { code: 'BLOB_MISSING_OR_CORRUPT' });
});
test('asynchronous hash cannot race a caller changing the source Buffer', async () => {
  const source = Buffer.from([1, 2, 3]), meta = await metadata(source), pending = documentOutputResource(source, meta);
  source.fill(9); meta.document_id = '../private'; meta.sha256 = 'private'; const output = await pending;
  assert.deepEqual(Buffer.from(output.resource.blob, 'base64'), Buffer.from([1, 2, 3]));
  assert(!output.resource.uri.includes('private'));
});
test('delivery remains explicit and read-only, with no paths, credentials, owners or caller file bytes', () => {
  const args = { document_id: crypto.randomUUID(), version_id: crypto.randomUUID() };
  for (const delivery of [undefined, 'link', 'embedded']) assert.equal(validateArguments('hwp_download',
    { ...args, ...(delivery === undefined ? {} : { delivery }) }), true);
  for (const extra of [{ delivery: 'public' }, { delivery: true }, { owner: 'user:x' }, { bytes: 'private' },
    { path: '../overwrite.hwp' }, { token: 'private' }]) assert.equal(validateArguments('hwp_download', { ...args, ...extra }), false);
  const tool = documentTools.find((t) => t.name === 'hwp_download');
  assert.equal(tool.annotations.readOnlyHint, true); assert.equal(tool.annotations.openWorldHint, false);
});
