import test from 'node:test';
import assert from 'node:assert/strict';
import { createQbtSession } from '../lib/qbt-session.js';
import { QBT_HEADER_RULE_IDS } from '../lib/qbittorrent.js';
import { createDownloaders } from '../lib/downloaders.js';
import { safeError } from '../lib/core.js';

const config = { id: 'nas', revision: 'r1', name: 'NAS', url: 'https://nas.example:5443/qbt',
  auth: 'password', username: 'user', password: 'test-password' };

function fixture({ permit = true, rejectRules = false } = {}) {
  const calls = [], active = new Map([[23001, { id: 23001, legacy: true }]]);
  const session = createQbtSession({
    runtime: { id: 'own-id' },
    permissions: { async contains({ origins }) { assert.deepEqual(origins, ['https://nas.example:5443/*']); return permit; } },
    declarativeNetRequest: { async updateSessionRules(change) {
      calls.push(change);
      if (rejectRules && change.addRules?.length) throw new Error('private-hostname: pattern too large');
      for (const id of change.removeRuleIds) active.delete(id);
      for (const rule of change.addRules || []) active.set(rule.id, rule);
    } }
  });
  return { session, calls, active };
}

test('session replaces the legacy rule, scopes each endpoint and cleans every rule', async () => {
  const { session, active } = fixture();
  await session.prepare(config);
  assert.deepEqual([...active.keys()], [...QBT_HEADER_RULE_IDS]);
  assert.equal(active.get(23001).legacy, undefined);
  for (const rule of active.values()) {
    assert.deepEqual(rule.condition.initiatorDomains, ['own-id']);
    assert.deepEqual(rule.condition.resourceTypes, ['xmlhttprequest']);
    const method = /auth\/login|torrents\/(?:add|delete)/.test(rule.condition.regexFilter) ? 'post' : 'get';
    assert.deepEqual(rule.condition.requestMethods, [method]);
    assert.equal(rule.action.requestHeaders.find(header => header.header === 'Origin').value, 'https://nas.example:5443');
    assert.equal(new RegExp(rule.condition.regexFilter).test('https://other.example/api/v2/auth/login'), false);
  }
  await session.cleanup();
  assert.equal(active.size, 0);
});

test('switching to API Key removes all password rules and adds none', async () => {
  const { session, active, calls } = fixture();
  await session.prepare(config);
  await session.prepare({ ...config, auth: 'apikey' });
  assert.equal(active.size, 0);
  assert.deepEqual(calls.at(-1).addRules, []);
});

test('missing host permission installs no rules', async () => {
  const { session, calls } = fixture({ permit: false });
  await assert.rejects(session.prepare(config), { code: 'QBT_PERMISSION' });
  assert.equal(calls.length, 0);
});

test('connection check installs matching rules before login and removes them after reading paths', async () => {
  const { session, active } = fixture(), requested = [];
  const handle = createDownloaders({
    storage: { async get() { return { downloaders: [config] }; } },
    prepare: session.prepare, cleanup: session.cleanup,
    qbtOptions: { fetchFn: async (url, options) => {
      requested.push(url);
      const matching = [...active.values()].filter(rule =>
        rule.condition.requestMethods.includes(options.method.toLowerCase()) &&
        new RegExp(rule.condition.regexFilter).test(url));
      assert.equal(matching.length, 1, `${options.method} ${url}`);
      assert.equal(options.credentials, 'include');
      if (url.endsWith('/auth/login')) return new Response('Ok.');
      if (url.endsWith('/app/defaultSavePath')) return new Response('/downloads');
      if (url.endsWith('/torrents/categories')) return new Response('{}');
      assert.fail('Unexpected API request');
    } }
  });
  const result = await handle({ type: 'downloaders.test', downloaderId: 'nas', revision: 'r1' });
  assert.equal(result.defaultPath, '/downloads');
  assert.equal(requested.length, 3);
  assert.equal(active.size, 0);
});

test('rejected browser rules produce a specific safe error before any login request', async () => {
  const { session, calls } = fixture({ rejectRules: true });
  let networkCalls = 0;
  const handle = createDownloaders({
    storage: { async get() { return { downloaders: [config] }; } },
    prepare: session.prepare, cleanup: session.cleanup,
    qbtOptions: { fetchFn: async () => { networkCalls++; } }
  });
  await assert.rejects(handle({ type: 'downloaders.test', downloaderId: 'nas', revision: 'r1' }), error => {
    const publicError = safeError(error);
    assert.equal(publicError.code, 'QBT_RULES');
    assert.match(publicError.message, /连接规则/);
    assert.equal(publicError.message.includes('private-hostname'), false);
    return true;
  });
  assert.equal(networkCalls, 0);
  assert.deepEqual(calls.at(-1), { removeRuleIds: [...QBT_HEADER_RULE_IDS] });
});
