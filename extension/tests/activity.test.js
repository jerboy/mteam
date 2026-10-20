import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivity, VISIT_ALARM, CHECK_ALARM } from '../lib/activity.js';

const DAY = 86400000;
function fixture(initial = {}, overrides = {}) {
  const memory = structuredClone({ config: { apiKey: 'unit-test-key' }, configRevision: 'account-a', ...initial });
  const scheduled = new Map(), opened = [];
  let clock = 1000000, profile = '2026-10-01 12:00:00';
  const storage = {
    async get(keys) { return structuredClone(Object.fromEntries(keys.map(key => [key, memory[key]]))); },
    async set(values) { Object.assign(memory, structuredClone(values)); }
  };
  const dependencies = { storage, now: () => clock,
    alarms: { async create(name, options) { scheduled.set(name, options); }, async clear(name) { scheduled.delete(name); } },
    openTab: async options => { opened.push(options); }, readProfile: async () => ({ lastWebBrowse: profile }), ...overrides };
  return { memory, scheduled, opened, dependencies, activity: createActivity(dependencies),
    advance: ms => { clock += ms; }, setProfile: value => { profile = value; }, time: () => clock };
}

test('periodic visits default off, require an API key and restore the persisted due time', async () => {
  const f = fixture();
  await f.activity.reconcile();
  assert.equal((await f.activity.status()).enabled, false);
  assert.equal(f.scheduled.size, 0); assert.equal(f.opened.length, 0);
  await f.activity.configure({ enabled: true, intervalDays: 14 });
  assert.equal(f.scheduled.get(VISIT_ALARM).when, f.time() + 14 * DAY);
  f.scheduled.clear(); f.advance(DAY);
  await createActivity(f.dependencies).reconcile();
  assert.equal(f.scheduled.get(VISIT_ALARM).when, f.time() + 13 * DAY);
  const missing = fixture({ config: {} });
  await assert.rejects(missing.activity.configure({ enabled: true, intervalDays: 14 }), { code: 'NO_KEY' });
});

test('overdue alarms open one background tab and coalesce missed periods', async () => {
  const f = fixture();
  await f.activity.configure({ enabled: true, intervalDays: 7 });
  await f.activity.onAlarm({ name: VISIT_ALARM }); assert.equal(f.opened.length, 0);
  f.advance(28 * DAY);
  await Promise.all([f.activity.onAlarm({ name: VISIT_ALARM }), f.activity.onAlarm({ name: VISIT_ALARM })]);
  assert.deepEqual(f.opened, [{ url: 'https://kp.m-team.cc/browse', active: false }]);
  assert.equal(f.scheduled.get(VISIT_ALARM).when, f.time() + 7 * DAY);
  assert.equal(f.scheduled.get(CHECK_ALARM).when, f.time() + 60000);
  assert.equal((await f.activity.visit()).reason, 'recent_attempt');
});

test('manual visits work while scheduling is off and verification survives worker replacement', async () => {
  const f = fixture();
  await f.activity.visit();
  assert.equal(f.opened[0].active, true);
  assert.equal(f.scheduled.has(VISIT_ALARM), false);
  assert.equal((await f.activity.status()).pending, undefined);
  const restarted = createActivity(f.dependencies);
  await restarted.reconcile();
  await restarted.onAlarm({ name: CHECK_ALARM });
  assert.equal((await restarted.status()).checking, true);
  f.advance(60000); f.setProfile('2026-10-20 12:00:00');
  await restarted.onAlarm({ name: CHECK_ALARM });
  const status = await restarted.status();
  assert.equal(status.status, 'changed'); assert.equal(status.checking, false);
  assert.equal(status.lastWebBrowse, '2026-10-20 12:00:00');
  assert.equal(f.scheduled.has(CHECK_ALARM), false);
  assert.equal(JSON.stringify(status).includes('unit-test-key'), false);
});

test('unchanged or unreadable profile never claims a successful login and schedules one later attempt', async () => {
  for (const readProfile of [async () => ({ lastWebBrowse: null }), async () => { throw new Error('offline'); }]) {
    const f = fixture({}, { readProfile });
    await f.activity.configure({ enabled: true, intervalDays: 14 });
    f.advance(14 * DAY); await f.activity.onAlarm({ name: VISIT_ALARM }); f.advance(60000);
    await f.activity.onAlarm({ name: CHECK_ALARM });
    assert.equal((await f.activity.status()).status, 'unverified');
    assert.equal(f.scheduled.get(VISIT_ALARM).when, f.time() + DAY);
    assert.equal(f.opened.length, 1);
  }
});

test('disabling a plan cancels an in-flight visit before any browser tab opens', async () => {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const profile = new Promise(resolve => { release = resolve; });
  const f = fixture({}, { readProfile: () => { started(); return profile; } });
  const visiting = f.activity.visit(); await ready;
  await f.activity.configure({ enabled: false, intervalDays: 14 });
  release({ lastWebBrowse: 'before' });
  assert.equal((await visiting).reason, 'cancelled');
  assert.equal(f.opened.length, 0); assert.equal(f.scheduled.size, 0);
});

test('verification for a different account is discarded and browser tab failures remain retryable', async () => {
  const f = fixture();
  await f.activity.visit(); f.advance(60000); f.memory.configRevision = 'account-b';
  await f.activity.onAlarm({ name: CHECK_ALARM });
  assert.equal((await f.activity.status()).checking, false);
  assert.equal((await f.activity.status()).lastWebBrowse, undefined);
  const failed = fixture({}, { openTab: async () => { throw new Error('no browser'); } });
  await failed.activity.configure({ enabled: true, intervalDays: 14 });
  await assert.rejects(failed.activity.visit(), { code: 'OPEN_TAB' });
  assert.equal((await failed.activity.status()).status, 'failed');
  assert.equal(failed.scheduled.get(VISIT_ALARM).when, failed.time() + DAY);
});
