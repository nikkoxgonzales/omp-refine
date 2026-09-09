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
export declare const DOUBLE_ESCAPE_MS = 500;
/** Lone Escape byte. Assembled sequences (`\x1b[A`, `\x1bb`, …) never equal this. */
export declare const ESCAPE_KEY = "\u001B";
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
export declare function createDoubleEscapeHandler(deps: DoubleEscapeDeps): (data: string) => {
    consume?: boolean;
} | undefined;
