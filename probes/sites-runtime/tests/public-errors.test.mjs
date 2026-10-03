import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { publicErrorCode } from '../host/public-errors.mjs';

test('fixed uppercase guard, storage and host error codes retain their public contract', () => {
  let checked = 0;
  // Keep this registry explicit. A new fixed error must be reviewed before it
  // becomes public; arbitrary runtime values and lowercase container codes are
  // deliberately not exposed. Scanning literals prevents accidental regressions.
  for (const directory of ['guard', 'engine', 'storage', 'host']) {
    const base = new URL(`../${directory}/`, import.meta.url);
    for (const file of fs.readdirSync(base).filter((name) => name.endsWith('.mjs') && name !== 'public-errors.mjs')) {
      const source = fs.readFileSync(new URL(file, base), 'utf8');
      for (const [, code] of source.matchAll(/(?:fail\(|new (?:StorageError|GuardError)\(|=== |\? |: )["']([A-Z]+_[A-Z0-9_]+)["']/g)) {
        assert.equal(publicErrorCode({ code }), code, `${directory}/${file}: ${code}`); checked++;
      }
    }
  }
  assert(checked > 100);
});

test('known codes do not serialize private error messages, stacks or fields', () => {
  assert.equal(publicErrorCode({ code: 'BLOB_READ_FAILED', message: 'private file', stack: 'private URL',
    document: { secret: 'private content' } }), 'BLOB_READ_FAILED');
  for (const code of ['lowercase', 'PRIVATE_DOCUMENT_TITLE', 'ENOENT', '', null, 123]) {
    assert.equal(publicErrorCode({ code }), 'DOCUMENT_OPERATION_FAILED');
  }
});
