/**
 * Backslash-Enter continuation: the pure decision logic.
 *
 * Claude Code turns a trailing `\` + Enter into a newline instead of a
 * submit. This module answers the only question that matters — "does this
 * submitted text end in an UNESCAPED backslash?" — by counting trailing
 * backslashes: odd means the last one escapes the submit, even means the
 * backslashes escape each other and the submit stands.
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
 * Strip the single escaping backslash. Returns `text` unchanged when there
 * is no continuation. The caller appends the `"\n"`.
 */
export function stripContinuation(text) {
    return hasContinuation(text) ? text.slice(0, -1) : text;
}
