import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppWindow } from '../lib/app-window.js';

const root = `chrome-extension://${'a'.repeat(32)}/`;
function fixture() {
  const memory = {}, windows = new Map(), tabs = new Map(), created = [], updates = [], removed = [];
  let nextId = 1;
  const chrome = {
    runtime: { getURL: path => root + path },
    storage: { session: {
      async get(key) { return { [key]: memory[key] }; },
      async set(values) { Object.assign(memory, values); }
    } },
    windows: {
      async get(id) { if (!windows.has(id)) throw new Error('Closed'); return windows.get(id); },
      async getAll() { return [...windows.values()]; },
      async create(options) {
        created.push(options);
        const window = { id: nextId++, type: options.type, state: 'normal', tabs: [{ url: options.url }] };
        windows.set(window.id, window);
        return window;
      },
      async update(id, options) { updates.push({ id, ...options }); Object.assign(windows.get(id), options); }
    },
    tabs: {
      async get(id) { if (!tabs.has(id)) throw new Error('Closed'); return tabs.get(id); },
      async remove(id) { removed.push(id); tabs.delete(id); }
    }
  };
  return { chrome, memory, windows, tabs, created, updates, removed, manager: createAppWindow(chrome) };
}

test('concurrent launches create one app window and subsequent launches focus it', async () => {
  const f = fixture();
  const results = await Promise.all([f.manager.open(), f.manager.open(), f.manager.open()]);
  assert.deepEqual(results, Array(3).fill({ opened: true, windowId: 1 }));
  assert.equal(f.created.length, 1);
  assert.deepEqual(f.created[0], { url: root + 'popup.html?view=app', type: 'popup', width: 1080, height: 800, focused: true });
  await f.manager.open();
  assert.deepEqual(f.updates, [{ id: 1, focused: true }]);
});

test('worker restart reuses a minimized detail window and preserves its current page', async () => {
  const f = fixture();
  await f.manager.open();
  const window = f.windows.get(1);
  window.state = 'minimized'; window.tabs[0].url = root + 'detail.html?id=12&view=app';
  await createAppWindow(f.chrome).open();
  assert.equal(f.created.length, 1);
  assert.deepEqual(f.updates[0], { id: 1, focused: true, state: 'normal' });
  assert.equal(window.tabs[0].url, root + 'detail.html?id=12&view=app');
});

test('session loss recovers an existing app settings window', async () => {
  const f = fixture();
  f.windows.set(7, { id: 7, type: 'popup', tabs: [{ url: root + 'options.html?view=app' }] });
  assert.equal((await f.manager.open()).windowId, 7);
  assert.equal(f.created.length, 0); assert.equal(f.memory.appWindowId, 7);
});

test('a closed window is recreated instead of relying on its stale ID', async () => {
  const f = fixture();
  await f.manager.open(); f.windows.clear();
  assert.equal((await f.manager.open()).windowId, 2);
  assert.equal(f.created.length, 2);
});

test('ID reuse, incognito, normal tabs and navigated windows are not claimed', async () => {
  for (const replacement of [
    { type: 'normal' }, { incognito: true },
    { tabs: [{ url: 'https://example.org/popup.html?view=app' }] },
    { tabs: [{ url: root + 'popup.html?view=tab' }] },
    { tabs: [{ url: root + 'popup.html?view=app', pendingUrl: 'https://example.org/' }] },
    { tabs: [{ url: root + 'launch.html?view=app' }] },
    { tabs: [{ url: root + 'popup.html?view=app' }, { url: 'https://example.org/' }] }
  ]) {
    const f = fixture(); await f.manager.open();
    Object.assign(f.windows.get(1), replacement);
    assert.equal((await f.manager.open()).windowId, 2);
    assert.equal(f.updates.length, 0);
  }
});

test('a failed launch can be retried without retaining a rejected promise', async () => {
  const f = fixture(), create = f.chrome.windows.create;
  f.chrome.windows.create = async () => { throw new Error('Unavailable'); };
  await assert.rejects(f.manager.open(), /Unavailable/);
  f.chrome.windows.create = create;
  assert.equal((await f.manager.open()).windowId, 1);
});

test('failure to focus an existing window does not create duplicates', async () => {
  const f = fixture(); await f.manager.open();
  f.chrome.windows.update = async () => { throw new Error('Unavailable'); };
  await assert.rejects(f.manager.open(), /Unavailable/);
  assert.equal(f.created.length, 1);
});

test('only the temporary launcher tab can close, never a navigated tab or another extension page', async () => {
  const f = fixture();
  f.tabs.set(1, { url: root + 'launch.html' });
  f.tabs.set(2, { url: root + 'popup.html?view=app' });
  f.tabs.set(3, { url: root + 'launch.html', pendingUrl: 'https://example.org/' });
  f.tabs.set(4, { url: 'https://example.org/launch.html' });
  for (const id of [undefined, 99, 1, 2, 3, 4]) await f.manager.closeLauncher(id);
  assert.deepEqual(f.removed, [1]);
});
