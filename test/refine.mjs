/**
 * Hotkeys acceptance test — runs against the COMPILED package (dist).
 *
 * Covers: trailing-backslash counting (odd/even/lone/multiline); the pure
 * shouldContinue gate (interactive-only, no images, string text); the
 * cursor-aware splice helpers; the raw-draft resolver; the cursor-offset
 * reader; the pre-submit snapshot tap; and the wired input handler with a
 * FAKE pi/ctx — continuation swallows the submit and restores editor text,
 * everything else passes through, and a missing or throwing editor fails
 * OPEN (submits literally, never eats input).
 *
 * The fake host mirrors the PROVEN live submit path (omp 18.1.x pi-tui
 * `editor.ts` `#submitValue`: buffer joined + trimmed, buffer reset, and
 * only then `onSubmit`; `input-controller.ts` trims again before
 * `emitInput`): terminal-input taps run BEFORE the editor processes Enter
 * (`tui.ts` listeners precede the focused component), so the tap snapshots
 * the verbatim raw draft, and by `input`-handler time the editor is
 * already cleared with `event.text` trimmed. Tests that need the old
 * unvalidated shape say so explicitly (legacy fallback paths).
 *
 * Plain Node ESM — no test-runner dependency (also runs under `node --test`).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
  countTrailingBackslashes,
  countBackslashesBefore,
  hasContinuation,
  hasContinuationAt,
  stripContinuation,
  spliceContinuationAt,
  isContinuationLine,
  spliceSoleLineContinuation,
  shouldContinue,
  resolveBaseText,
  readCursorOffset,
  createSubmitSnapshotTap,
} = await import('../dist/index.js');
const { default: refineExtension } = await import('../dist/extension.js');

/** Install the extension on a fake pi, return the captured input handler. */
function install(ctx) {
  const handlers = {};
  const pi = { on: (event, handler) => { handlers[event] = handler; } };
  refineExtension(pi);
  assert.equal(typeof handlers.input, 'function', 'registers an input handler');
  // Run the real lifecycle with no editor: clears any snapshot a previous
  // test's taps left behind, without subscribing anything.
  handlers.session_start({}, {});
  return (event) => handlers.input(event, ctx);
}

/**
 * Install on a fake pi WITH a terminal-input layer. Returns the wired
 * `input` handler, the captured terminal taps, the session lifecycle
 * handlers, and a live `ctx` whose `draft` is the editor buffer.
 */
function installLive() {
  const handlers = {};
  const taps = [];
  const pi = { on: (event, handler) => { handlers[event] = handler; } };
  refineExtension(pi);
  assert.equal(typeof handlers.input, 'function', 'registers an input handler');
  const ctx = {
    draft: '',
    sets: [],
    ui: null,
  };
  ctx.ui = {
    getEditorText() {
      if (ctx.throwOnGet) throw new Error('gone');
      if (ctx.nonStringGet) return 42;
      return ctx.draft;
    },
    setEditorText(text) {
      if (ctx.throwOnSet) throw new Error('gone');
      ctx.sets.push(text);
      ctx.draft = text;
    },
    onTerminalInput(handler) {
      taps.push(handler);
      return () => {
        const at = taps.indexOf(handler);
        if (at !== -1) taps.splice(at, 1);
      };
    },
  };
  // Arm the session tap the way the host does (registers the listener).
  handlers.session_start({}, ctx);
  assert.equal(taps.length, 1, 'arms one combined terminal-input tap on session_start');
  // The session tap snapshots the draft, then runs the double-Escape gesture.
  const snapshotTap = taps[0];
  return {
    ctx,
    taps,
    snapshotTap,
    handlers,
    onInput: (event) => handlers.input(event, ctx),
    terminal: (data) => {
      for (const tap of [...taps]) tap(data);
    },
  };
}

/**
 * Submit `raw` the way the PROVEN live host delivers it:
 *  1. terminal chunk arrives — taps observe the verbatim raw draft;
 *  2. the host trims + clears the buffer, then emits the trimmed text.
 * Returns the handler result; the caller ticks before asserting `draft`.
 */
