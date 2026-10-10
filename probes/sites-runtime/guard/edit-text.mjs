import { GuardError } from './records.mjs';

export const EDIT_TEXT_CONSTRAINTS = Object.freeze({ new_line_breaks_supported: false,
  c0_controls_except_tab_supported: false, well_formed_unicode_required: true,
  empty_cell_tabs_supported: false, automatic_text_normalization_allowed: false });

// Retain the INVALID_OPERATION contract. Only errors from this validation carry
// a fixed reason and a bounded, one-based operation number; never retain text.
const diagnostics = new WeakMap();
function reject(reason, operationIndex) {
  const error = new GuardError('INVALID_OPERATION');
  if (Number.isSafeInteger(operationIndex) && operationIndex >= 0 && operationIndex < 100)
    diagnostics.set(error, Object.freeze({ reason, operation_number: operationIndex + 1 }));
  throw error;
}
export function validateEditText(text, operationIndex, emptyCellFill = false) {
  if (typeof text !== 'string') throw new GuardError('INVALID_OPERATION');
  if (!text.isWellFormed()) reject('ill_formed_unicode', operationIndex);
  if (/[\r\n]/.test(text)) reject('line_breaks', operationIndex);
  if (/[\u0000-\u0008\u000b-\u001f]/.test(text)) reject('control_characters', operationIndex);
  if (emptyCellFill && text.includes('\t')) reject('empty_cell_tab', operationIndex);
}
export function editTextRejectionDiagnostic(error) {
  const value = diagnostics.get(error);
  return value ? { ...value } : undefined;
}
