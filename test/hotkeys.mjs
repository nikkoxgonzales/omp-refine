/**
 * Hotkeys acceptance test — runs against the COMPILED package (dist).
 *
 * Covers: trailing-backslash counting (odd/even/lone/multiline); the pure
 * shouldContinue gate (interactive-only, no images, string text); and the
 * wired input handler with a FAKE pi/ctx — continuation swallows the submit
 * and restores editor text, everything else passes through, and a missing
 * or throwing editor fails OPEN (submits literally, never eats input).
 *
 * Plain Node ESM — no test-runner dependency (also runs under `node --test`).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
  countTrailingBackslashes,
  hasContinuation,
  stripContinuation,
  shouldContinue,
} = await import('../dist/index.js');
const { default: hotkeysExtension } = await import('../dist/extension.js');

/** Install the extension on a fake pi, return the captured input handler. */
function install(ctx) {
  const handlers = {};
  const pi = { on: (event, handler) => { handlers[event] = handler; } };
  hotkeysExtension(pi);
  assert.equal(typeof handlers.input, 'function', 'registers an input handler');
  return (event) => handlers.input(event, ctx);
}

function ctxWithEditor() {
  const ctx = { editorText: '', ui: null };
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
});