function liveSubmit(live, raw, extra = {}) {
  live.ctx.draft = raw;
  live.terminal('\r');
  live.ctx.draft = ''; // host cleared the buffer before emitting `input`
  const event = { source: 'interactive', text: raw.trim(), ...extra };
  return live.onInput(event);
}

/** Fake ctx whose editor holds the RAW draft (legacy/non-clearing hosts). */
function ctxWithEditor(raw = '') {
  const ctx = { editorText: raw, ui: null };
  ctx.ui = {
    getEditorText() { return ctx.editorText; },
    setEditorText(text) { ctx.editorText = text; },
  };
  return ctx;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('trailing-backslash counting', () => {
  it('counts zero/one/two/three', () => {
    assert.equal(countTrailingBackslashes('foo'), 0);
    assert.equal(countTrailingBackslashes('foo\\'), 1);
    assert.equal(countTrailingBackslashes('foo\\\\'), 2);
    assert.equal(countTrailingBackslashes('foo\\\\\\'), 3);
  });
  it('empty and lone backslash', () => {
    assert.equal(countTrailingBackslashes(''), 0);
    assert.equal(countTrailingBackslashes('\\'), 1);
  });
  it('interior backslashes do not count', () => {
    assert.equal(countTrailingBackslashes('a\\b'), 0);
    assert.equal(countTrailingBackslashes('a\\b\\'), 1);
  });
});

describe('hasContinuation / stripContinuation', () => {
  it('odd trailing backslash continues, even does not', () => {
    assert.equal(hasContinuation('foo\\'), true);
    assert.equal(hasContinuation('foo\\\\'), false);
    assert.equal(hasContinuation('foo\\\\\\'), true);
    assert.equal(hasContinuation('foo'), false);
    assert.equal(hasContinuation(''), false);
  });
  it('multiline text checks the very end', () => {
    assert.equal(hasContinuation('line one\nline two\\'), true);
    assert.equal(hasContinuation('line one\\\nline two'), false);
  });
  it('strip removes exactly one backslash, or nothing', () => {
    assert.equal(stripContinuation('foo\\'), 'foo');
    assert.equal(stripContinuation('foo\\\\\\'), 'foo\\\\');
    assert.equal(stripContinuation('foo\\\\'), 'foo\\\\');
    assert.equal(stripContinuation('foo'), 'foo');
  });
});

describe('cursor-aware continuation', () => {
  it('counts the run immediately before the offset', () => {
    assert.equal(countBackslashesBefore('hello \\ world', 7), 1);
    assert.equal(countBackslashesBefore('a\\\\b', 3), 2);
    assert.equal(countBackslashesBefore('a\\\\b', 2), 1);
    assert.equal(countBackslashesBefore('foobar', 3), 0);
    assert.equal(countBackslashesBefore('foo\\', 4), 1);
  });
  it('invalid offsets count 0 (fail open)', () => {
    assert.equal(countBackslashesBefore('foo\\', 0), 0);
    assert.equal(countBackslashesBefore('foo\\', -1), 0);
    assert.equal(countBackslashesBefore('foo\\', 5), 0);
    assert.equal(countBackslashesBefore('foo\\', 2.5), 0);
    assert.equal(countBackslashesBefore('foo\\', Number.NaN), 0);
  });
  it('hasContinuationAt checks the run before the cursor', () => {
    assert.equal(hasContinuationAt('hello \\ world', 7), true);
    assert.equal(hasContinuationAt('hello \\world', 7), true);
    assert.equal(hasContinuationAt('a\\\\b', 3), false); // even run: literal
    assert.equal(hasContinuationAt('hello', 2), false);
    assert.equal(hasContinuationAt('foo\\', 4), true); // cursor at end == end check
    assert.equal(hasContinuationAt('foo\\', 0), false);
    assert.equal(hasContinuationAt('foo\\', 9), false);
  });
  it('spliceContinuationAt consumes one backslash and inserts newline at cursor', () => {
    assert.equal(spliceContinuationAt('hello \\ world', 7), 'hello \n world');
    assert.equal(spliceContinuationAt('hello \\world', 7), 'hello \nworld');
    assert.equal(spliceContinuationAt('foo\\', 4), 'foo\n');
    assert.equal(spliceContinuationAt('a\\\\b', 3), undefined); // even run passes through
    assert.equal(spliceContinuationAt('hello', 2), undefined);
    assert.equal(spliceContinuationAt('foo\\', 0), undefined);
  });
});

describe('sole-continuation-line rule (cursor-less mid-draft fallback)', () => {
  it('isContinuationLine: odd run continues, whitespace/even/empty veto', () => {
    assert.equal(isContinuationLine('middle line\\'), true);
    assert.equal(isContinuationLine('\\'), true);
    assert.equal(isContinuationLine('foo\\\\\\'), true);
    assert.equal(isContinuationLine('middle line\\ '), false); // trailing space vetoes
    assert.equal(isContinuationLine('middle line\\\t'), false); // trailing tab vetoes
    assert.equal(isContinuationLine('foo\\\\'), false); // even run: literal
    assert.equal(isContinuationLine('plain line'), false);
    assert.equal(isContinuationLine(''), false);
  });
  it('spliceSoleLineContinuation splices at the sole candidate, head + tail preserved', () => {
    assert.equal(spliceSoleLineContinuation('first line\nmiddle line\\\nlast line'), 'first line\nmiddle line\n\nlast line');
    assert.equal(spliceSoleLineContinuation('first line\n\\\nlast line'), 'first line\n\n\nlast line');
    assert.equal(spliceSoleLineContinuation('foo\\'), 'foo\n'); // sole last line == end check
    assert.equal(spliceSoleLineContinuation('a\nb\\'), 'a\nb\n');
    assert.equal(spliceSoleLineContinuation('first line\n\nmiddle line\\\n\nlast line'), 'first line\n\nmiddle line\n\n\nlast line');
  });
  it('spliceSoleLineContinuation never guesses: zero or 2+ candidates submit', () => {
    assert.equal(spliceSoleLineContinuation('plain\ntext'), undefined);
    assert.equal(spliceSoleLineContinuation(''), undefined);
    assert.equal(spliceSoleLineContinuation('foo\\ '), undefined); // trailing-space veto
    assert.equal(spliceSoleLineContinuation('foo\\\\'), undefined); // even run
    assert.equal(spliceSoleLineContinuation('a\\\nb\\\nc'), undefined); // two candidates
    assert.equal(spliceSoleLineContinuation('C:\\new\\file\nsecond'), undefined); // no line ends in `\`
  });
});

describe('resolveBaseText', () => {
  it('prefers the raw draft when the event is its trim (trailing-space veto)', () => {
    assert.equal(resolveBaseText('foo\\', 'foo\\ '), 'foo\\ ');
    assert.equal(resolveBaseText('foo\\', 'foo\\  '), 'foo\\  ');
    assert.equal(resolveBaseText('foo\\', 'foo\\ \t'), 'foo\\ \t');
    assert.equal(resolveBaseText('foo\\', '  foo\\'), '  foo\\');
  });
  it('falls back to the event text otherwise', () => {
    assert.equal(resolveBaseText('foo\\', 'foo\\'), 'foo\\'); // identical
    assert.equal(resolveBaseText('foo\\', ''), 'foo\\'); // cleared editor
    assert.equal(resolveBaseText('foo\\', undefined), 'foo\\');
    assert.equal(resolveBaseText('foo\\', 42), 'foo\\');
    assert.equal(resolveBaseText('bar', 'foo\\'), 'bar'); // unrelated rewrite: trust the chain
  });
});

describe('readCursorOffset', () => {
  it('accepts cursorOffset/cursor/selectionStart when strictly valid', () => {
    assert.equal(readCursorOffset({ cursorOffset: 7 }, 12), 7);
    assert.equal(readCursorOffset({ cursor: 3 }, 5), 3);
    assert.equal(readCursorOffset({ selectionStart: 5 }, 5), 5);
    assert.equal(readCursorOffset({ cursorOffset: 7, cursor: 3 }, 12), 7); // first alias wins
  });
  it('ignores missing/invalid shapes (never steers a submit)', () => {
    assert.equal(readCursorOffset({}, 12), undefined);
    assert.equal(readCursorOffset({ cursorOffset: 0 }, 12), undefined);
    assert.equal(readCursorOffset({ cursorOffset: -1 }, 12), undefined);
    assert.equal(readCursorOffset({ cursorOffset: 13 }, 12), undefined);
    assert.equal(readCursorOffset({ cursorOffset: 2.5 }, 12), undefined);
    assert.equal(readCursorOffset({ cursorOffset: '7' }, 12), undefined);
    assert.equal(readCursorOffset({ cursorOffset: Number.NaN }, 12), undefined);
    assert.equal(readCursorOffset(null, 12), undefined);
    assert.equal(readCursorOffset({ cursorOffset: 1 }, 0), undefined);
  });
});

describe('shouldContinue gate', () => {
  it('interactive + trailing backslash → editor text with newline', () => {
    assert.equal(shouldContinue({ source: 'interactive', text: 'foo\\' }), 'foo\n');
    assert.equal(shouldContinue({ source: 'interactive', text: 'a\nb\\' }), 'a\nb\n');
  });
  it('passes through: even backslashes, plain text, empty', () => {
    assert.equal(shouldContinue({ source: 'interactive', text: 'foo\\\\' }), undefined);
    assert.equal(shouldContinue({ source: 'interactive', text: 'foo' }), undefined);
    assert.equal(shouldContinue({ source: 'interactive', text: '' }), undefined);
  });
  it('passes through: whitespace after the backslash (no continuation)', () => {
    assert.equal(shouldContinue({ source: 'interactive', text: 'foo\\ ' }), undefined);
    assert.equal(shouldContinue({ source: 'interactive', text: 'foo\\  ' }), undefined);
    assert.equal(shouldContinue({ source: 'interactive', text: 'foo\\ \t' }), undefined);
    assert.equal(shouldContinue({ source: 'interactive', text: 'foo\\\n' }), undefined);
  });
  it('passes through: non-interactive sources, images, bad shapes', () => {
    assert.equal(shouldContinue({ source: 'rpc', text: 'foo\\' }), undefined);
    assert.equal(shouldContinue({ source: 'extension', text: 'foo\\' }), undefined);
    assert.equal(shouldContinue({ source: 'interactive', text: 'foo\\', images: [{ x: 1 }] }), undefined);
    assert.equal(shouldContinue({ source: 'interactive', text: 42 }), undefined);
    assert.equal(shouldContinue(null), undefined);
    assert.equal(shouldContinue(undefined), undefined);
  });
});

describe('wired input handler (legacy paths: no terminal tap)', () => {
  it('continuation swallows submit, restores editor text on next tick (past host clearDraft)', async () => {
    const ctx = ctxWithEditor();
    const onInput = install(ctx);
    const result = onInput({ source: 'interactive', text: 'hello\\' });
    assert.deepEqual(result, { handled: true });
    assert.equal(ctx.editorText, ''); // restore is deferred: host clears first, we land after
    await tick();
    assert.equal(ctx.editorText, 'hello\n');
  });
  it('normal submit passes through, editor untouched', async () => {
    const ctx = ctxWithEditor();
    const onInput = install(ctx);
    assert.equal(onInput({ source: 'interactive', text: 'hello' }), undefined);
    assert.equal(onInput({ source: 'interactive', text: 'trailing\\\\' }), undefined);
    await tick();
    assert.equal(ctx.editorText, '');
  });
  it('non-interactive and image submits pass through', async () => {
    const ctx = ctxWithEditor();
    const onInput = install(ctx);
    assert.equal(onInput({ source: 'rpc', text: 'x\\' }), undefined);
    assert.equal(onInput({ source: 'interactive', text: 'x\\', images: [{}] }), undefined);
    await tick();
    assert.equal(ctx.editorText, '');
  });
  it('fails OPEN without a live editor: submits literally', async () => {
    const headless = install({});
    assert.equal(headless({ source: 'interactive', text: 'x\\' }), undefined);
    const noGet = install({ ui: { setEditorText() {} } });
    assert.equal(noGet({ source: 'interactive', text: 'x\\' }), undefined);
    const throwingGet = install({ ui: { getEditorText() { throw new Error('nope'); }, setEditorText() {} } });
    assert.equal(throwingGet({ source: 'interactive', text: 'x\\' }), undefined);
    await tick();
  });
  it('dead editor mid-tick swallows silently (host setEditorText never throws live)', async () => {
    const throwingSet = install({ ui: { getEditorText() { return ''; }, setEditorText() { throw new Error('gone'); } } });
    assert.deepEqual(throwingSet({ source: 'interactive', text: 'x\\' }), { handled: true });
    await tick(); // deferred throw is caught: must not reject
  });
  it('cleared editor falls back to the event text (programmatic submit, no tap)', async () => {
    const ctx = ctxWithEditor(); // editor already cleared: raw is ''
    const onInput = install(ctx);
    assert.deepEqual(onInput({ source: 'interactive', text: 'hello\\' }), { handled: true });
    await tick();
    assert.equal(ctx.editorText, 'hello\n');
  });
  it('live editor wins on non-clearing hosts (legacy unvalidated shape)', async () => {
    const ctx = ctxWithEditor('foo\\ '); // old assumption: raw draft still present
    const onInput = install(ctx);
    assert.equal(onInput({ source: 'interactive', text: 'foo\\' }), undefined);
    await tick();
    assert.equal(ctx.editorText, 'foo\\ '); // draft preserved verbatim
  });
  it('unrelated editor rewrite passes through (respects the handler chain)', async () => {
    const ctx = ctxWithEditor('foo\\');
    const onInput = install(ctx);
    assert.equal(onInput({ source: 'interactive', text: 'bar' }), undefined);
    await tick();
    assert.equal(ctx.editorText, 'foo\\');
  });
});

describe('wired input handler (live host model: tap + cleared buffer + trimmed text)', () => {
  it('S1: trailing space vetoes — host-trimmed "foo\\ " submits literally', async () => {
    for (const raw of ['foo\\ ', 'foo\\  ', 'foo\\ \t']) {
      const live = installLive();
      assert.equal(liveSubmit(live, raw), undefined);
      await tick();
      assert.equal(live.ctx.draft, ''); // host cleared; veto restores nothing
      assert.deepEqual(live.ctx.sets, []); // setEditorText never called
    }
  });
  it('S2: lone backslash continues — restores the newline on next tick', async () => {
    for (const [raw, expected] of [['\\', '\n'], ['hello\\', 'hello\n'], ['a\nb\\', 'a\nb\n']]) {
      const live = installLive();
      assert.deepEqual(liveSubmit(live, raw), { handled: true });
      assert.equal(live.ctx.draft, ''); // restore is deferred past host clearDraft
      await tick();
      assert.equal(live.ctx.draft, expected);
    }
  });
  it('S2: double backslash stays a literal submit (documented escape hatch)', async () => {
    const live = installLive();
    assert.equal(liveSubmit(live, 'foo\\\\'), undefined);
    await tick();
    assert.equal(live.ctx.draft, '');
    assert.deepEqual(live.ctx.sets, []);
  });
  it('leading-space trim restores the snapshot draft faithfully', async () => {
    const live = installLive();
    assert.deepEqual(liveSubmit(live, '  foo\\'), { handled: true });
    await tick();
    assert.equal(live.ctx.draft, '  foo\n');
  });
  it('image and non-interactive submits pass through even with a snapshot', async () => {
    const live = installLive();
    live.ctx.draft = 'x\\';
    live.terminal('\r');
    live.ctx.draft = '';
    assert.equal(live.onInput({ source: 'rpc', text: 'x\\' }), undefined);
    assert.equal(live.onInput({ source: 'interactive', text: 'x\\', images: [{}] }), undefined);
    await tick();
    assert.equal(live.ctx.draft, '');
    assert.deepEqual(live.ctx.sets, []);
  });
  it('stale snapshot mismatch falls back to the event text', async () => {
    const live = installLive();
    live.ctx.draft = 'foo\\ '; // tap sees a veto draft…
    live.terminal('\r');
    live.ctx.draft = '';
    // …but a different submission arrives (earlier handler rewrote it).
    assert.deepEqual(live.onInput({ source: 'interactive', text: 'bar\\' }), { handled: true });
    await tick();
    assert.equal(live.ctx.draft, 'bar\n');
  });
  it('snapshot is consumed once: a tap-less resubmit falls back', async () => {
    const live = installLive();
    assert.equal(liveSubmit(live, 'foo\\ '), undefined); // veto consumes the snapshot
    await tick();
    live.ctx.draft = ''; // programmatic resubmit with no terminal chunk
    assert.deepEqual(live.onInput({ source: 'interactive', text: 'foo\\' }), { handled: true });
    await tick();
    assert.equal(live.ctx.draft, 'foo\n');
  });
  it('session switch clears the snapshot (no cross-session leak)', async () => {
    const live = installLive();
    live.ctx.draft = 'foo\\ ';
    live.terminal('\r'); // veto snapshot captured…
    live.handlers.session_switch({}, {
      ui: { getEditorText: () => '', setEditorText() {}, onTerminalInput: () => () => {} },
    });
    live.ctx.draft = ''; // …but the session moved on: fallback decides
    assert.deepEqual(live.onInput({ source: 'interactive', text: 'foo\\' }), { handled: true });
    await tick();
    assert.equal(live.ctx.draft, 'foo\n');
  });
  it('throwing tap editor fails OPEN at submit time (unreadable editor)', async () => {
    const live = installLive();
    live.ctx.throwOnGet = true;
    live.terminal('\r'); // tap throw is swallowed; no snapshot
    live.ctx.draft = '';
    assert.equal(live.onInput({ source: 'interactive', text: 'foo\\' }), undefined);
    await tick();
  });
  it('non-string tap draft is ignored (garbage-safe snapshot)', async () => {
    const live = installLive();
    live.ctx.nonStringGet = true;
    live.terminal('\r'); // getText() returns 42: snapshot untouched
    live.ctx.nonStringGet = false;
    live.ctx.draft = '';
    assert.deepEqual(live.onInput({ source: 'interactive', text: 'foo\\' }), { handled: true });
    await tick();
    assert.equal(live.ctx.draft, 'foo\n');
  });
  it('snapshot tap never consumes or rewrites terminal input', () => {
    const live = installLive();
    for (const data of ['\r', '\n', '\x1b', '\x1b[A', 'a', '\x1b[13;2u']) {
      assert.equal(live.snapshotTap(data), undefined);
    }
  });
  it('mid-line cursor splices the newline at the cursor', async () => {
    const live = installLive();
    assert.deepEqual(liveSubmit(live, 'hello \\ world', { cursorOffset: 7 }), { handled: true });
    await tick();
    assert.equal(live.ctx.draft, 'hello \n world');
  });
  it('mid-line cursor without a gap splices directly', async () => {
    const live = installLive();
    assert.deepEqual(liveSubmit(live, 'hello \\world', { cursorOffset: 7 }), { handled: true });
    await tick();
    assert.equal(live.ctx.draft, 'hello \nworld');
  });
  it('reported cursor governs: Enter elsewhere submits literally', async () => {
    const live = installLive();
    assert.equal(liveSubmit(live, 'ab\\', { cursorOffset: 1 }), undefined); // cursor after 'a', not after '\'
    await tick();
    assert.equal(live.ctx.draft, '');
  });
  it('even run before the cursor passes through (mid-line escape hatch)', async () => {
    const live = installLive();
    assert.equal(liveSubmit(live, 'a\\\\b', { cursorOffset: 3 }), undefined);
    await tick();
    assert.equal(live.ctx.draft, '');
  });
  it('cursor at the end behaves like the end-of-text check', async () => {
    const live = installLive();
    assert.deepEqual(liveSubmit(live, 'foo\\', { cursorOffset: 4 }), { handled: true });
    await tick();
    assert.equal(live.ctx.draft, 'foo\n');
  });
  it('invalid cursor offset falls back to the sole-line rule (covers end-of-text)', async () => {
    const live = installLive();
    assert.deepEqual(liveSubmit(live, 'foo\\', { cursorOffset: 99 }), { handled: true });
    await tick();
    assert.equal(live.ctx.draft, 'foo\n');
  });
  it('tap factory feeds the same snapshot seam the handler consumes', async () => {
    const seen = [];
    const ctx = { ui: { getEditorText: () => '', setEditorText: (t) => seen.push(t) } };
    const onInput = install(ctx);
    assert.equal(createSubmitSnapshotTap({ getText: () => 'direct\\ ' })('x'), undefined);
    assert.equal(onInput({ source: 'interactive', text: 'direct\\' }), undefined); // veto via factory snapshot
    await tick();
    assert.deepEqual(seen, []);
  });
  it('mid-draft trailing backslash splices a newline at that line, keeps editing', async () => {
    const live = installLive();
    const raw = 'first line\n\nmiddle line\\\n\nlast line';
    assert.deepEqual(liveSubmit(live, raw), { handled: true });
    assert.equal(live.ctx.draft, ''); // restore is deferred past host clearDraft
    await tick();
    assert.equal(live.ctx.draft, 'first line\n\nmiddle line\n\n\nlast line');
  });
  it('mid-draft lone-backslash line splices a newline, keeps editing', async () => {
    const live = installLive();
    const raw = 'first line\n\n\\\n\nlast line';
    assert.deepEqual(liveSubmit(live, raw), { handled: true });
    await tick();
    assert.equal(live.ctx.draft, 'first line\n\n\n\n\nlast line');
  });
  it('mid-draft trailing-space candidate submits literally', async () => {
    const live = installLive();
    assert.equal(liveSubmit(live, 'first line\nmiddle line\\ \nlast line'), undefined);
    await tick();
    assert.equal(live.ctx.draft, '');
    assert.deepEqual(live.ctx.sets, []);
  });
  it('mid-draft even-run candidate submits literally', async () => {
    const live = installLive();
    assert.equal(liveSubmit(live, 'first line\nmiddle line\\\\\nlast line'), undefined);
    await tick();
    assert.equal(live.ctx.draft, '');
    assert.deepEqual(live.ctx.sets, []);
  });
  it('mid-draft two candidates submit literally (never guess)', async () => {
    const live = installLive();
    assert.equal(liveSubmit(live, 'first\\\nsecond\\\nthird'), undefined);
    await tick();
    assert.equal(live.ctx.draft, '');
    assert.deepEqual(live.ctx.sets, []);
  });
  it('reported cursor at end governs: mid-draft candidate submits literally', async () => {
    const live = installLive();
    const raw = 'first line\\\nlast line';
    live.ctx.draft = raw;
    live.terminal('\r');
    live.ctx.draft = '';
    assert.equal(live.onInput({ source: 'interactive', text: raw.trim(), cursorOffset: raw.length }), undefined);
    await tick();
    assert.equal(live.ctx.draft, '');
    assert.deepEqual(live.ctx.sets, []);
  });
});
