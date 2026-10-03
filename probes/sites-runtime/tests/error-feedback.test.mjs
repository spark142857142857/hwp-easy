import assert from 'node:assert/strict';
import test from 'node:test';
import { StorageError } from '../storage/store.mjs';
import { documentToolError, uploadDisabledError } from '../host/error-feedback.mjs';

const file = { download_url: 'https://files.example.invalid/private-path?token=secret',
  file_id: 'private-id', file_name: 'private-name.hwp', mime_type: 'private-mime' };
const plain = { isError: true, content: [{ type: 'text', text: 'DOCUMENT_UPLOADS_NOT_ENABLED' }] };

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
  assert.deepEqual(documentToolError(changed), { isError: true, content: [{ type: 'text', text: 'OTHER_FIXED_ERROR' }] });
});
