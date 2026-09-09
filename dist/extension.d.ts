/**
 * omp-hotkeys OMP/pi extension entry.
 *
 * V1 does one thing: Claude-style `\` + Enter. When an interactive submit
 * ends in an unescaped backslash, the submit is swallowed and the text —
 * minus the escaping backslash, plus a newline — is put back into the
 * editor so the user keeps typing on the next line.
 *
 * Why an input handler and not a keybinding: `\` is an ordinary character
 * and Enter is plain Enter, so this works on every terminal (Windows
 * Terminal swallows most modified-Enter chords, which is the whole reason
 * Shift+Enter can't be trusted there). It composes with the built-in
 * `tui.input.newLine` (Shift+Enter / Ctrl+J), which never reaches submit.
 *
 * STRUCTURAL RULE: never import host singletons — the host is touched ONLY
 * through the `pi`/`ctx` surfaces below, so this loads cleanly on omp and
 * pi, TUI and headless.
 */
interface UiLike {
    setEditorText?: (text: string) => void;
    [key: string]: unknown;
}
interface ContextLike {
    ui?: UiLike | undefined;
    [key: string]: unknown;
}
interface ExtensionHostLike {
    on(event: string, handler: (event: unknown, ctx: ContextLike) => unknown): void;
}
/**
 * Pure decision: returns the editor text to restore (`text` minus the
 * escape, plus `"\n"`) when this submit is a continuation, else undefined.
 * Deliberately conservative — non-interactive sources, image attachments,
 * and non-string payloads always pass through untouched.
 */
export declare function shouldContinue(event: unknown): string | undefined;
export default function hotkeysExtension(pi: ExtensionHostLike): void;
export {};
