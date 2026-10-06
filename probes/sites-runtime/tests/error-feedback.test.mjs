import assert from 'node:assert/strict';
import test from 'node:test';
import CFB from 'cfb';
import { StorageError } from '../storage/store.mjs';
import { GuardError } from '../guard/records.mjs';
import { replaceAllocatedBodyStreams } from '../guard/container.mjs';
import { documentToolError, uploadDisabledError } from '../host/error-feedback.mjs';
import { fetchInputFile } from '../host/transfer.mjs';

const file = { download_url: 'https://files.example.invalid/private-path?token=secret',
  file_id: 'private-id', file_name: 'private-name.hwp', mime_type: 'private-mime' };
const plain = { isError: true, content: [{ type: 'text', text: 'DOCUMENT_UPLOADS_NOT_ENABLED' }] };

test('hosted workload errors give fixed safe guidance without private properties or retry advice', () => {
  const error = new GuardError('HOSTED_WORKLOAD_LIMIT_EXCEEDED');
  error.message = 'PRIVATE_SENTINEL'; error.details = file;
  const result = documentToolError(error), data = result.structuredContent.data;
  assert.equal(result.isError, true); assert.equal(result.content[0].text, error.code);
  assert.equal(data.workload_diagnostic.max_body_text_utf16_code_units, 400000);
  assert.equal(data.workload_diagnostic.saved, false);
  assert.equal(data.workload_diagnostic.retry_same_request_recommended, false);
  assert.equal(data.workload_diagnostic.automatic_partial_save_allowed, false);
  assert(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
  assert(!JSON.stringify(result).includes('secret'));
});

test('disabled import retains failure and adds only safe origin with no authority', () => {
  const error = uploadDisabledError(file);
  assert.equal(error.code, 'DOCUMENT_UPLOADS_NOT_ENABLED');
  assert.equal(error.message, error.code);
  const result = documentToolError(error);
  assert.equal(result.isError, true);
  assert.deepEqual(result.content[0], plain.content[0]);
  assert.equal(result.content.length, 2);
  assert.deepEqual(JSON.parse(result.content[1].text), result.structuredContent);
  assert.deepEqual(result.structuredContent.data.transfer_diagnostic, {
    status: 'upload_disabled_origin_only', candidate_file_origin: 'https://files.example.invalid',
    candidate_origin_is_not_authorization: true, general_uploads_enabled: false,
    network_request_made: false, input_file_bytes_received: false, stored: false,
  });
  assert.equal(result.structuredContent.layout_verified, false);
  for (const value of ['private-path', 'secret', 'private-id', 'private-name', 'private-mime']) {
    assert(!JSON.stringify(result).includes(value));
  }
});

test('malformed or unsafe descriptors preserve the plain upload-gate failure', () => {
  const invalid = [null, [], {}, { ...file, owner: 'caller' }, { ...file, file_id: '' },
    { ...file, file_name: 'x'.repeat(513) }, { ...file, mime_type: {} }];
  for (const download_url of ['not-a-url', 'http://files.example.invalid/', 'https://127.0.0.1/',
    'https://localhost/', 'https://host.internal/', 'https://user:secret@files.example.invalid/',
    'https://files.example.invalid:8443/', 'https://files.example.invalid/#secret']) {
    invalid.push({ ...file, download_url });
  }
  for (const descriptor of invalid) assert.deepEqual(documentToolError(uploadDisabledError(descriptor)), plain);
});

test('a denied HTTPS origin reports only that request origin before any fetch', async () => {
  let calls = 0, caught;
  await assert.rejects(() => fetchInputFile(file, '["https://allowed.example.invalid"]',
    async () => { calls++; throw new Error('PRIVATE_SENTINEL'); }), (error) => { caught = error; return true; });
  assert.equal(calls, 0);
  caught.details = file; caught.message = 'PRIVATE_SENTINEL';
  const result = documentToolError(caught), feedback = result.structuredContent;
  assert.equal(result.isError, true);
  assert.deepEqual(result.content[0], { type: 'text', text: 'FILE_URL_NOT_ALLOWED' });
  assert.deepEqual(JSON.parse(result.content[1].text), feedback);
  assert.deepEqual(feedback.data.transfer_diagnostic, {
    status: 'file_origin_not_allowlisted', candidate_file_origin: 'https://files.example.invalid',
    configured_file_origins_count: 1, candidate_origin_is_not_authorization: true,
    candidate_origin_allowed: false, network_request_made: false,
    input_file_bytes_received: false, stored: false, automatic_host_expansion_allowed: false,
  });
  for (const value of ['private-path', 'secret', 'private-id', 'private-name', 'private-mime',
    'allowed.example.invalid', 'PRIVATE_SENTINEL']) assert(!JSON.stringify(result).includes(value));
  feedback.data.transfer_diagnostic.candidate_file_origin = 'PRIVATE_SENTINEL';
  assert.equal(documentToolError(caught).structuredContent.data.transfer_diagnostic.candidate_file_origin,
    'https://files.example.invalid');
  caught.code = 'FILE_FETCH_FAILED';
  assert.deepEqual(documentToolError(caught), { isError: true, content: [{ type: 'text', text: 'FILE_FETCH_FAILED' }] });
});

test('unsafe descriptors, invalid configuration and forged errors cannot produce origin diagnostics', async () => {
  let calls = 0;
  for (const download_url of ['not-a-url', 'http://files.example.invalid/',
    'https://user:secret@files.example.invalid/', 'https://localhost/',
    'https://files.example.invalid:8443/', 'https://files.example.invalid/#secret']) {
    let caught;
    await assert.rejects(() => fetchInputFile({ ...file, download_url }, '["https://allowed.example.invalid"]',
      async () => { calls++; }), (error) => { caught = error; return true; });
    assert.deepEqual(documentToolError(caught), { isError: true, content: [{ type: 'text', text: 'FILE_URL_NOT_ALLOWED' }] });
  }
  let invalidConfig;
  await assert.rejects(() => fetchInputFile(file, '[]', async () => { calls++; }),
    (error) => { invalidConfig = error; return true; });
  assert.deepEqual(documentToolError(invalidConfig), { isError: true, content: [{ type: 'text', text: 'FILE_HOST_NOT_CONFIGURED' }] });
  assert.equal(calls, 0);
  for (const error of [new StorageError('FILE_URL_NOT_ALLOWED'), {
    code: 'FILE_URL_NOT_ALLOWED', candidate_file_origin: file.download_url, transfer_diagnostic: file }]) {
    assert.deepEqual(documentToolError(error), { isError: true, content: [{ type: 'text', text: 'FILE_URL_NOT_ALLOWED' }] });
  }
});

test('arbitrary error fields cannot forge diagnostics or leak private data', () => {
  for (const error of [new StorageError('DOCUMENT_UPLOADS_NOT_ENABLED'), { code: 'DOCUMENT_UPLOADS_NOT_ENABLED',
    candidate_file_origin: file.download_url, transfer_diagnostic: file, structuredContent: file }]) {
    assert.deepEqual(documentToolError(error), plain);
  }
  for (const error of [null, undefined, 'private-error', new Error('private-error'), { code: 'private-error' }]) {
    assert.deepEqual(documentToolError(error), { isError: true,
      content: [{ type: 'text', text: 'DOCUMENT_OPERATION_FAILED' }] });
  }
  const changed = uploadDisabledError(file);
  changed.code = 'OTHER_FIXED_ERROR';
  assert.deepEqual(documentToolError(changed), { isError: true, content: [{ type: 'text', text: 'DOCUMENT_OPERATION_FAILED' }] });
});

test('uppercase private codes and hostile accessors never reach the MCP error response', () => {
  const badGetter = Object.defineProperty({}, 'code', { get() { throw new Error('PRIVATE_SENTINEL'); } });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const error of [{ code: 'PRIVATE_DOCUMENT_TITLE' }, { code: 'PRIVATE_SIGNED_URL_TOKEN' },
    { code: { toString() { throw new Error('PRIVATE_SENTINEL'); } } }, badGetter, revoked.proxy]) {
    const result = documentToolError(error);
    assert.deepEqual(result, { isError: true, content: [{ type: 'text', text: 'DOCUMENT_OPERATION_FAILED' }] });
    assert(!JSON.stringify(result).includes('PRIVATE_'));
  }
});

