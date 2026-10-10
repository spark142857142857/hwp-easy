// Offline operator library. A trusted, initialized createDocumentEngine is
// supplied by the host. No file paths, network, storage writes or import hooks.
import { auditRecoverySnapshot, copyBoundedRecoveryMetadata, recoveryLimits } from './recovery-audit.mjs';
import { readHwp } from '../guard/container.mjs';
import { enforceRawTextBudget } from '../guard/text-budget.mjs';
import { MAX_HOSTED_BODY_TEXT_CODE_UNITS } from '../guard/hosted-workload.mjs';

export class RecoveryHwpPreflightError extends Error {
  constructor(code) { super(code); this.name = 'RecoveryHwpPreflightError'; this.code = code; }
}
const fail = code => { throw new RecoveryHwpPreflightError(code); };
export const recoveryHwpPreflightLimits = Object.freeze({ max_versions: 128,
  max_version_utf16_units: MAX_HOSTED_BODY_TEXT_CODE_UNITS,
  max_total_utf16_units: 2000000, max_total_read_pages: 512 });

function freezeSnapshot(snapshot) {
  for (const rows of Object.values(snapshot.tables)) {
    rows.forEach(Object.freeze); Object.freeze(rows);
  }
  Object.freeze(snapshot.tables); return Object.freeze(snapshot);
}

/** Hash/metadata validity does not imply that a file can be opened as HWP.
 * First capture and audit every blob and independent deletion ledger; then
 * enforce the entire batch's raw text budget BEFORE any WASM constructor.
 * Read each version from the start to the end, preserving partial-content
 * classification. The result is an immutable snapshot and copy-on-read bytes
 * from precisely this preflight, never a restore or platform backup certificate.
 * Work budgets are conservative admission limits, not a wall-clock sandbox. */
export async function preflightRecoveryHwp(input, { latestDeletions, readBlob, engine } = {}) {
  if (typeof readBlob !== 'function' || !engine || typeof engine.open !== 'function')
    fail('INVALID_RECOVERY_HWP_PREFLIGHT');
  const { snapshot, ledger } = copyBoundedRecoveryMetadata(input, latestDeletions);
  const versions = snapshot.tables.hwp_versions;
  if (versions.length > recoveryHwpPreflightLimits.max_versions)
    fail('RECOVERY_HWP_WORK_LIMIT_EXCEEDED');
  const blobs = new Map(), sizes = new Map(versions.map(row => [row.blob_key, row.byte_size]));
  const audit = await auditRecoverySnapshot(snapshot, { latestDeletions: ledger, readBlob: async key => {
    const bytes = await readBlob(key);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== sizes.get(key)
      || bytes.byteLength > recoveryLimits.max_blob_bytes) return bytes;
    const copy = Uint8Array.from(bytes); blobs.set(key, copy); return copy;
  } });
  let units = 0;
  for (const row of versions) {
    let count;
    try { count = enforceRawTextBudget(readHwp(blobs.get(row.blob_key))); }
    catch (error) {
      fail(error?.code === 'RAW_TEXT_LIMIT_EXCEEDED'
        ? 'RECOVERY_HWP_WORK_LIMIT_EXCEEDED' : 'RECOVERY_HWP_UNREADABLE');
    }
    units += count;
    if (count > recoveryHwpPreflightLimits.max_version_utf16_units
      || units > recoveryHwpPreflightLimits.max_total_utf16_units)
      fail('RECOVERY_HWP_WORK_LIMIT_EXCEEDED');
  }
  let pages = 0, completeVersions = 0, partialVersions = 0;
  for (const row of versions) {
    let opened;
    try { opened = await engine.open(blobs.get(row.blob_key).slice()); }
    catch { fail('RECOVERY_HWP_UNREADABLE'); }
    if (opened?.source_sha256 !== row.sha256 || typeof opened.read !== 'function')
      fail('RECOVERY_HWP_UNREADABLE');
    let cursor = null, last;
    do {
      if (++pages > recoveryHwpPreflightLimits.max_total_read_pages)
        fail('RECOVERY_HWP_WORK_LIMIT_EXCEEDED');
      try { last = opened.read({ expected_sha256: row.sha256, cursor, max_chars: 64000, max_blocks: 128 }); }
      catch { fail('RECOVERY_HWP_UNREADABLE'); }
      if (typeof last?.complete !== 'boolean' || typeof last.content_complete !== 'boolean'
        || !Array.isArray(last.blocks) || last.source_sha256 !== row.sha256
        || (last.content_complete && !last.complete)) fail('RECOVERY_HWP_UNREADABLE');
      if (!last.complete) {
        const next = last.next_cursor;
        const previous = cursor ?? { block_index: 0, offset: 0 };
        if (!next || next.sha256 !== row.sha256 || !Number.isSafeInteger(next.block_index)
          || !Number.isSafeInteger(next.offset) || next.block_index < 0 || next.offset < 0
          || next.block_index < previous.block_index
          || (next.block_index === previous.block_index && next.offset <= previous.offset))
          fail('RECOVERY_HWP_UNREADABLE');
        cursor = { ...next };
      }
    } while (!last.complete);
    if (last.content_complete) completeVersions++; else partialVersions++;
  }
  return { snapshot: freezeSnapshot(snapshot), readBlob: async key => blobs.get(key)?.slice(),
    proof: Object.freeze({ ...audit, hwp_reopen_verified: versions.length > 0,
      hwp_versions_checked: versions.length, hwp_content_complete_versions: completeVersions,
      hwp_partial_content_versions: partialVersions, hwp_text_utf16_units_checked: units,
      hwp_read_pages_checked: pages, hwp_editability_verified: false, layout_verified: false,
      hosted_performance_verified: false }) };
}
