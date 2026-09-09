/**
 * Double-Escape acceptance test — runs against the COMPILED package (dist).
 *
 * Covers the pure gesture (pair inside/outside the window, boundary,
 * non-Escape resets pairing, sequences pass through, empty draft passes,
 * throwing editor never propagates) and the extension wiring (subscribe on
 * session start, re-arm on switch, release on shutdown, headless-safe).
 *
 * Plain Node ESM — no test-runner dependency (also runs under `node --test`).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
  createDoubleEscapeHandler,
  DOUBLE_ESCAPE_MS,
  ESCAPE_KEY,
} = await import('../dist/index.js');
const { default: hotkeysExtension } = await import('../dist/extension.js');

const ESC = ESCAPE_KEY;

/** Deterministic clock: one value per Escape (the handler reads it once). */
function scriptedClock(times) {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)];
}

function rig({ draft = '', times = [0, 0], throwingGet = false, throwingSet = false } = {}) {
  const state = { draft, sets: [] };
  const handler = createDoubleEscapeHandler({
    getText: () => {
      if (throwingGet) throw new Error('gone');
      return state.draft;
    },
    setText: (text) => {
      if (throwingSet) throw new Error('gone');
      state.draft = text;
      state.sets.push(text);
    },
    now: scriptedClock(times),
  });
  return { state, handler };
}

describe('double-Escape gesture', () => {
  it(`pairs inside the window (<= ${DOUBLE_ESCAPE_MS}ms) and clears`, () => {
    const { state, handler } = rig({ draft: 'hello', times: [1000, 1400] });
    assert.equal(handler(ESC), undefined);
    assert.deepEqual(handler(ESC), { consume: true });
    assert.deepEqual(state.sets, ['']);
    assert.equal(state.draft, '');
  });
  it('clears exactly on the boundary, passes just past it', () => {
    const onEdge = rig({ draft: 'hi', times: [0, DOUBLE_ESCAPE_MS] });
    onEdge.handler(ESC);
    assert.deepEqual(onEdge.handler(ESC), { consume: true });

    const pastEdge = rig({ draft: 'hi', times: [0, DOUBLE_ESCAPE_MS + 1] });
    pastEdge.handler(ESC);
    assert.equal(pastEdge.handler(ESC), undefined);
    assert.deepEqual(pastEdge.state.sets, []);
  });
  it('slow pairs stay two single Escapes', () => {
    const { state, handler } = rig({ draft: 'hello', times: [0, 600, 700] });
    assert.equal(handler(ESC), undefined);
    assert.equal(handler(ESC), undefined); // 600ms: too slow, re-arms…
    assert.deepEqual(handler(ESC), { consume: true }); // …100ms later: pairs
    assert.equal(state.draft, '');
  });
  it('typing between Escapes breaks the pair', () => {
    const { state, handler } = rig({ draft: 'hello', times: [0, 100] });
    assert.equal(handler(ESC), undefined);
    assert.equal(handler('x'), undefined);
    assert.equal(handler(ESC), undefined);
    assert.deepEqual(state.sets, []);
  });
  it('key sequences pass through and break the pair', () => {
    const { state, handler } = rig({ draft: 'hello', times: [0, 100] });
    assert.equal(handler(ESC), undefined);
    for (const seq of ['\x1b[A', '\x1bb', '\x1b[200~hi\x1b[201~', 'a']) {
      assert.equal(handler(seq), undefined);
    }
    assert.equal(handler(ESC), undefined);
    assert.deepEqual(state.sets, []);
  });
  it('empty draft never consumes (host owns Escape: interrupt/rewind)', () => {
    const { state, handler } = rig({ draft: '', times: [0, 100] });
    assert.equal(handler(ESC), undefined);
    assert.equal(handler(ESC), undefined);
    assert.deepEqual(state.sets, []);
  });
  it('draft emptied between limbs passes the second through', () => {
    const { state, handler } = rig({ draft: 'hello', times: [0, 100] });
    assert.equal(handler(ESC), undefined);
    state.draft = '';
    assert.equal(handler(ESC), undefined);
    assert.deepEqual(state.sets, []);
  });
  it('throwing editor never propagates', () => {
    const badGet = rig({ draft: 'hi', throwingGet: true, times: [0, 100] });
    assert.equal(badGet.handler(ESC), undefined);
    assert.equal(badGet.handler(ESC), undefined);

    const badSet = rig({ draft: 'hi', throwingSet: true, times: [0, 100] });
    assert.equal(badSet.handler(ESC), undefined);
    assert.deepEqual(badSet.handler(ESC), { consume: true });
  });
  it('defaults to the live clock', () => {
    const seen = [];
    const handler = createDoubleEscapeHandler({
      getText: () => 'hi',
      setText: (t) => seen.push(t),
    });
    assert.equal(handler(ESC), undefined);
    assert.deepEqual(handler(ESC), { consume: true });
    assert.deepEqual(seen, ['']);
  });
});

describe('terminal-input wiring', () => {
  function install(ui) {
    const handlers = {};
    hotkeysExtension({ on: (event, handler) => { handlers[event] = handler; } });
    return handlers;
  }

  function fakeUi() {
    const state = { draft: '', subscribes: 0, unsubs: 0, subscribed: null };
    const ui = {
      getEditorText: () => state.draft,
      setEditorText: (text) => { state.draft = text; },
      onTerminalInput: (handler) => {
        state.subscribes += 1;
        state.subscribed = handler;
        return () => {
          state.unsubs += 1;
          state.subscribed = null;
        };
      },
    };
    return { state, ui };
  }

  it('arms on start, clears on double-Escape, re-arms on switch, releases on shutdown', () => {
    const { state, ui } = fakeUi();
    const handlers = install(ui);
    handlers.session_start({}, { ui });
    assert.equal(state.subscribes, 1);

    state.draft = 'typed text';
    assert.equal(state.subscribed(ESC), undefined);
    assert.deepEqual(state.subscribed(ESC), { consume: true });
    assert.equal(state.draft, '');

    handlers.session_switch({}, { ui });
    assert.equal(state.unsubs, 1);
    assert.equal(state.subscribes, 2);

    handlers.session_shutdown();
    assert.equal(state.unsubs, 2);
    assert.equal(state.subscribed, null);
  });
  it('headless contexts arm nothing and never throw', () => {
    const handlers = install({});
    assert.doesNotThrow(() => handlers.session_start({}, {}));
    assert.doesNotThrow(() => handlers.session_switch({}, { ui: {} }));
    assert.doesNotThrow(() => handlers.session_shutdown());
  });
});
