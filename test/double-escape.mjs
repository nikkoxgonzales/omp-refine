/**
 * Double-Escape acceptance test — runs against the COMPILED package (dist).
 *
 * Covers the pure gesture (busy-guarded first limb, pair inside/outside
 * the window, boundary, idle limbs pass but still arm, non-Escape resets
 * pairing, sequences pass through, blank draft passes, throwing editor
 * never propagates) and the extension wiring (subscribe on session start,
 * busy gate follows agent events, re-arm on switch, release on shutdown,
 * headless-safe, unknown-event hosts don't break registration).
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
const { default: refineExtension } = await import('../dist/extension.js');

const ESC = ESCAPE_KEY;

/** Deterministic clock: one value per Escape (the handler reads it once). */
function scriptedClock(times) {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)];
}

function rig({ draft = '', times = [0, 0], busy = true, throwingGet = false, throwingSet = false, throwingBusy = false, omitBusy = false } = {}) {
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
    ...(omitBusy ? {} : { isBusy: () => {
      if (throwingBusy) throw new Error('gone');
      return busy;
    } }),
    now: scriptedClock(times),
  });
  return { state, handler };
}

describe('double-Escape gesture', () => {
  it('swallows the first limb with a draft while busy (never interrupts)', () => {
    const { state, handler } = rig({ draft: 'hello', times: [1000] });
    assert.deepEqual(handler(ESC), { consume: true });
    assert.deepEqual(state.sets, []);
    assert.equal(state.draft, 'hello');
  });
  it(`pairs inside the window (<= ${DOUBLE_ESCAPE_MS}ms) and clears`, () => {
    const { state, handler } = rig({ draft: 'hello', times: [1000, 1400] });
    assert.deepEqual(handler(ESC), { consume: true });
    assert.deepEqual(handler(ESC), { consume: true });
    assert.deepEqual(state.sets, ['']);
    assert.equal(state.draft, '');
  });
  it('clears exactly on the boundary, re-arms just past it', () => {
    const onEdge = rig({ draft: 'hi', times: [0, DOUBLE_ESCAPE_MS] });
    assert.deepEqual(onEdge.handler(ESC), { consume: true });
    assert.deepEqual(onEdge.handler(ESC), { consume: true });
    assert.deepEqual(onEdge.state.sets, ['']);

    const pastEdge = rig({ draft: 'hi', times: [0, DOUBLE_ESCAPE_MS + 1] });
    assert.deepEqual(pastEdge.handler(ESC), { consume: true });
    // 1ms past the window: no pair, but still a guarded first limb —
    // swallowed, re-armed, nothing cleared.
    assert.deepEqual(pastEdge.handler(ESC), { consume: true });
    assert.deepEqual(pastEdge.state.sets, []);
  });
  it('slow pairs stay swallowed singles until one lands in-window', () => {
    const { state, handler } = rig({ draft: 'hello', times: [0, 600, 700] });
    assert.deepEqual(handler(ESC), { consume: true });
    assert.deepEqual(handler(ESC), { consume: true }); // 600ms: too slow, re-arms…
    assert.deepEqual(handler(ESC), { consume: true }); // …100ms later: pairs + clears
    assert.equal(state.draft, '');
  });
  it('typing between Escapes breaks the pair (both still swallowed)', () => {
    const { state, handler } = rig({ draft: 'hello', times: [0, 100] });
    assert.deepEqual(handler(ESC), { consume: true });
    assert.equal(handler('x'), undefined);
    assert.deepEqual(handler(ESC), { consume: true });
    assert.deepEqual(state.sets, []);
  });
  it('key sequences pass through and break the pair', () => {
    const { state, handler } = rig({ draft: 'hello', times: [0, 100] });
    assert.deepEqual(handler(ESC), { consume: true });
    for (const seq of ['\x1b[A', '\x1bb', '\x1b[200~hi\x1b[201~', 'a']) {
      assert.equal(handler(seq), undefined);
    }
    assert.deepEqual(handler(ESC), { consume: true });
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
    assert.deepEqual(handler(ESC), { consume: true });
    state.draft = '';
    assert.equal(handler(ESC), undefined);
    assert.deepEqual(state.sets, []);
  });
  it('triple-Escape clears then passes through (interrupt lands on empty box)', () => {
    const { state, handler } = rig({ draft: 'hello', times: [0, 100, 200] });
    assert.deepEqual(handler(ESC), { consume: true });
    assert.deepEqual(handler(ESC), { consume: true });
    assert.equal(state.draft, '');
    assert.equal(handler(ESC), undefined);
    assert.deepEqual(state.sets, ['']);
  });
  it('throwing editor never propagates', () => {
    const badGet = rig({ draft: 'hi', throwingGet: true, times: [0, 100] });
    assert.equal(badGet.handler(ESC), undefined);
    assert.equal(badGet.handler(ESC), undefined);

    const badSet = rig({ draft: 'hi', throwingSet: true, times: [0, 100] });
    assert.deepEqual(badSet.handler(ESC), { consume: true });
    assert.deepEqual(badSet.handler(ESC), { consume: true });
  });
  it('defaults to the live clock', () => {
    const seen = [];
    const handler = createDoubleEscapeHandler({
      getText: () => 'hi',
      setText: (t) => seen.push(t),
    });
    assert.deepEqual(handler(ESC), { consume: true });
    assert.deepEqual(handler(ESC), { consume: true });
    assert.deepEqual(seen, ['']);
  });
  it('idle first limb passes through but still arms the pair', () => {
    const { state, handler } = rig({ draft: 'hello', busy: false, times: [0, 100] });
    assert.equal(handler(ESC), undefined);
    assert.deepEqual(handler(ESC), { consume: true });
    assert.equal(state.draft, '');
  });
  it('idle slow limbs both pass, nothing cleared', () => {
    const { state, handler } = rig({ draft: 'hello', busy: false, times: [0, 600] });
    assert.equal(handler(ESC), undefined);
    assert.equal(handler(ESC), undefined);
    assert.deepEqual(state.sets, []);
  });
  it('idle typing between Escapes breaks the pair, all pass', () => {
    const { state, handler } = rig({ draft: 'hello', busy: false, times: [0, 100] });
    assert.equal(handler(ESC), undefined);
    assert.equal(handler('x'), undefined);
    assert.equal(handler(ESC), undefined);
    assert.deepEqual(state.sets, []);
  });
  it('whitespace-only draft passes through (host owns rewind)', () => {
    const { state, handler } = rig({ draft: '   ', times: [0, 100] });
    assert.equal(handler(ESC), undefined);
    assert.equal(handler(ESC), undefined);
    assert.deepEqual(state.sets, []);
  });
  it('omitted busy probe defaults to guard-on', () => {
    const { state, handler } = rig({ draft: 'hi', omitBusy: true, times: [1000] });
    assert.deepEqual(handler(ESC), { consume: true });
    assert.deepEqual(state.sets, []);
  });
  it('throwing busy probe fails safe toward guard-on', () => {
    const { state, handler } = rig({ draft: 'hi', throwingBusy: true, times: [1000] });
    assert.deepEqual(handler(ESC), { consume: true });
    assert.deepEqual(state.sets, []);
  });
});

