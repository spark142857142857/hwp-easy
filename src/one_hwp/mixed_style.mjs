// Positional preservation only: one changed span inside one existing style run.
// Equal code-point and per-code-point UTF-16 widths keep every raw style anchor.
export const MAX_MIXED_STYLE_RUNS = 32;
export function mixedStyleEdit(oldText, newText, runs) {
  if (!oldText.isWellFormed() || !newText.isWellFormed()
    || /[\u0000-\u001f]/.test(oldText + newText)
    || !Array.isArray(runs) || runs.length < 2 || runs.length > MAX_MIXED_STYLE_RUNS) return null;
  const oldPoints = [...oldText], newPoints = [...newText];
  if (oldPoints.length !== newPoints.length || oldPoints.some((p, i) => p.length !== newPoints[i].length)) return null;
  let position = 0;
  for (const run of runs) {
    if (!Number.isSafeInteger(run.start) || run.start !== position || !Number.isSafeInteger(run.end)
      || run.end <= run.start || run.end > oldPoints.length || !Number.isSafeInteger(run.char_shape_id)
      || run.char_shape_id < 0) return null;
    position = run.end;
  }
  if (position !== oldPoints.length) return null;
  let start = 0, end = oldPoints.length;
  while (start < end && oldPoints[start] === newPoints[start]) start++;
  if (start === end) return { unchanged: true };
  while (end > start && oldPoints[end - 1] === newPoints[end - 1]) end--;
  const run = runs.find(r => start >= r.start && end <= r.end);
  if (!run) return null;
  return { start, count: end - start, new_text: newPoints.slice(start, end).join(''), char_shape_id: run.char_shape_id };
}
