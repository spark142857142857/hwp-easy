/** Opt-in local inspection using the hosted engine profile. No editing or network. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const maximum = 4 * 1024 * 1024;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const kinds = new Set(['control', 'nested_or_noncell_list', 'body_record',
  'paragraph_coverage_mismatch', 'page_number_profile']);
const restrictions = new Set(['RAW_CHAR_SHAPE_LAYOUT_UNVERIFIED',
  'RAW_CHAR_SHAPE_REFS_UNCOVERED', 'RAW_TEXT_RECORD_LAYOUT_UNVERIFIED']);
const styles = new Set(['edit_limit_exceeded', 'existing_line_breaks_not_editable',
  'style_scan_limit_exceeded']);
function increment(counts, key) { counts[key] = (counts[key] ?? 0) + 1; }
function fixed(value, allowed) { return allowed.has(value) ? value : 'other'; }

/** Returns only aggregates, never text, IDs, hashes, coordinates or upstream messages. */
export function classifySnapshot(snapshot) {
  const counts = { blocks: 0, body_paragraphs: 0, cell_paragraphs: 0,
    replacement_candidates: 0, empty_fill_candidates: 0, clear_candidates: 0,
    read_only_blocks: 0 };
  const restrictionCounts = {}, styleCounts = {}, seen = new Set();
  let cursor = null, pages = 0, first;
  do {
    const page = snapshot.read({ expected_sha256: snapshot.source_sha256, cursor,
      max_chars: 8000, max_blocks: 128 });
    first ??= page;
    if (++pages > 4096 || !Array.isArray(page.blocks)) throw Error('READ_CHAIN_FAILED');
    for (const block of page.blocks) {
      if (seen.has(block.id)) continue; // Count a fragmented paragraph once.
      seen.add(block.id);
      counts.blocks++;
      if (block.kind === 'paragraph') counts.body_paragraphs++;
      if (block.kind === 'cell') counts.cell_paragraphs++;
      if (block.editable && block.total_chars > 0) counts.replacement_candidates++;
      if (block.empty_cell_fill_supported) counts.empty_fill_candidates++;
      if (block.cell_text_clear_supported) counts.clear_candidates++;
      if (!(block.editable && block.total_chars > 0) && !block.empty_cell_fill_supported) counts.read_only_blocks++;
      for (const item of block.edit_restrictions ?? []) increment(restrictionCounts, fixed(item.code, restrictions));
      if (block.style?.profile) increment(styleCounts, fixed(block.style.profile, styles));
      else if (block.style?.char_shape_ids?.length > 1) increment(styleCounts, 'mixed_visible_styles');
    }
    if (page.complete !== (page.next_cursor === null)) throw Error('READ_CHAIN_FAILED');
    if (page.next_cursor && cursor && page.next_cursor.block_index === cursor.block_index
        && page.next_cursor.offset <= cursor.offset) throw Error('READ_CHAIN_FAILED');
    cursor = page.next_cursor;
  } while (cursor);
  if (counts.blocks !== first.supported_blocks) throw Error('READ_CHAIN_FAILED');
  const unsupportedCounts = {};
  for (const item of first.unsupported ?? []) increment(unsupportedCounts, fixed(item.kind, kinds));
  return { status: 'checked', read_coverage: first.all_content_supported ? 'complete_profile' : 'partial_profile',
    target_mapping_verified: first.target_mapping_verified === true,
    edit_profile_supported: first.edit_profile_supported === true,
    tables: first.table_count, preserved_control_count: first.preserved_controls?.length ?? 0,
    counts, unsupported_counts: unsupportedCounts, restriction_counts: restrictionCounts,
    style_counts: styleCounts, serialization_checked: false, layout_verified: false };
}

