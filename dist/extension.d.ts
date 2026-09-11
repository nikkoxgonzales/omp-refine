/**
 * omp-refine OMP/pi extension entry.
 *
 * V1 does one thing: Claude-style `\` + Enter. When an interactive submit
 * carries an unescaped backslash, the submit is swallowed and the text —
 * minus the escaping backslash, plus a newline — is put back into the
 * editor so the user keeps typing.
 *
 * Two subtleties the naive end-of-text check gets wrong:
 *
 * - MID-LINE: `\` + Enter must also work with the cursor mid-draft
 *   (`"first \<cursor>last"` → `"first \nlast"`), not just at the end of
 *   the draft. Neither host exposes cursor info — `InputEvent` carries
 *   only `{ type, text, images, source }` (pi adds `streamingBehavior`;
 *   verified against pi 0.85.x and omp 18.1.x types) and the UI context
 *   offers only `get/setEditorText`, no selection API — so the handler
 *   honors a strictly validated cursor offset when the event carries one
 *   (`cursorOffset`, `cursor`, or `selectionStart`) and otherwise applies
 *   the exactly-one-candidate-line rule to the pre-submit snapshot: one
 *   line ending in an odd backslash run (trailing whitespace on the line
 *   disqualifies it) splices a newline at the end of THAT line, with head
 *   + tail preserved. Zero or 2+ such lines submit literally — a
 *   cursor-less interior-backslash guess would swallow legitimate submits
 *   (`C:\new\file` multiline pastes), so the rule never guesses. (pi's own
 *   editor already handles `\` + Enter at the cursor natively; omp submits
 *   unconditionally, which is where this extension is the sole implementer.)
 *
 * - TRAILING SPACE: `\` + Space + Enter must submit literally. Both hosts
 *   `trim()` the draft before the `input` event fires — and, fatally for
 *   any check inside the `input` handler, the editor buffer is ALREADY
 *   cleared by then (pi-tui `editor.ts` `#submitValue` joins + trims, resets
 *   its state, and only then calls `onSubmit`; omp's `input-controller`
 *   trims again before `emitInput`). So `"foo\ "` arrives as `"foo\"` with
 *   `getEditorText()` returning `""` — indistinguishable from a genuine
 *   continuation by anything the `input` handler can observe. The handler
 *   therefore decides on a pre-submit snapshot of the raw draft, captured
 *   by a terminal-input tap (listeners run before the focused editor, so
 *   the tap sees the draft verbatim, trailing spaces included) and
 *   consumed by the next `input` event. A snapshot is honored only when
 *   recognizably the same submission (`snapshot.trim() === event.text`);
 *   anything else falls back to the live editor, then the event text.
 *   `"foo\\" ` never continues (even run = literal backslashes).
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
    getEditorText?: () => string;
    onTerminalInput?: (handler: (data: string) => {
        consume?: boolean;
        data?: string;
    } | undefined) => () => void;
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
 * escape, plus `"\n"`) when this submit is an end-of-text continuation,
 * else undefined. End-only by construction — the wired handler below
 * layers the raw-draft check and cursor splicing on top.
 */
export declare function shouldContinue(event: unknown): string | undefined;
/**
 * Pick the text the continuation decision runs on. Both hosts `trim()`
 * the draft before emitting `input`, which destroys the trailing-space
 * evidence (`"foo\ "` arrives as `"foo\"`). When `raw` — the pre-submit
 * snapshot first, the live editor second — still holds the raw draft AND
 * it is recognizably the same submission (`eventText === raw.trim()`),
 * decide on the raw text so whitespace after the backslash vetoes the
 * continuation. Otherwise (consumed/cleared snapshot, cleared editor, or
 * an unrelated rewrite by an earlier handler in the chain) fall back to
 * the event text — never invent whitespace.
 */
export declare function resolveBaseText(eventText: string, raw: unknown): string;
/**
 * Cursor offset carried by the input event, if any. Neither host reports
 * one today (`InputEvent` has no cursor field; verified pi 0.85.x / omp
 * 18.1.x), so this is forward-compat only: accept `cursorOffset`
 * (preferred), `cursor`, or `selectionStart` when strictly valid — an
 * integer insertion point inside the text — and ignore everything else.
 * Unknown shapes never steer a submit.
 */
export declare function readCursorOffset(event: unknown, length: number): number | undefined;
export interface SubmitSnapshotDeps {
    getText: () => string;
}
/**
 * Terminal-input tap factory. Records the live draft verbatim and never
 * consumes or rewrites input (always returns undefined), so headless/RPC
 * contexts, image submits, and every other gesture pass through untouched.
 * Throw-safe: a dead editor keeps the previous snapshot and the `input`
 * handler fails open downstream.
 */
export declare function createSubmitSnapshotTap(deps: SubmitSnapshotDeps): (data: string) => undefined;
export default function refineExtension(pi: ExtensionHostLike): void;
export {};
