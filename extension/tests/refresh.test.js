import test from 'node:test';
import assert from 'node:assert/strict';
import { RefreshLoop } from '../lib/refresh.js';

function fixture(run, canRun = () => true) {
  let now = 0, id = 0;
  const timers = new Map();
  const loop = new RefreshLoop(run, { canRun, now: () => now,
    setTimer: (fn, delay) => { timers.set(++id, { fn, delay }); return id; }, clearTimer: id => timers.delete(id) });
  const tick = () => { const [key, timer] = timers.entries().next().value; timers.delete(key); now += timer.delay; return timer.fn(); };
  return { loop, timers, tick };
}

test('refresh uses native browser timers with their global receiver', async t => {
  let scheduled, calls = 0;
  t.mock.method(globalThis, 'setTimeout', function (fn) {
    assert.equal(this, globalThis); scheduled = fn; return 1;
  });
  t.mock.method(globalThis, 'clearTimeout', function () {
    assert.equal(this, globalThis); scheduled = null;
  });
  const loop = new RefreshLoop(async () => { calls++; });
  loop.setInterval(1000);
  await scheduled();
  assert.equal(calls, 1);
  loop.setInterval(0);
  assert.equal(scheduled, null);
});

test('hidden and busy panels skip refresh; rate-limit cooldown blocks subsequent calls', async () => {
  let available = false, calls = 0;
  const f = fixture(async () => { calls++; }, () => available);
  f.loop.setInterval(1000); await f.tick(); assert.equal(calls, 0);
  available = true; await f.tick(); assert.equal(calls, 1);
  f.loop.pauseFor(3000); await f.tick(); await f.tick(); assert.equal(calls, 1);
  await f.tick(); assert.equal(calls, 2);
  f.loop.setInterval(0); assert.equal(f.timers.size, 0);
});

test('in-flight refresh never overlaps and changing intervals keeps only one timer', async () => {
  let finish, calls = 0;
  const f = fixture(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  f.loop.setInterval(1000);
  const pending = f.tick();
  f.loop.setInterval(2000); await f.tick(); assert.equal(calls, 1);
  finish(); await pending;
  assert.equal(f.timers.size, 1);
  f.loop.setInterval(0); assert.equal(f.timers.size, 0);
});

test('an unexpected refresh failure stops scheduling', async () => {
  const f = fixture(async () => { throw new Error('failed'); });
  f.loop.setInterval(1000); await f.tick();
  assert.equal(f.timers.size, 0); assert.equal(f.loop.intervalMs, 0);
});
