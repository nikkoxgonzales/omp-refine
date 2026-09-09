/**
 * Double-Escape draft clear + interrupt guard: the pure gesture logic.
 *
 * Host truth (pi 0.85.x): `onEscape` aborts the run while streaming or a
 * bash command is running — draft or not — while idle `Esc` with a draft
 * is a no-op and `Esc` with autocomplete open dismisses the menu. So the
 * guard swallows a lone Escape with a non-empty draft ONLY while busy:
 * the first limb arms the pair, the second inside the window clears, and
 * the host never sees either (no interrupt). While idle the first limb
 * passes through (menu dismiss / overlay cancel keep working; the draft
 * is safe because idle host `Esc` is a no-op) and a fast second limb
 * still clears. Anything else — key sequences (arrows, alt-chords),
 * blank drafts, typing in between — passes through untouched.
 *
 * Net effect while streaming: `Esc Esc` clears without interrupting;
 * `Esc Esc Esc` clears then interrupts (third lands on the now-empty box
 * and passes through). Emptiness is `trim()`-based, mirroring the host,
 * so a whitespace-only draft keeps the host's rewind gesture.
 */
/** Pairing window, mirroring the host's own double-escape window. */
export const DOUBLE_ESCAPE_MS = 500;
/** Lone Escape byte. Assembled sequences (`\x1b[A`, `\x1bb`, …) never equal this. */
export const ESCAPE_KEY = '\x1b';
/**
 * Raw-input handler factory. Stateful (remembers the last Escape limb);
 * create one per terminal-input registration.
 */
export function createDoubleEscapeHandler(deps) {
    let lastEscapeAt = Number.NEGATIVE_INFINITY;
    const now = deps.now ?? Date.now;
    const reset = () => {
        lastEscapeAt = Number.NEGATIVE_INFINITY;
        return undefined;
    };
    return (data) => {
        if (data !== ESCAPE_KEY)
            return reset();
        let text;
        try {
            text = deps.getText();
        }
        catch {
            return reset();
        }
        if (typeof text !== 'string' || text.trim().length === 0)
            return reset();
        const at = now();
        if (at - lastEscapeAt <= DOUBLE_ESCAPE_MS) {
            reset();
            try {
                deps.setText('');
            }
            catch {
                // Draft survives; nothing else a hotkey can do.
            }
            return { consume: true };
        }
        lastEscapeAt = at;
        // First limb: idle Esc with a draft is a host no-op, so let it through
        // (autocomplete/overlay dismiss keeps working) while still arming the
        // pair. Busy Esc would abort the run — swallow it. Either way a fast
        // second limb clears (above).
        let busy = true;
        try {
            busy = deps.isBusy?.() ?? true;
        }
        catch {
            busy = true;
        }
        return busy ? { consume: true } : undefined;
    };
}
