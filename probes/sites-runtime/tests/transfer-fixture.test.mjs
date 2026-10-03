import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/make-transfer-fixture.mjs', import.meta.url));
const root = fileURLToPath(new URL('../../../', import.meta.url));

test('native transfer helper creates a validated synthetic HWP without certifying transfer or layout', async () => {
  const { stdout } = await run(process.execPath, [script]);
  const result = JSON.parse(stdout);
  const expected = path.join(await fs.realpath(root), 'outputs', 'synthetic-transfer');
  assert.equal(path.dirname(result.path), expected);
  assert.match(path.basename(result.path), /^fixture-[0-9a-f-]{36}\.hwp$/);
  try {
    const bytes = await fs.readFile(result.path);
    assert.equal(bytes.length, result.bytes);
    assert.equal(bytes.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), result.sha256);
    assert.equal(result.synthetic_only, true);
    assert.equal(result.container_and_content_verified, true);
    assert.equal(result.native_transfer_verified, false);
    assert.equal(result.layout_verified, false);
  } finally {
    // Exact newly generated test artifact only; never an input or existing file.
    await fs.unlink(result.path);
  }
});

test('native transfer helper rejects source/destination arguments before generating files', async () => {
  await assert.rejects(run(process.execPath, [script, 'personal.hwp']), (error) =>
    error.code === 1 && error.stdout === '' && error.stderr.includes('accepts no source or destination arguments'));
});
