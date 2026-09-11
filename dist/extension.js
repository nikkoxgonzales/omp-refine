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
import { spliceSoleLineContinuation, hasContinuation, spliceContinuationAt, stripContinuation } from './continuation.js';
import { createDoubleEscapeHandler } from './double-escape.js';
/**
 * Shared gate: the submitted text when this is a live interactive submit,
 * else undefined. Non-interactive sources, image attachments, and
 * non-string payloads always pass through untouched.
 */
function inputText(event) {
    if (typeof event !== 'object' || event === null)
        return undefined;
    const { source, text, images } = event;
    if (source !== 'interactive')
        return undefined;
    if (typeof text !== 'string' || text.length === 0)
        return undefined;
    if (Array.isArray(images) && images.length > 0)
        return undefined;
    return text;
}
/**
 * Pure decision: returns the editor text to restore (`text` minus the
 * escape, plus `"\n"`) when this submit is an end-of-text continuation,
 * else undefined. End-only by construction — the wired handler below
 * layers the raw-draft check and cursor splicing on top.
 */
export function shouldContinue(event) {
    const text = inputText(event);
    if (text === undefined || !hasContinuation(text))
        return undefined;
    return `${stripContinuation(text)}\n`;
}
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
export function resolveBaseText(eventText, raw) {
    if (typeof raw === 'string' && raw.length > 0 && raw !== eventText && eventText === raw.trim()) {
        return raw;
    }
    return eventText;
}
/**
 * Cursor offset carried by the input event, if any. Neither host reports
 * one today (`InputEvent` has no cursor field; verified pi 0.85.x / omp
 * 18.1.x), so this is forward-compat only: accept `cursorOffset`
 * (preferred), `cursor`, or `selectionStart` when strictly valid — an
 * integer insertion point inside the text — and ignore everything else.
 * Unknown shapes never steer a submit.
 */
export function readCursorOffset(event, length) {
    if (typeof event !== 'object' || event === null)
        return undefined;
    const record = event;
    for (const key of ['cursorOffset', 'cursor', 'selectionStart']) {
        const value = record[key];
        if (Number.isInteger(value) && value > 0 && value <= length) {
            return value;
        }
    }
    return undefined;
}
/**
 * Raw draft as of the last terminal-input chunk, for the trailing-space
 * veto. The tap below refreshes this on every chunk (one join per chunk —
 * the host already joins several times per keystroke), so when the submit
 * Enter arrives the snapshot is the verbatim pre-submit draft. Consumed
 * (cleared) by the next `input` event; a submit that arrives with no
 * terminal chunk in between (programmatic `submit()`) finds no snapshot
 * and falls back to the live editor / event text. Session-scoped: reset
 * on every arm/disarm below so a stale draft never leaks across sessions.
 */
let pendingRawDraft;
function takePendingRawDraft() {
    const snapshot = pendingRawDraft;
    pendingRawDraft = undefined;
    return snapshot;
}
/**
 * Terminal-input tap factory. Records the live draft verbatim and never
 * consumes or rewrites input (always returns undefined), so headless/RPC
 * contexts, image submits, and every other gesture pass through untouched.
 * Throw-safe: a dead editor keeps the previous snapshot and the `input`
 * handler fails open downstream.
 */
export function createSubmitSnapshotTap(deps) {
    return (_data) => {
        try {
            const draft = deps.getText();
            if (typeof draft === 'string')
                pendingRawDraft = draft;
        }
        catch {
            // Dead editor mid-chunk: keep the previous snapshot (if any); the
            // input handler's recognizability check fails open without one.
        }
        return undefined;
    };
}
let stopRefine;
/** True between `agent_start` and `agent_end`/`agent_settled`. */
let agentBusy = false;
function disarmRefine() {
    try {
        stopRefine?.();
    }
    catch {
        // A stale unsubscribe must never block re-arming or shutdown.
    }
    stopRefine = undefined;
    pendingRawDraft = undefined;
}
/**
 * (Re)subscribe the session's single raw-input listener for this session's
 * editor: it snapshots the draft for the continuation veto, then runs the
 * double-Escape gesture. Headless/RPC contexts expose no terminal input —
 * the capability checks skip them silently.
 */
