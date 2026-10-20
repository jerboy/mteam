import test from 'node:test';
import assert from 'node:assert/strict';
import { QBittorrent, passwordHeaderRule } from '../lib/qbittorrent.js';
import { createDownloaders } from '../lib/downloaders.js';
import { normalizeTask, taskHash, taskIdentity, taskMetrics, taskQuery, taskStatus } from '../lib/tasks.js';

const config = { id: 'nas', revision: 'r1', name: 'NAS', url: 'https://nas.example/qbt', auth: 'password', username: 'user', password: 'test-password' };
const hash = 'a'.repeat(40);
const raw = { hash, name: '<video>', save_path: '/data', content_path: '/data/video', added_on: 100,
  progress: 0.4, size: 10000, dlspeed: 1000, upspeed: 2, state: 'downloading',
  magnet_uri: 'sensitive', tracker: 'https://tracker.example/private-token' };
const expected = taskIdentity(normalizeTask(raw));
const message = { type: 'downloaders.deleteTask', downloaderId: 'nas', revision: 'r1', hash, expected, confirmed: true };
const reply = data => new Response(typeof data === 'string' ? data : JSON.stringify(data));
function manager(fetchFn) {
  return createDownloaders({ storage: {
    async get() { return { downloaders: [config] }; }, async set() {}
  }, qbtOptions: { fetchFn } });
}

test('task hashes and pagination reject broad selectors and unexpected query fields', () => {
  assert.equal(taskHash('A'.repeat(40)), hash);
  assert.equal(taskHash('b'.repeat(64)), 'b'.repeat(64));
  for (const value of ['all', `${hash}|${hash}`, '', 'b'.repeat(41), null, { toString: () => hash }]) {
    assert.throws(() => taskHash(value), { code: 'QBT_TASK' });
  }
  assert.deepEqual(taskQuery({ page: 2, filter: 'downloading', hashes: 'all' }), {
    filter: 'downloading', sort: 'added_on', reverse: 'true', limit: '51', offset: '100'
  });
  for (const options of [{ page: -1 }, { page: 0.5 }, { page: Infinity }, { filter: 'all&hashes=all' }]) {
    assert.throws(() => taskQuery(options), { code: 'QBT_TASK' });
  }
});

test('task responses expose only UI fields, clamp metrics and never round incomplete progress to 100%', () => {
  const task = normalizeTask({ ...raw, progress: 0.99999, dlspeed: -1 });
  assert.equal(task.downloadSpeed, 0);
  assert.equal(task.tracker, undefined); assert.equal(task.magnet_uri, undefined);
  assert.match(taskMetrics(task), /^99\.9%/);
  assert.equal(taskStatus(task), '下载中');
  assert.equal(taskStatus({ state: '<unknown>' }), '未知状态');
  assert.equal(normalizeTask({ ...raw, progress: 20 }).progress, 1);
  assert.throws(() => normalizeTask({ ...raw, hash: 'all' }));
});

test('task pagination requests a lookahead and returns at most 50 rows', async () => {
  const client = new QBittorrent(config, { fetchFn: async (url, options) => {
    assert.equal(url, `${config.url}/api/v2/torrents/info?filter=all&sort=added_on&reverse=true&limit=51&offset=50`);
    assert.equal(options.method, 'GET');
    return reply(Array.from({ length: 51 }, (_, index) => ({ ...raw, hash: index.toString(16).padStart(40, '0') })));
  } });
  const result = await client.tasks({ page: 1 });
  assert.equal(result.items.length, 50); assert.equal(result.hasMore, true);
});

test('header rules allow bounded list queries and single-hash lookup but no delete query or extra endpoint', () => {
  const pattern = new RegExp(passwordHeaderRule(config, 'own-id').condition.regexFilter);
  for (const suffix of ['info?filter=all&sort=added_on&reverse=true&limit=51&offset=0', `info?hashes=${hash}`, 'delete']) {
    assert.ok(pattern.test(`${config.url}/api/v2/torrents/${suffix}`));
  }
  for (const suffix of ['delete?hashes=all', 'info?hashes=all', `info?hashes=${hash}%7C${hash}`, 'info', 'deleteAll',
    'info?filter=all&sort=added_on&reverse=true&limit=51&offset=0&extra=true']) {
    assert.equal(pattern.test(`${config.url}/api/v2/torrents/${suffix}`), false);
  }
});

test('deletion requires explicit confirmation and current downloader revision before any network call', async () => {
  let calls = 0;
  const handle = manager(async () => { calls++; return reply(''); });
  for (const change of [{ confirmed: false }, { confirmed: 'true' }, { revision: '' }, { revision: 'old' }, { hash: 'all' }, { expected: null }]) {
    await assert.rejects(handle({ ...message, ...change }));
  }
  assert.equal(calls, 0);
});

test('delete rechecks one exact task, sends POST deleteFiles=true and never sends credentials in task data', async () => {
  const calls = [];
  const handle = manager(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('auth/login')) return reply('Ok.');
    if (url.includes('torrents/info')) return reply([raw]);
    assert.ok(url.endsWith('torrents/delete'));
    assert.equal(options.method, 'POST');
    assert.deepEqual(Object.fromEntries(options.body), { hashes: hash, deleteFiles: 'true' });
    return reply('');
  });
  assert.deepEqual(await handle(message), { requested: true });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].url, `${config.url}/api/v2/torrents/info?hashes=${hash}`);
});

test('missing, replaced, renamed or relocated tasks cannot be deleted from stale confirmations', async () => {
  for (const data of [[], [{ ...raw, hash: 'b'.repeat(40) }], [{ ...raw, name: 'new' }],
    [{ ...raw, save_path: '/elsewhere' }], [{ ...raw, content_path: '/new-file' }], [{ ...raw, added_on: 101 }], [raw, raw]]) {
    let deleted = false;
    const client = new QBittorrent(config, { fetchFn: async (url) => {
      if (url.includes('torrents/info')) return reply(data);
      deleted = true; return reply('');
    } });
    await assert.rejects(client.deleteTask(hash, expected));
    assert.equal(deleted, false);
  }
});

test('a delete with uncertain transport/body or rejected authentication is never retried', async () => {
  for (const outcome of ['network', 'body', 'auth']) {
    let deletes = 0, logins = 0;
    const handle = manager(async url => {
      if (url.endsWith('auth/login')) { logins++; return reply('Ok.'); }
      if (url.includes('torrents/info')) return reply([raw]);
      deletes++;
      if (outcome === 'network') throw new Error('private-server-error');
      if (outcome === 'body') return reply('<html>login</html>');
      return new Response('forbidden', { status: 403 });
    });
    await handle({ type: 'downloaders.tasks', downloaderId: 'nas', revision: 'r1' });
    await assert.rejects(handle(message), error => {
      assert.equal(error.code, outcome === 'auth' ? 'QBT_AUTH' : 'QBT_UNCERTAIN');
      if (outcome !== 'auth') assert.match(error.message, /删除/);
      assert.equal(error.message.includes('private'), false); return true;
    });
    assert.equal(deletes, 1); assert.equal(logins, 2);
  }
});

test('simultaneous duplicate deletions are rejected while the first is pending', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let deletes = 0;
  const handle = manager(async url => {
    if (url.endsWith('auth/login')) return reply('Ok.');
    if (url.includes('torrents/info')) { await blocked; return reply([raw]); }
    deletes++; return reply('');
  });
  const first = handle(message);
  await assert.rejects(handle({ ...message, hash: hash.toUpperCase() }), { code: 'QBT_BUSY' });
  release(); await first;
  assert.equal(deletes, 1);
});
