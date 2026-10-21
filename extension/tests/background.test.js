import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

test('background accepts only its own UI, limits configuration edits to settings and never returns keys', async () => {
  const memory = { config: { apiKey: 'private-test-key' } };
  let listener;
  const root = 'chrome-extension://test-id/';
  globalThis.chrome = {
    runtime: { id: 'test-id', getURL: path => root + path, onMessage: { addListener(fn) { listener = fn; } } },
    storage: { local: {
      async setAccessLevel() {},
      async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, memory[key]])); },
      async set(values) { Object.assign(memory, values); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete memory[key]; }
    } }, downloads: {}, tabs: { async create() {} }
  };
  await import('../background.js');
  assert.equal(listener({ type: 'config.status' }, { id: 'other-id', url: root + 'popup.html' }, () => assert.fail('foreign sender accepted')), false);
  assert.equal(listener({ type: 'config.status' }, { id: 'test-id', url: 'https://evil.example' }, () => assert.fail('web sender accepted')), false);
  let denied;
  listener({ type: 'config.clear' }, { id: 'test-id', url: root + 'popup.html' }, value => { denied = value; });
  assert.equal(denied.error.code, 'FORBIDDEN'); assert.ok(memory.config.apiKey);
  listener({ type: 'activity.configure', preferences: { enabled: true, intervalDays: 7 } }, { id: 'test-id', url: root + 'popup.html' }, value => { denied = value; });
  assert.equal(denied.error.code, 'FORBIDDEN');
  for (const type of ['downloaders.save', 'downloaders.remove']) {
    listener({ type }, { id: 'test-id', url: root + 'popup.html' }, value => { denied = value; });
    assert.equal(denied.error.code, 'FORBIDDEN');
  }
  const status = await new Promise(resolve => listener({ type: 'config.status' }, { id: 'test-id', url: root + 'popup.html?view=tab' }, resolve));
  assert.equal(status.ok, true); assert.equal(JSON.stringify(status).includes(memory.config.apiKey), false);
  const detailStatus = await new Promise(resolve => listener({ type: 'config.status' }, { id: 'test-id', url: root + 'detail.html?id=123#intro' }, resolve));
  assert.equal(detailStatus.ok, true); assert.equal(JSON.stringify(detailStatus).includes(memory.config.apiKey), false);
  for (const type of ['config.save', 'config.clear', 'activity.configure', 'downloaders.save', 'downloaders.remove']) {
    listener({ type }, { id: 'test-id', url: root + 'detail.html?id=123' }, value => { denied = value; });
    assert.equal(denied.error.code, 'FORBIDDEN');
  }
  for (const url of [root + 'detail.html.evil', root + 'detail.html/extra', 'https://example.org/detail.html?id=123']) {
    assert.equal(listener({ type: 'config.status' }, { id: 'test-id', url }, () => assert.fail('foreign page accepted')), false);
  }
  const cleared = await new Promise(resolve => listener({ type: 'config.clear' }, { id: 'test-id', url: root + 'options.html' }, resolve));
  assert.equal(cleared.ok, true); assert.equal(memory.config, undefined);
  delete globalThis.chrome;
});

test('installable MV3 package has all entrypoints and downloader hosts require optional permission', async () => {
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, ['https://api.m-team.cc/*', 'https://api.m-team.io/*']);
  assert.equal(manifest.content_scripts, undefined); assert.equal(manifest.externally_connectable, undefined);
  assert.equal(manifest.permissions.includes('cookies'), false);
  assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*']);
  assert.ok(manifest.permissions.includes('declarativeNetRequestWithHostAccess'));
  for (const file of [manifest.background.service_worker, manifest.action.default_popup, manifest.options_ui.page, 'detail.html', 'detail.js', 'detail-page.js', ...Object.values(manifest.icons)]) await access(new URL(file, root));
});
