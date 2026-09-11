/**
 * Hotkeys acceptance test — runs against the COMPILED package (dist).
 *
 * Covers: trailing-backslash counting (odd/even/lone/multiline); the pure
 * shouldContinue gate (interactive-only, no images, string text); the
 * cursor-aware splice helpers; the raw-draft resolver (hosts trim the
 * draft before emitting `input`, so trailing-space evidence survives only
 * in the live editor); the cursor-offset reader; and the wired input
 * handler with a FAKE pi/ctx — continuation swallows the submit and
 * restores editor text, everything else passes through, and a missing
 * or throwing editor fails OPEN (submits literally, never eats input).
 *
 * The fake host mirrors the real submit path: the editor holds the RAW
 * draft while `event.text` carries the host-trimmed submission.
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
  shouldContinue,
  resolveBaseText,
  readCursorOffset,
} = await import('../dist/index.js');
const { default: refineExtension } = await import('../dist/extension.js');

/** Install the extension on a fake pi, return the captured input handler. */
function install(ctx) {
  const handlers = {};
  const pi = { on: (event, handler) => { handlers[event] = handler; } };
  refineExtension(pi);
  assert.equal(typeof handlers.input, 'function', 'registers an input handler');
  return (event) => handlers.input(event, ctx);
}

/** Fake ctx whose editor holds the RAW draft (pre-host-trim), like the live host. */
function ctxWithEditor(raw = '') {
  const ctx = { editorText: raw, ui: null };
  ctx.ui = {
    getEditorText() { return ctx.editorText; },
    setEditorText(text) { ctx.editorText = text; },
  };
  return ctx;
}

/** Submit `raw` the way the host delivers it: trimmed event text + raw editor. */
function hostSubmit(raw, extra = {}) {
  return { ctx: ctxWithEditor(raw), event: { source: 'interactive', text: raw.trim(), ...extra } };
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

describe('wired input handler', () => {
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
  it('trailing space vetoes: host-trimmed "foo\\ " passes through untouched', async () => {
    for (const raw of ['foo\\ ', 'foo\\  ', 'foo\\ \t']) {
      const { ctx, event } = hostSubmit(raw);
      assert.equal(event.text, 'foo\\'); // the host trims before emitting
      const onInput = install(ctx);
      assert.equal(onInput(event), undefined);
      await tick();
      assert.equal(ctx.editorText, raw); // draft preserved verbatim
    }
  });
  it('genuine continuation still swallows when the raw draft agrees', async () => {
    const { ctx, event } = hostSubmit('hello\\');
    const onInput = install(ctx);
    assert.deepEqual(onInput(event), { handled: true });
    await tick();
    assert.equal(ctx.editorText, 'hello\n');
  });
  it('cleared editor falls back to the event text (legacy behavior)', async () => {
    const ctx = ctxWithEditor(); // editor already cleared: raw is ''
    const onInput = install(ctx);
    assert.deepEqual(onInput({ source: 'interactive', text: 'hello\\' }), { handled: true });
    await tick();
    assert.equal(ctx.editorText, 'hello\n');
  });
  it('unrelated editor rewrite passes through (respects the handler chain)', async () => {
    const ctx = ctxWithEditor('foo\\');
    const onInput = install(ctx);
    assert.equal(onInput({ source: 'interactive', text: 'bar' }), undefined);
    await tick();
    assert.equal(ctx.editorText, 'foo\\');
  });
  it('leading-space trim restores the raw draft faithfully', async () => {
    const { ctx, event } = hostSubmit('  foo\\');
    assert.equal(event.text, 'foo\\');
    const onInput = install(ctx);
    assert.deepEqual(onInput(event), { handled: true });
    await tick();
    assert.equal(ctx.editorText, '  foo\n');
  });
  it('mid-line cursor splices the newline at the cursor', async () => {
    const { ctx, event } = hostSubmit('hello \\ world', { cursorOffset: 7 });
    const onInput = install(ctx);
    assert.deepEqual(onInput(event), { handled: true });
    await tick();
    assert.equal(ctx.editorText, 'hello \n world');
  });
  it('mid-line cursor without a gap splices directly', async () => {
    const { ctx, event } = hostSubmit('hello \\world', { cursorOffset: 7 });
    const onInput = install(ctx);
    assert.deepEqual(onInput(event), { handled: true });
    await tick();
    assert.equal(ctx.editorText, 'hello \nworld');
  });
  it('cursor at the end behaves like the end-of-text check', async () => {
    const { ctx, event } = hostSubmit('foo\\', { cursorOffset: 4 });
    const onInput = install(ctx);
    assert.deepEqual(onInput(event), { handled: true });
    await tick();
    assert.equal(ctx.editorText, 'foo\n');
  });
  it('reported cursor governs: Enter elsewhere submits literally', async () => {
    const { ctx, event } = hostSubmit('ab\\', { cursorOffset: 1 });
    const onInput = install(ctx);
    assert.equal(onInput(event), undefined); // cursor after 'a', not after '\'
    await tick();
    assert.equal(ctx.editorText, 'ab\\');
  });
  it('even run before the cursor passes through (mid-line escape hatch)', async () => {
    const { ctx, event } = hostSubmit('a\\\\b', { cursorOffset: 3 });
    const onInput = install(ctx);
    assert.equal(onInput(event), undefined);
    await tick();
    assert.equal(ctx.editorText, 'a\\\\b');
  });
  it('invalid cursor offset falls back to the end-of-text check', async () => {
    const { ctx, event } = hostSubmit('foo\\', { cursorOffset: 99 });
    const onInput = install(ctx);
    assert.deepEqual(onInput(event), { handled: true });
    await tick();
    assert.equal(ctx.editorText, 'foo\n');
  });
});
