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
 * Pure decision: returns the editor text to restore (`text` minus the
 * escape, plus `"\n"`) when this submit is a continuation, else undefined.
 * Deliberately conservative — non-interactive sources, image attachments,
 * and non-string payloads always pass through untouched.
 */
export function shouldContinue(event: unknown): string | undefined {
  if (typeof event !== 'object' || event === null) return undefined;
  const { source, text, images } = event as {
    source?: unknown;
    text?: unknown;
    images?: unknown;
  };
  if (source !== 'interactive') return undefined;
  if (typeof text !== 'string' || text.length === 0) return undefined;
  if (Array.isArray(images) && images.length > 0) return undefined;
  if (!hasContinuation(text)) return undefined;
  return `${stripContinuation(text)}\n`;
}

let stopHotkeys: (() => void) | undefined;

/** True between `agent_start` and `agent_end`/`agent_settled`. */
let agentBusy = false;
function disarmHotkeys(): void {
  try {
    stopHotkeys?.();
  } catch {
    // A stale unsubscribe must never block re-arming or shutdown.
  }
  stopHotkeys = undefined;
}

/**
 * (Re)subscribe the double-Escape raw-input listener for this session's
 * editor. Headless/RPC contexts expose no terminal input — the capability
 * checks skip them silently.
 */
function armHotkeys(ctx: ContextLike): void {
  disarmHotkeys();
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
    stopHotkeys = subscribe(createDoubleEscapeHandler({ getText, setText, isBusy: () => agentBusy })) ?? undefined;
  } catch {
    stopHotkeys = undefined;
  }
}

export default function hotkeysExtension(pi: ExtensionHostLike): void {
  pi.on('input', (event, ctx) => {
    const continued = shouldContinue(event);
    if (continued === undefined) return undefined;
    // Fail OPEN: without a live editor (headless/RPC, or a host that does
    // not expose the editor surface) a swallowed submit would eat the
    // user's message — so submit literally instead. The read below probes
    // liveness while the submit can still proceed.
    const ui = ctx?.ui;
    if (ui === undefined) return undefined;
    if (typeof ui.setEditorText !== 'function' || typeof ui.getEditorText !== 'function') return undefined;
    try {
      ui.getEditorText();
    } catch {
      return undefined;
    }
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
    armHotkeys(ctx);
  });
  pi.on('session_switch', (_event, ctx) => {
    agentBusy = false;
    armHotkeys(ctx);
  });
  pi.on('session_shutdown', () => {
    agentBusy = false;
    disarmHotkeys();
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
