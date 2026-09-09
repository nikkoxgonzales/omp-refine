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

interface UiLike {
  setEditorText?: (text: string) => void;
  getEditorText?: () => string;
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
}
