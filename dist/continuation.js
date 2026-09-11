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
export function countTrailingBackslashes(text) {
    let count = 0;
    for (let i = text.length - 1; i >= 0 && text[i] === '\\'; i--)
        count++;
    return count;
}
/**
 * True when Enter should become a newline: exactly when the text ends in
 * an odd number of backslashes (`foo\`, `foo\\\`). `foo\\` is false — the
 * escape hatch for a literal trailing backslash.
 */
export function hasContinuation(text) {
    return countTrailingBackslashes(text) % 2 === 1;
}
/**
 * Number of consecutive `\` characters immediately before `offset`
 * (an insertion point: 0 means "before the first char"). Out-of-range or
 * non-integer offsets carry no cursor meaning, so they count 0 (fail open).
 */
export function countBackslashesBefore(text, offset) {
    if (!Number.isInteger(offset) || offset < 0 || offset > text.length)
        return 0;
    let count = 0;
    for (let i = offset - 1; i >= 0 && text[i] === '\\'; i--)
        count++;
    return count;
}
/**
 * True when Enter at `offset` should become a newline: exactly when the
 * run immediately before the cursor is odd (`hello \<cursor>world`).
 * Offset 0 can never continue (no char before the cursor); invalid
 * offsets are false. Note `hasContinuation(text)` is this at
 * `offset === text.length`.
 */
export function hasContinuationAt(text, offset) {
    if (!Number.isInteger(offset) || offset <= 0 || offset > text.length)
        return false;
    return countBackslashesBefore(text, offset) % 2 === 1;
}
/**
 * Splice the continuation into `text` at `offset`: consume exactly one
 * `\` before the cursor and insert `"\n"` there, preserving head + tail
 * (`"hello \\ world"`, 7 → `"hello \n world"`). Returns undefined when
 * there is no continuation at the offset (even run, non-backslash before
 * the cursor, or an invalid offset) so the submit passes through.
 */
export function spliceContinuationAt(text, offset) {
    if (!hasContinuationAt(text, offset))
        return undefined;
    return `${text.slice(0, offset - 1)}\n${text.slice(offset)}`;
}
/**
 * Strip the single escaping backslash. Returns `text` unchanged when there
 * is no continuation. The caller appends the `"\n"`.
 */
export function stripContinuation(text) {
    return hasContinuation(text) ? text.slice(0, -1) : text;
}
