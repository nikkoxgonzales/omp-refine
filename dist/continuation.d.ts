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
export declare function countTrailingBackslashes(text: string): number;
/**
 * True when Enter should become a newline: exactly when the text ends in
 * an odd number of backslashes (`foo\`, `foo\\\`). `foo\\` is false — the
 * escape hatch for a literal trailing backslash.
 */
export declare function hasContinuation(text: string): boolean;
/**
 * Strip the single escaping backslash. Returns `text` unchanged when there
 * is no continuation. The caller appends the `"\n"`.
 */
export declare function stripContinuation(text: string): string;
