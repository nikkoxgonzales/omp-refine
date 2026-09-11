/**
 * Backslash-Enter continuation: the pure decision logic.
 *
 * Claude Code turns a trailing `\` + Enter into a newline instead of a
 * submit. The end-of-text question — "does this submitted text end in an
 * UNESCAPED backslash?" — is answered by counting trailing backslashes:
 * odd means the last one escapes the submit, even means the backslashes
 * escape each other and the submit stands.
 *
 * The cursor-aware variants below answer the same question at an arbitrary
 * insertion point, for `\` + Enter with the cursor mid-line: only the run
 * immediately before the cursor matters, and exactly one `\` is consumed
 * with the newline spliced in at the cursor (head and tail preserved).
 * Offsets are UTF-16 code units into the same string that is spliced, so
 * callers must validate them against that exact string.
 */

/** Number of consecutive `\` characters at the end of `text`. */
export function countTrailingBackslashes(text: string): number {
  let count = 0;
  for (let i = text.length - 1; i >= 0 && text[i] === '\\'; i--) count++;
  return count;
}

/**
 * True when Enter should become a newline: exactly when the text ends in
 * an odd number of backslashes (`foo\`, `foo\\\`). `foo\\` is false — the
 * escape hatch for a literal trailing backslash.
 */
export function hasContinuation(text: string): boolean {
  return countTrailingBackslashes(text) % 2 === 1;
}

/**
 * Number of consecutive `\` characters immediately before `offset`
 * (an insertion point: 0 means "before the first char"). Out-of-range or
 * non-integer offsets carry no cursor meaning, so they count 0 (fail open).
 */
export function countBackslashesBefore(text: string, offset: number): number {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) return 0;
  let count = 0;
  for (let i = offset - 1; i >= 0 && text[i] === '\\'; i--) count++;
  return count;
}

/**
 * True when Enter at `offset` should become a newline: exactly when the
 * run immediately before the cursor is odd (`hello \<cursor>world`).
 * Offset 0 can never continue (no char before the cursor); invalid
 * offsets are false. Note `hasContinuation(text)` is this at
 * `offset === text.length`.
 */
export function hasContinuationAt(text: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset <= 0 || offset > text.length) return false;
  return countBackslashesBefore(text, offset) % 2 === 1;
}

/**
 * Splice the continuation into `text` at `offset`: consume exactly one
 * `\` before the cursor and insert `"\n"` there, preserving head + tail
 * (`"hello \\ world"`, 7 → `"hello \n world"`). Returns undefined when
 * there is no continuation at the offset (even run, non-backslash before
 * the cursor, or an invalid offset) so the submit passes through.
 */
export function spliceContinuationAt(text: string, offset: number): string | undefined {
  if (!hasContinuationAt(text, offset)) return undefined;
  return `${text.slice(0, offset - 1)}\n${text.slice(offset)}`;
}

/**
 * True when a single draft line (no `"\n"` in it) ends in an UNESCAPED
 * backslash: an odd trailing run with nothing after it. Any trailing
 * whitespace disqualifies the line — the pre-submit snapshot preserves it,
 * so `"foo\ "` vetoes while `"foo\"` continues. Even runs (`"foo\\"`)
 * are the literal-backslash escape hatch.
 */
export function isContinuationLine(line: string): boolean {
  if (line.length === 0 || /\s$/.test(line)) return false;
  return countTrailingBackslashes(line) % 2 === 1;
}

/**
 * Cursor-placed mid-draft fallback: when the snapshot/base draft has EXACTLY
 * ONE continuation line (per {@link isContinuationLine}), consume one
 * backslash at the end of THAT line and splice `"\n"` there, preserving
 * head + tail (`"a\nb\\\nc"` → `"a\nb\n\nc"`, the line split open exactly
 * as Enter at end-of-line would; a lone-`\` line `"a\n\\\nb"` →
 * `"a\n\n\nb"`). Returns undefined for zero or 2+ candidates — never
 * guess: multiline pastes like `C:\new\file` shapes must submit
 * literally. A sole last-line candidate behaves exactly like
 * {@link stripContinuation} plus a newline, so this also covers the
 * end-of-text case.
 *
 * Alongside the restored text, returns the cursor offset just after the
 * spliced `"\n"` (the splice index + 1) — where Enter-at-end-of-line would
 * leave the cursor (start of the opened line). Offsets are UTF-16 code
 * units into the returned text, matching the input convention of
 * {@link spliceContinuationAt} (whose post-splice cursor is likewise the
 * passed `offset`: remove-one/add-one before the cursor nets zero).
 */
export function spliceSoleLineContinuationWithCursor(text: string): { text: string; cursor: number } | undefined {
  const lines = text.split('\n');
  let candidate = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!isContinuationLine(lines[i])) continue;
    if (candidate !== -1) return undefined;
    candidate = i;
  }
  if (candidate === -1) return undefined;
  let offset = 0;
  for (let i = 0; i < candidate; i++) offset += lines[i].length + 1; // +1 for `"\n"`
  offset += lines[candidate].length - 1; // consume exactly one backslash
  return { text: `${text.slice(0, offset)}\n${text.slice(offset + 1)}`, cursor: offset + 1 };
}
/**
 * String-only convenience over {@link spliceSoleLineContinuationWithCursor}.
 * Same rule, no cursor: see above for the contract.
 */
export function spliceSoleLineContinuation(text: string): string | undefined {
  return spliceSoleLineContinuationWithCursor(text)?.text;
}
/**
 * Strip the single escaping backslash. Returns `text` unchanged when there
 * is no continuation. The caller appends the `"\n"`.
 */
export function stripContinuation(text: string): string {
  return hasContinuation(text) ? text.slice(0, -1) : text;
}
