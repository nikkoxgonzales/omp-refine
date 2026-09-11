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
 * - MID-LINE: `\` + Enter must also work with the cursor mid-sentence
 *   (`"hello \<cursor>world"` → `"hello \nworld"`), not just at the end
 *   of the draft. Neither host exposes cursor info — `InputEvent` carries
 *   only `{ type, text, images, source }` (pi adds `streamingBehavior`;
 *   verified against pi 0.85.x and omp 18.1.x types) and the UI context
 *   offers only `get/setEditorText`, no selection API — so the handler
 *   honors a strictly validated cursor offset when the event carries one
 *   (`cursorOffset`, `cursor`, or `selectionStart`) and otherwise stays
 *   end-only. A cursor-less interior-backslash heuristic would swallow
 *   legitimate submits (`C:\new\file`, regex escapes), so end-only is
 *   the only safe fallback. (pi's own editor already handles `\` + Enter
 *   at the cursor natively; omp submits unconditionally, which is where
 *   this extension is the sole implementer.)
 *
 * - TRAILING SPACE: `\` + Space + Enter must submit literally. Both hosts
 *   `trim()` the draft in the editor's submit path before the `input`
 *   event fires, so `"foo\ "` arrives as `"foo\"` — indistinguishable
 *   from a genuine continuation by `event.text` alone. The handler
 *   therefore re-reads the raw draft via `getEditorText()` (still
 *   populated: the host clears the draft only after the input handlers
 *   resolve) and decides on the raw text whenever it is recognizably the
 *   same submission (`event.text === raw.trim()`); a lone fallback to
 *   `event.text` covers cleared/legacy editors. `"foo\\" ` never
 *   continues (even run = literal backslashes).
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

import { hasContinuation, spliceContinuationAt, stripContinuation } from './continuation.js';
import { createDoubleEscapeHandler } from './double-escape.js';

interface UiLike {
  setEditorText?: (text: string) => void;
  getEditorText?: () => string;
  onTerminalInput?: (
    handler: (data: string) => { consume?: boolean; data?: string } | undefined,
  ) => () => void;
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
 * Shared gate: the submitted text when this is a live interactive submit,
 * else undefined. Non-interactive sources, image attachments, and
 * non-string payloads always pass through untouched.
 */
function inputText(event: unknown): string | undefined {
  if (typeof event !== 'object' || event === null) return undefined;
  const { source, text, images } = event as {
    source?: unknown;
    text?: unknown;
    images?: unknown;
  };
  if (source !== 'interactive') return undefined;
  if (typeof text !== 'string' || text.length === 0) return undefined;
  if (Array.isArray(images) && images.length > 0) return undefined;
  return text;
}

/**
 * Pure decision: returns the editor text to restore (`text` minus the
 * escape, plus `"\n"`) when this submit is an end-of-text continuation,
 * else undefined. End-only by construction — the wired handler below
 * layers the raw-draft check and cursor splicing on top.
 */
export function shouldContinue(event: unknown): string | undefined {
  const text = inputText(event);
  if (text === undefined || !hasContinuation(text)) return undefined;
  return `${stripContinuation(text)}\n`;
}

/**
 * Pick the text the continuation decision runs on. Both hosts `trim()`
 * the draft before emitting `input`, which destroys the trailing-space
 * evidence (`"foo\ "` arrives as `"foo\"`). When the live editor still
 * holds the raw draft AND it is recognizably the same submission
 * (`eventText === raw.trim()`), decide on the raw text so whitespace
 * after the backslash vetoes the continuation. Otherwise (cleared
 * editor, legacy harness, or an unrelated rewrite by an earlier handler
 * in the chain) fall back to the event text — never invent whitespace.
 */
export function resolveBaseText(eventText: string, raw: unknown): string {
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
export function readCursorOffset(event: unknown, length: number): number | undefined {
  if (typeof event !== 'object' || event === null) return undefined;
  const record = event as Record<string, unknown>;
  for (const key of ['cursorOffset', 'cursor', 'selectionStart'] as const) {
    const value = record[key];
    if (Number.isInteger(value) && (value as number) > 0 && (value as number) <= length) {
      return value as number;
    }
  }
  return undefined;
}

let stopRefine: (() => void) | undefined;

/** True between `agent_start` and `agent_end`/`agent_settled`. */
let agentBusy = false;
function disarmRefine(): void {
  try {
    stopRefine?.();
  } catch {
    // A stale unsubscribe must never block re-arming or shutdown.
  }
  stopRefine = undefined;
}

/**
 * (Re)subscribe the double-Escape raw-input listener for this session's
 * editor. Headless/RPC contexts expose no terminal input — the capability
 * checks skip them silently.
 */
function armRefine(ctx: ContextLike): void {
  disarmRefine();
  const ui = ctx?.ui;
  if (ui === undefined) return;
  if (
    typeof ui.getEditorText !== 'function' ||
    typeof ui.setEditorText !== 'function' ||
    typeof ui.onTerminalInput !== 'function'
  ) {
    return;
  }
  // Bind now: these narrowed method types are consumed in direct flow, and
  // the bound closures keep the host receiver for later raw-input ticks.
  const getText = ui.getEditorText.bind(ui);
  const setText = ui.setEditorText.bind(ui);
  const subscribe = ui.onTerminalInput.bind(ui);
  try {
    stopRefine = subscribe(createDoubleEscapeHandler({ getText, setText, isBusy: () => agentBusy })) ?? undefined;
  } catch {
    stopRefine = undefined;
  }
}

export default function refineExtension(pi: ExtensionHostLike): void {
  pi.on('input', (event, ctx) => {
    const text = inputText(event);
    if (text === undefined) return undefined;
    // Fail OPEN: without a live editor (headless/RPC, or a host that does
    // not expose the editor surface) a swallowed submit would eat the
    // user's message — so submit literally instead. The read below probes
    // liveness while the submit can still proceed, and doubles as the raw
    // draft for the trim check (hosts trim before emitting `input`).
    const ui = ctx?.ui;
    if (ui === undefined) return undefined;
    if (typeof ui.setEditorText !== 'function' || typeof ui.getEditorText !== 'function') return undefined;
    let raw: unknown;
    try {
      raw = ui.getEditorText();
    } catch {
      return undefined;
    }
    const base = resolveBaseText(text, raw);
    // A reported cursor position governs: splice at the cursor, or submit
    // literally when Enter wasn't pressed after an unescaped backslash —
    // even if the draft happens to end in one. Without cursor info (both
    // hosts today) fall back to the end-of-text check.
    const at = readCursorOffset(event, base.length);
    const continued =
      at !== undefined
        ? spliceContinuationAt(base, at)
        : hasContinuation(base)
          ? `${stripContinuation(base)}\n`
          : undefined;
    if (continued === undefined) return undefined;
    // ORDERING: the host runs `editor.clearDraft()` synchronously after
    // `emitInput` resolves handled, so a synchronous restore is wiped —
    // the submit vanishes AND the draft is lost (the reported "clears the
    // text"). A macrotask always lands after that microtask continuation.
    setTimeout(() => {
      try {
        ui?.setEditorText?.(continued);
      } catch {
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
  } catch {
    // Host without agent events: guard stays on its fail-safe default.
  }
  try {
    pi.on('agent_end', () => {
      agentBusy = false;
    });
  } catch {
    // Host without agent events: guard stays on its fail-safe default.
  }
  try {
    pi.on('agent_settled', () => {
      agentBusy = false;
    });
  } catch {
    // Host without agent events: guard stays on its fail-safe default.
  }
}