test('untrusted save error properties cannot manufacture save diagnostics', () => {
  for (const code of ['VERSION_CONFLICT', 'DOCUMENT_VERSION_LIMIT', 'SAVE_GUARD_REJECTED']) {
    for (const error of [new StorageError(code), { code, message: 'PRIVATE_SENTINEL',
      save_diagnostic: { saved: true, current_version: 'PRIVATE_SENTINEL' } }]) {
      assert.deepEqual(documentToolError(error), { isError: true, content: [{ type: 'text', text: code }] });
    }
  }
});

test('only validated allocation failures carry numeric feedback and safe agent guidance', () => {
  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, 'BodyText/Section0', Buffer.alloc(190, 42));
  const bytes = new Uint8Array(CFB.write(cfb, { type: 'buffer', fileType: 'cfb' })), original = bytes.slice();
  let caught;
  assert.throws(() => replaceAllocatedBodyStreams(bytes,
    new Map([['BodyText/Section0', new Uint8Array(193)]])), (error) => { caught = error; return true; });
  caught.message = 'PRIVATE_DOCUMENT_TEXT'; caught.stack = 'PRIVATE_SIGNED_URL'; caught.details = file;
  const result = documentToolError(caught), feedback = result.structuredContent;
  assert.equal(result.isError, true); assert.equal(result.content[0].text, 'BODY_REPAIR_ALLOCATION_UNSUPPORTED');
  assert.deepEqual(JSON.parse(result.content[1].text), feedback);
  const d = feedback.data.edit_diagnostic;
  assert.equal(d.status, 'existing_body_allocation_mismatch');
  assert.match(d.message_ko, /재인증.*현재 엔진/);
  assert.equal(d.allocation.candidate_stream_bytes, 190); assert.equal(d.allocation.repaired_stream_bytes, 193);
  assert.equal(d.allocation.candidate_units, 3); assert.equal(d.allocation.repaired_units, 4);
  assert.equal(d.saved, false); assert.equal(d.file_changed, false);
  assert.equal(d.retry_same_request_recommended, false);
  assert.equal(d.suggested_action, 'report_limit_without_altering_request');
  assert.equal(d.automatic_partial_save_allowed, false); assert.equal(d.unrequested_edits_allowed, false);
  assert.equal(feedback.layout_verified, false);
  assert(!JSON.stringify(result).includes('PRIVATE_')); assert(!JSON.stringify(result).includes('Section0'));
  assert.deepEqual(bytes, original);
  d.allocation.candidate_stream_bytes = -1;
  assert.equal(documentToolError(caught).structuredContent.data.edit_diagnostic.allocation.candidate_stream_bytes, 190);
  for (const error of [new GuardError('BODY_REPAIR_ALLOCATION_UNSUPPORTED'), {
    code: 'BODY_REPAIR_ALLOCATION_UNSUPPORTED', edit_diagnostic: d, allocation: file, details: file }]) {
    assert.deepEqual(documentToolError(error), { isError: true,
      content: [{ type: 'text', text: 'BODY_REPAIR_ALLOCATION_UNSUPPORTED' }] });
  }
  caught.code = 'PRESERVATION_MISMATCH';
  assert.deepEqual(documentToolError(caught), { isError: true, content: [{ type: 'text', text: 'PRESERVATION_MISMATCH' }] });
});