function armRefine(ctx) {
    disarmRefine();
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
    // One listener, two jobs: the snapshot tap never consumes (always
    // undefined), so the combined contract is the gesture's. Snapshot first
    // so even a consumed Escape leaves a fresh draft behind.
    const snapshot = createSubmitSnapshotTap({ getText });
    const escape = createDoubleEscapeHandler({ getText, setText, isBusy: () => agentBusy });
    const combined = (data) => {
        snapshot(data);
        return escape(data);
    };
    try {
        stopRefine = subscribe(combined) ?? undefined;
    }
    catch {
        stopRefine = undefined;
    }
}
export default function refineExtension(pi) {
    pi.on('input', (event, ctx) => {
        const text = inputText(event);
        if (text === undefined)
            return undefined;
        // Fail OPEN: without a live editor (headless/RPC, or a host that does
        // not expose the editor surface) a swallowed submit would eat the
        // user's message — so submit literally instead. The reads below probe
        // liveness while the submit can still proceed, and supply the raw
        // draft for the trim check.
        //
        // ORDER OF EVIDENCE (freshest first): the pre-submit snapshot wins —
        // the live editor is already cleared by now (the host joins + trims
        // the draft, resets its buffer, and only then emits `input`), so a
        // live read is always `""` on both hosts and can never veto. The live
        // read stays as the middle fallback for hosts that don't clear; the
        // event text is the last resort. Each layer applies only when
        // recognizably the same submission (`candidate.trim() === text`).
        const ui = ctx?.ui;
        if (ui === undefined)
            return undefined;
        if (typeof ui.setEditorText !== 'function' || typeof ui.getEditorText !== 'function')
            return undefined;
        let live;
        try {
            live = ui.getEditorText();
        }
        catch {
            // Unreadable editor: trust nothing (not even the snapshot) — submit.
            return undefined;
        }
        const base = resolveBaseText(resolveBaseText(text, takePendingRawDraft()), live);
        // A reported cursor position governs: splice at the cursor, or submit
        // literally when Enter wasn't pressed after an unescaped backslash —
        // even if the draft happens to end in one. Without cursor info (both
        // hosts today) apply the exactly-one-candidate-line rule to the base
        // draft: one line ending in an odd backslash run (no trailing space)
        // splices a newline at the end of THAT line; zero or 2+ candidates
        // submit literally — never guess.
        const at = readCursorOffset(event, base.length);
        const continued = at !== undefined ? spliceContinuationAt(base, at) : spliceSoleLineContinuation(base);
        if (continued === undefined)
            return undefined;
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
        agentBusy = false;
        armRefine(ctx);
    });
    pi.on('session_switch', (_event, ctx) => {
        agentBusy = false;
        armRefine(ctx);
    });
    pi.on('session_shutdown', () => {
        agentBusy = false;
        disarmRefine();
    });
    // Busy gate for the interrupt guard: swallow lone-Escape-with-draft only
    // while a run is live. Each in its own try/catch — an older host that
    // rejects unknown events must not break the registrations above. If the
    // events never fire, the handler's omitted-probe default (assume busy)
    // keeps the guard fail-safe toward never interrupting on double-Escape.
    try {
        pi.on('agent_start', () => {
            agentBusy = true;
        });
    }
    catch {
        // Host without agent events: guard stays on its fail-safe default.
    }
    try {
        pi.on('agent_end', () => {
            agentBusy = false;
        });
    }
    catch {
        // Host without agent events: guard stays on its fail-safe default.
    }
    try {
        pi.on('agent_settled', () => {
            agentBusy = false;
        });
    }
    catch {
        // Host without agent events: guard stays on its fail-safe default.
    }
}
