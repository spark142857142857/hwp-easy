import assert from 'node:assert/strict';
import test from 'node:test';
import { uploadStatus } from '../host/upload-status.mjs';

test('connection success and stored tools do not imply personal import availability', () => {
  for (const origins of [false, true]) {
    const result = uploadStatus(false, origins);
    assert.equal(result.state, 'disabled'); assert.equal(result.agent_file_import_available, false);
    assert.equal(result.production_ready, false); assert.match(result.message_ko, /개인 HWP 파일 업로드는 아직 꺼져/);
  }
});
test('agent import requires both the upload flag and configured file hosts', () => {
  assert.equal(uploadStatus(true, false).state, 'file_host_not_configured');
  assert.equal(uploadStatus(true, false).agent_file_import_available, false);
  const result = uploadStatus(true, true);
  assert.equal(result.state, 'development_enabled_unverified');
  assert.equal(result.agent_file_import_available, true); assert.equal(result.production_ready, false);
});
