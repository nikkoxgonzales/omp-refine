/**
 * Double-Escape draft clear: the pure gesture logic.
 *
 * The host deliberately makes Escape-while-typing a no-op ("Esc must not
 * destroy an in-progress draft") and reserves double-Escape on an EMPTY
 * editor for rewind/tree — so a fast Escape pair with a draft present has
 * no owner. This owns it: two lone Escapes within the window clear the
 * draft. Anything else — key sequences (arrows, alt-chords), empty drafts,
 * slow pairs, typing in between — passes through to the host untouched.
 */

/** Pairing window, mirroring the host's own double-escape window. */
export const DOUBLE_ESCAPE_MS = 500;

/** Lone Escape byte. Assembled sequences (`\x1b[A`, `\x1bb`, …) never equal this. */
export const ESCAPE_KEY = '\x1b';

export interface DoubleEscapeDeps {
  getText: () => string;
  setText: (text: string) => void;
  /** Clock, injectable for tests. Defaults to Date.now. */
  now?: () => number;
}

/**
 * Raw-input handler factory. Stateful (remembers the last Escape limb);
 * create one per terminal-input registration.
 */
export function createDoubleEscapeHandler(
  deps: DoubleEscapeDeps,
): (data: string) => { consume?: boolean } | undefined {
  let lastEscapeAt = Number.NEGATIVE_INFINITY;
  const now = deps.now ?? Date.now;
  const reset = (): undefined => {
    lastEscapeAt = Number.NEGATIVE_INFINITY;
    return undefined;
  };
  return (data: string) => {
    if (data !== ESCAPE_KEY) return reset();
    let text: string;
    try {
      text = deps.getText();
    } catch {
      return reset();
    }
    if (typeof text !== 'string' || text.length === 0) return reset();
    const at = now();
    if (at - lastEscapeAt <= DOUBLE_ESCAPE_MS) {
      reset();
      try {
        deps.setText('');
      } catch {
        // Draft survives; nothing else a hotkey can do.
      }
      return { consume: true };
    }
    lastEscapeAt = at;
    return undefined;
  };
}
