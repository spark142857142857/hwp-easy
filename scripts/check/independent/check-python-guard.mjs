/**
 * Internal developer-only, fixed synthetic corpus differential checker.
 * Generates bytes in memory; a single captured stdin/stdout oracle roundtrip
 * uses Python's actual olefile reader and the existing RhwpEngine methods.
 * No paths/bytes are accepted from users and no fixtures are written/uploaded.
 * Human output is counts or a fixed failure phase, never payloads/file names.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HwpDocument, initSync } from '@rhwp/core';
import { mixedFixture, MIXED_TEXT, MIXED_REPLACEMENT } from '../../../tests/fixtures/mixed-style-fixtures.mjs';
import { createDocumentEngine } from '../../../src/one_hwp/engine/document.mjs';
import { readHwp } from '../../../src/one_hwp/guard/container.mjs';
import { parseRecords } from '../../../src/one_hwp/guard/records.mjs';
import { canonicalRecord } from '../../../src/one_hwp/guard/preservation.mjs';

const PROTOCOL = 1;
const RESPONSE_LIMIT = 16 * 1024 * 1024;
const oraclePath = fileURLToPath(new URL('../../../tests/guard_oracle.py', import.meta.url));
const output = console.log.bind(console);
const originalConsole = { log: console.log, warn: console.warn, error: console.error };
// Fixture generation/imports may invoke a WASM panic logger. Keep all internal
// output silent, including an unexpected failure, then publish only our summary.
console.log = console.warn = console.error = () => {};

function pythonOracle(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON || 'python', [oraclePath], {
      shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000,
    });
    let size = 0, stderrWritten = false;
    const chunks = [];
    const fail = () => { child.kill(); reject(new Error('ORACLE_FAILED')); };
    child.on('error', () => reject(new Error('ORACLE_FAILED')));
    child.stdin.on('error', () => reject(new Error('ORACLE_FAILED')));
    child.stderr.on('data', () => { stderrWritten = true; });
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > RESPONSE_LIMIT) { fail(); return; }
      chunks.push(chunk);
    });
    child.on('close', (code) => {
      try {
        if (code !== 0 || stderrWritten) throw new Error('ORACLE_FAILED');
        const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (result.protocol !== PROTOCOL || result.ok !== true || !Array.isArray(result.cases)) {
          throw new Error('ORACLE_FAILED');
        }
        resolve(result);
      } catch { reject(new Error('ORACLE_FAILED')); }
    });
    // Document bytes and any machine response are memory-only and never argv.
    child.stdin.end(JSON.stringify(request));
  });
}

function canonical(bytes, targets) {
  let paragraph = -1;
  const records = [];
  for (const record of parseRecords(bytes)) {
    if (record.tag === 66) paragraph += 1;
    const value = canonicalRecord(record, paragraph, targets);
    records.push([value.tag, value.level, Buffer.from(value.payload).toString('base64')]);
  }
  return records;
}

let phase = 'fixed_corpus_generation';
try {
  assert.equal(process.argv.length, 2);
  const { corpus, fixture } = await import(new URL('../../../tests/rhwp_fixtures.mjs', import.meta.url));
  assert.equal(corpus.length, 20);
  const cases = corpus.map((options) => fixture(options));
  phase = 'javascript_binary_reader';
  const decoded = cases.map((bytes) => readHwp(bytes));
  phase = 'single_python_oracle_roundtrip';
  const oracle = await pythonOracle({ protocol: PROTOCOL,
    cases: cases.map((bytes) => ({ data: Buffer.from(bytes).toString('base64') })) });
  assert.equal(oracle.cases.length, cases.length);
  let streamComparisons = 0, profileComparisons = 0, canonicalComparisons = 0;
  let canonicalRecordComparisons = 0, docinfoComparisons = 0;
  for (let index = 0; index < cases.length; index += 1) {
    const js = decoded[index], py = oracle.cases[index];
    phase = 'decoded_stream_bytes';
    assert.equal(py.streams.length, js.streams.size);
    assert.equal(new Set(py.streams.map((stream) => stream.name)).size, js.streams.size);
    for (const stream of py.streams) {
      assert.equal(js.streams.has(stream.name), true);
      assert.equal(Buffer.from(js.streams.get(stream.name)).equals(Buffer.from(stream.bytes, 'base64')), true);
      streamComparisons += 1;
    }
    phase = 'raw_profile_counts';
    assert.equal(js.profile.paragraph_records, py.profile.paragraph_records);
    assert.deepEqual(js.profile.unsupported, py.profile.unsupported);
    assert.deepEqual(js.profile.sections, py.sections.map(({ section, paragraph_records, record_count, expanded_bytes }) =>
      ({ section, paragraph_records, record_count, expanded_bytes })));
    assert.equal(js.profile.record_count, py.sections.reduce((sum, section) => sum + section.record_count, 0));
    assert.equal(js.profile.expanded_bytes, py.sections.reduce((sum, section) => sum + section.expanded_bytes, 0));
    profileComparisons += 1;
    phase = 'canonical_body_records';
    for (const section of py.sections) {
      const bytes = js.streams.get(`BodyText/Section${section.section}`);
      const all = Array.from({ length: section.paragraph_records }, (_, ordinal) => ordinal);
      const selectors = { none: new Set(), all: new Set(all), subset: new Set(all.filter((ordinal) => ordinal % 2 === 0)) };
      for (const [selector, targets] of Object.entries(selectors)) {
        const jsCanonical = canonical(bytes, targets);
        assert.deepEqual(jsCanonical, section.canonical[selector]);
        canonicalComparisons += 1;
        canonicalRecordComparisons += jsCanonical.length;
      }
    }
    phase = 'canonical_docinfo';
    const docinfo = js.streams.get('DocInfo').slice();
    docinfo.fill(0, 18, 30); // Existing Python oracle validates the envelope.
    assert.equal(Buffer.from(docinfo).equals(Buffer.from(py.docinfo_canonical, 'base64')), true);
    docinfoComparisons += 1;
  }
  phase = 'mixed_style_real_edits';
  const require = createRequire(import.meta.url);
  initSync({ module: fs.readFileSync(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
  const mixedBytes = [], engine = createDocumentEngine(HwpDocument);
  for (const [kind, merged] of [['paragraph', false], ['cell', false], ['cell', true]]) {
    const original = mixedFixture(HwpDocument, kind, { merged });
    const snapshot = await engine.open(original);
    const target = snapshot.read({ expected_sha256: snapshot.source_sha256 }).blocks.find(b => b.text === MIXED_TEXT);
    const edited = await snapshot.edit({ expected_sha256: snapshot.source_sha256,
      operations: [{ target_id: target.target_id, expected_old: target.text, new_text: MIXED_REPLACEMENT }] });
    mixedBytes.push(original, edited.bytes);
  }
  phase = 'mixed_style_independent_olefile_roundtrip';
  const mixedOracle = await pythonOracle({ protocol: PROTOCOL,
    cases: mixedBytes.map(bytes => ({ data: Buffer.from(bytes).toString('base64') })) });
  assert.equal(mixedOracle.cases.length, 6);
  let mixedStreamComparisons = 0, mixedShapeComparisons = 0;
  for (let i = 0; i < mixedBytes.length; i++) {
    const js = readHwp(mixedBytes[i]), py = mixedOracle.cases[i];
    assert.equal(py.streams.length, js.streams.size);
    for (const stream of py.streams) {
      assert(Buffer.from(js.streams.get(stream.name)).equals(Buffer.from(stream.bytes, 'base64')));
      mixedStreamComparisons++;
    }
    if (i % 2 === 1) {
      const before = mixedOracle.cases[i - 1];
      assert.equal(py.sections.length, before.sections.length);
      for (let s = 0; s < py.sections.length; s++) {
        // Untargeted canonical records expose every original tag-68 byte.
        const originals = before.sections[s].canonical.none.filter(r => r[0] === 68);
        const saved = py.sections[s].canonical.none.filter(r => r[0] === 68);
        assert.deepEqual(saved, originals); mixedShapeComparisons += saved.length;
      }
    }
  }
  output(JSON.stringify({ differential_guard: 'passed', synthetic_cases: cases.length,
    python_oracle_roundtrips: 2, decoded_stream_comparisons: streamComparisons,
    profile_comparisons: profileComparisons, canonical_body_comparisons: canonicalComparisons,
    canonical_record_comparisons: canonicalRecordComparisons, canonical_docinfo_comparisons: docinfoComparisons,
    mixed_original_and_saved_cases: mixedBytes.length, mixed_olefile_stream_comparisons: mixedStreamComparisons,
    mixed_exact_style_record_comparisons: mixedShapeComparisons }));
} catch {
  output(JSON.stringify({ differential_guard: 'failed', phase }));
  process.exitCode = 1;
} finally {
  Object.assign(console, originalConsole);
}