async function noLinks(target) {
  const absolute = path.resolve(target), parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw Error('PATH_REJECTED');
  }
}
async function readSource(source) {
  await noLinks(source);
  const stat = await fs.lstat(source);
  if (!stat.isFile() || stat.nlink !== 1) throw Error('PATH_REJECTED');
  if (stat.size > maximum) throw Error('INPUT_LIMIT_EXCEEDED');
  const handle = await fs.open(source, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > maximum || opened.ino !== stat.ino || opened.dev !== stat.dev)
      throw Error('PATH_REJECTED');
    // Bounded read, including a byte to detect concurrent growth.
    const buffer = Buffer.alloc(maximum + 1);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await handle.read(buffer, count, buffer.length - count, null);
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (count > maximum) throw Error('INPUT_LIMIT_EXCEEDED');
    return new Uint8Array(buffer.subarray(0, count));
  } finally { await handle.close(); }
}
const errorCodes = new Set(['PATH_REJECTED', 'INPUT_LIMIT_EXCEEDED', 'READ_CHAIN_FAILED']);

export async function inspectFolder(folder, engine) {
  await noLinks(folder);
  const entries = (await fs.readdir(folder, { withFileTypes: true }))
    .filter((entry) => path.extname(entry.name).toLowerCase() === '.hwp')
    .sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0);
  const documents = [];
  for (const [index, entry] of entries.entries()) {
    const source = path.join(folder, entry.name);
    let before, result = { status: 'failed', reason_code: 'INSPECTION_FAILED' };
    try {
      before = digest(await readSource(source));
      const bytes = await readSource(source);
      if (digest(bytes) !== before) throw Error('SOURCE_CHANGED');
      result = classifySnapshot(await engine.open(bytes));
    } catch (error) {
      result.reason_code = errorCodes.has(error?.message) ? error.message : 'INSPECTION_FAILED';
    } finally {
      result.source_unchanged = null;
      if (before) {
        try { result.source_unchanged = digest(await readSource(source)) === before; } catch { /* fixed report only */ }
        if (result.source_unchanged !== true) result = { status: 'failed', reason_code: 'SOURCE_RECHECK_FAILED', source_unchanged: result.source_unchanged };
      }
    }
    documents.push({ document_id: `document_${String(index + 1).padStart(4, '0')}`, ...result });
  }
  return { schema_version: 1, scope: 'hosted_engine_local_read_only', documents,
    summary: { documents: documents.length, checked: documents.filter((item) => item.status === 'checked').length,
      failed: documents.filter((item) => item.status === 'failed').length,
      complete_read_profiles: documents.filter((item) => item.read_coverage === 'complete_profile').length,
      candidate_edit_profiles: documents.filter((item) => item.edit_profile_supported).length },
    serialization_checked: false, layout_verified: false, uploaded: false, saved: false };
}

async function main() {
  try {
    if (process.argv.length !== 2) throw Error('INVALID_ARGUMENTS');
    const { createRequire } = await import('node:module');
    const { HwpDocument, initSync } = await import('@rhwp/core');
    const { createDocumentEngine } = await import('../../../src/one_hwp/engine/document.mjs');
    const require = createRequire(import.meta.url);
    initSync({ module: await fs.readFile(new URL('./rhwp_bg.wasm', pathToFileURL(require.resolve('@rhwp/core')))) });
    const report = await inspectFolder(path.join(root, 'testdocs'), createDocumentEngine(HwpDocument));
    const destination = path.join(root, 'outputs');
    await noLinks(root);
    await fs.mkdir(destination).catch((error) => { if (error.code !== 'EEXIST') throw error; });
    await noLinks(destination);
    const reportName = `hosted-local-profile-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    await fs.writeFile(path.join(destination, reportName), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ report: `outputs/${reportName}`, summary: report.summary }));
    if (!report.summary.documents || report.summary.failed) process.exitCode = 2;
  } catch {
    console.log(JSON.stringify({ status: 'failed', reason_code: 'LOCAL_PROFILE_CHECK_FAILED' }));
    process.exitCode = 2;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