describe('terminal-input wiring', () => {
  function install(ui) {
    const handlers = {};
    refineExtension({ on: (event, handler) => { handlers[event] = handler; } });
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

    // Idle: first limb passes (host no-op / menu dismiss), second clears.
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
  it('busy gate follows agent events; switch/shutdown reset to idle', () => {
    const { state, ui } = fakeUi();
    const handlers = install(ui);
    handlers.session_start({}, { ui });
    state.draft = 'typed text';

    handlers.agent_start({});
    assert.deepEqual(state.subscribed(ESC), { consume: true });
    assert.equal(state.draft, 'typed text');

    handlers.agent_end({});
    assert.equal(state.subscribed('x'), undefined); // typing breaks the armed pair
    assert.equal(state.subscribed(ESC), undefined);
    state.draft = 'typed text';
    handlers.agent_start({});
    assert.deepEqual(state.subscribed(ESC), { consume: true });
    handlers.agent_settled({});
    state.draft = 'typed text';
    assert.equal(state.subscribed(ESC), undefined);

    // A context change never leaves the guard armed.
    state.draft = 'typed text';
    handlers.agent_start({});
    handlers.session_switch({}, { ui });
    assert.equal(state.subscribed(ESC), undefined);
    assert.equal(state.draft, 'typed text');

    handlers.agent_start({});
    handlers.session_shutdown();
    assert.equal(state.subscribed, null);
  });
  it('hosts rejecting unknown events keep core registrations', () => {
    const handlers = {};
    const pi = { on: (event) => {
      if (event.startsWith('agent_')) throw new Error('unknown event');
      handlers[event] = (...args) => args;
    } };
    assert.doesNotThrow(() => refineExtension(pi));
    assert.equal(typeof handlers.input, 'function');
    assert.equal(typeof handlers.session_start, 'function');
  });
  it('headless contexts arm nothing and never throw', () => {
    const handlers = install({});
    assert.doesNotThrow(() => handlers.session_start({}, {}));
    assert.doesNotThrow(() => handlers.session_switch({}, { ui: {} }));
    assert.doesNotThrow(() => handlers.session_shutdown());
  });
});
