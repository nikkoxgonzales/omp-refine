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
import { hasContinuation, stripContinuation } from './continuation.js';
import { createDoubleEscapeHandler } from './double-escape.js';
/**
 * Pure decision: returns the editor text to restore (`text` minus the
 * escape, plus `"\n"`) when this submit is a continuation, else undefined.
 * Deliberately conservative — non-interactive sources, image attachments,
 * and non-string payloads always pass through untouched.
 */
export function shouldContinue(event) {
    if (typeof event !== 'object' || event === null)
        return undefined;
    const { source, text, images } = event;
    if (source !== 'interactive')
        return undefined;
    if (typeof text !== 'string' || text.length === 0)
        return undefined;
    if (Array.isArray(images) && images.length > 0)
        return undefined;
    if (!hasContinuation(text))
        return undefined;
    return `${stripContinuation(text)}\n`;
}
let stopHotkeys;
function disarmHotkeys() {
    try {
        stopHotkeys?.();
    }
    catch {
        // A stale unsubscribe must never block re-arming or shutdown.
    }
    stopHotkeys = undefined;
}
/**
 * (Re)subscribe the double-Escape raw-input listener for this session's
 * editor. Headless/RPC contexts expose no terminal input — the capability
 * checks skip them silently.
 */
function armHotkeys(ctx) {
    disarmHotkeys();
    const ui = ctx?.ui;
    if (ui === undefined)
        return;
    if (typeof ui.getEditorText !== 'function' ||
        typeof ui.setEditorText !== 'function' ||
        typeof ui.onTerminalInput !== 'function') {
        return;
    }
    // Bind now: these narrowed method types are consumed in direct flow, and
    // the bound closures keep the host receiver for later raw-input ticks.
    const getText = ui.getEditorText.bind(ui);
    const setText = ui.setEditorText.bind(ui);
    const subscribe = ui.onTerminalInput.bind(ui);
    try {
        stopHotkeys = subscribe(createDoubleEscapeHandler({ getText, setText })) ?? undefined;
    }
    catch {
        stopHotkeys = undefined;
    }
}
export default function hotkeysExtension(pi) {
    pi.on('input', (event, ctx) => {
        const continued = shouldContinue(event);
        if (continued === undefined)
            return undefined;
        // Fail OPEN: without a live editor (headless/RPC, or a host that does
        // not expose the editor surface) a swallowed submit would eat the
        // user's message — so submit literally instead. The read below probes
        // liveness while the submit can still proceed.
        const ui = ctx?.ui;
        if (ui === undefined)
            return undefined;
        if (typeof ui.setEditorText !== 'function' || typeof ui.getEditorText !== 'function')
            return undefined;
        try {
            ui.getEditorText();
        }
        catch {
            return undefined;
        }
        // ORDERING: the host runs `editor.clearDraft()` synchronously after
        // `emitInput` resolves handled, so a synchronous restore is wiped —
        // the submit vanishes AND the draft is lost (the reported "clears the
        // text"). A macrotask always lands after that microtask continuation.
        setTimeout(() => {
            try {
                ui?.setEditorText?.(continued);
            }
            catch {
                // Session died mid-tick: nothing left to restore into.
            }
        }, 0);
        return { handled: true };
    });
    pi.on('session_start', (_event, ctx) => {
        armHotkeys(ctx);
    });
    pi.on('session_switch', (_event, ctx) => {
        armHotkeys(ctx);
    });
    pi.on('session_shutdown', () => {
        disarmHotkeys();
    });
}
