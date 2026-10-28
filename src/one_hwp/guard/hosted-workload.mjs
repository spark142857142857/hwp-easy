// Conservative admission for the hosted pilot, not a measured CPU time limit
// or a guarantee that every admitted HWP fits the provider's resource budget.
import { GuardError } from './records.mjs';
export const MAX_HOSTED_BODY_TEXT_CODE_UNITS = 400000;

export function enforceHostedTextBudget(units) {
  if (units > MAX_HOSTED_BODY_TEXT_CODE_UNITS) throw new GuardError('HOSTED_WORKLOAD_LIMIT_EXCEEDED');
}
