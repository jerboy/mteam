import test from 'node:test';
import assert from 'node:assert/strict';
import { MTeamApi, AppError, mteamUrl, searchPayload, safeFilename, normalizeTorrent, posterUrl } from '../lib/core.js';
import { createService } from '../lib/service.js';
import { promotion, parseDate } from '../lib/ui.js';

const config = { apiKey: 'test-secret-do-not-output', apiOrigin: 'https://api.m-team.cc' };
const torrent = { id: '123', name: 'Example Film', smallDescr: '测试简介', size: '1073741824', category: '401', status: { seeders: '12', leechers: '2', timesCompleted: '90', discount: 'FREE' } };
const json = (data, code = 0) => new Response(JSON.stringify({ code, data }), { headers: { 'content-type': 'application/json' } });
function fakeStorage(initial = {}) {
  const memory = structuredClone(initial);
  return {
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, memory[key]])); },
    async set(values) { Object.assign(memory, structuredClone(values)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete memory[key]; }
  };
}

test('search sends official JSON filters, normalizes results and handles string success codes', async () => {
  let called;
  const api = new MTeamApi(config, { minInterval: 0, fetchFn: async (url, options) => { called = { url, options }; return json({ data: [torrent], total: '21' }, '0'); } });
  const result = await api.search({ keyword: ' Film ', category: '401', mode: 'movie', discount: 'FREE', sortField: 'SEEDERS', sortDirection: 'ASC', pageNumber: 2, onlyFav: true });
  assert.equal(called.url, 'https://api.m-team.cc/api/torrent/search');
  assert.equal(called.options.headers['x-api-key'], config.apiKey);
  assert.equal(called.options.credentials, 'omit'); assert.equal(called.options.redirect, 'manual');
  assert.deepEqual(JSON.parse(called.options.body), { keyword: 'Film', categories: [401], mode: 'movie', discount: 'FREE', sortField: 'SEEDERS', sortDirection: 'ASC', pageNumber: 2, pageSize: 20, onlyFav: true });
  assert.equal(result.total, 21); assert.equal(result.items[0].seeders, 12); assert.equal(result.items[0].subtitle, '测试简介');
});

test('detail and download-token requests use form parameters, preserving large string IDs', async () => {
  const calls = [];
  const api = new MTeamApi(config, { minInterval: 0, fetchFn: async (url, options) => { calls.push({ url, options }); return json(url.endsWith('genDlToken') ? 'https://api.m-team.cc/api/rss/dl?token=private' : torrent); } });
  await api.detail('9007199254740993');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[0].options.body)), { id: '9007199254740993', origin: 'WEB' });
  assert.match(calls[0].options.headers['Content-Type'], /urlencoded/);
  assert.equal(await api.link('123'), 'https://api.m-team.cc/api/rss/dl?token=private');
  assert.equal(new URLSearchParams(calls[1].options.body).get('id'), '123');
});

test('caches repeated searches and categories but never caches private download tokens', async () => {
  const counts = {};
  const api = new MTeamApi(config, { minInterval: 0, fetchFn: async url => {
    const name = url.split('/').at(-1); counts[name] = (counts[name] || 0) + 1;
    if (name === 'search') return json({ data: [torrent], total: 1 });
    if (name === 'categoryList') return json([{ id: 401, name: '电影' }]);
    return json(`https://api.m-team.cc/dl?token=${counts[name]}`);
  } });
  await Promise.all([api.search({}), api.search({})]); await api.search({});
  await api.categories(); await api.categories(); await api.link(123); await api.link(123);
  assert.deepEqual(counts, { search: 1, categoryList: 1, genDlToken: 2 });
});

test('request queue spaces independent calls and recovers after a failed request', async () => {
  let now = 1000; const starts = []; let count = 0;
  const api = new MTeamApi(config, { minInterval: 1600, now: () => now, sleep: async ms => { now += ms; }, fetchFn: async () => {
    starts.push(now); count++; if (count === 1) throw new Error('network'); return json([{ id: 401, name: '电影' }]);
  } });
  await assert.rejects(api.categories(), { code: 'NETWORK' });
  await api.categories(); assert.deepEqual(starts, [1000, 2600]);
});

test('explicit refresh bypasses search cache while concurrent refreshes share one request', async () => {
  let calls = 0;
  const service = createService({ storage: fakeStorage({ config }), apiOptions: { minInterval: 0, fetchFn: async () => json({ data: [{ ...torrent, name: `result-${++calls}` }], total: 1 }) } });
  const search = fresh => service({ type: 'search', query: {}, fresh });
  assert.equal((await search(false)).items[0].name, 'result-1');
  await search(false); assert.equal(calls, 1);
  const [a, b] = await Promise.all([search(true), search(true)]);
  assert.equal(a.items[0].name, 'result-2'); assert.deepEqual(a, b); assert.equal(calls, 2);
});

test('profile returns only the browse timestamp and never sends browser cookies', async () => {
  let called;
  const api = new MTeamApi(config, { minInterval: 0, fetchFn: async (url, options) => {
    called = { url, options };
    return json({ username: 'private', ip: 'private', passkey: 'private', memberStatus: { lastBrowse: '2026-10-20 12:00:00', secret: 'private' } });
  } });
  assert.deepEqual(await api.profile(), { lastWebBrowse: '2026-10-20 12:00:00' });
  assert.equal(called.url, 'https://api.m-team.cc/api/member/profile');
  assert.equal(called.options.credentials, 'omit'); assert.equal(called.options.redirect, 'manual');
});

test('retry-after HTTP dates expose remaining cooldown and block fresh searches', async () => {
  let now = Date.parse('2026-10-20T00:00:00Z'), calls = 0;
  const api = new MTeamApi(config, { minInterval: 0, now: () => now, fetchFn: async () => {
    calls++; return new Response('', { status: 429, headers: { 'retry-after': 'Tue, 20 Oct 2026 02:00:00 GMT' } });
  } });
  await assert.rejects(api.categories(), { code: 'RATE_LIMIT', retryAfterSeconds: 7200 });
  now += 30000;
  await assert.rejects(api.search({}, { fresh: true }), { code: 'RATE_LIMIT', retryAfterSeconds: 7170 });
  assert.equal(calls, 1);
});

test('rejects auth failures, malformed envelopes, HTML and times out stalled fetches', async () => {
  for (const response of [new Response('', { status: 401 }), json({}, 403), new Response('{}'), new Response('<html>challenge</html>')]) {
    const api = new MTeamApi(config, { minInterval: 0, fetchFn: async () => response });
    await assert.rejects(api.categories(), error => error instanceof AppError && !error.message.includes(config.apiKey));
  }
  const api = new MTeamApi(config, { minInterval: 0, timeout: 10, fetchFn: async (_url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('abort')))) });
  await assert.rejects(api.categories(), { code: 'TIMEOUT' });
});

test('honors rate-limit cooldown without automatic retries', async () => {
  let calls = 0;
  const api = new MTeamApi(config, { minInterval: 0, fetchFn: async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '300' } }); } });
  await assert.rejects(api.categories(), { code: 'RATE_LIMIT' });
  await assert.rejects(api.search({}), { code: 'RATE_LIMIT' });
  assert.equal(calls, 1);
});

test('validates filters, IDs, domains and returned private links before network/download use', async () => {
  for (const value of ['https://m-team.cc.evil.example/dl', 'https://evil-m-team.cc/dl', 'https://user:pw@api.m-team.cc/dl', 'http://api.m-team.cc/dl', 'javascript:alert(1)', 'https://api.m-team.cc:444/dl']) assert.throws(() => mteamUrl(value));
  assert.equal(mteamUrl('https://dl.m-team.io/a').hostname, 'dl.m-team.io');
  for (const query of [{ keyword: 'x'.repeat(101) }, { pageNumber: 0 }, { pageNumber: 1001 }, { mode: 'unknown' }, { category: 'abc' }, { sortField: 'invalid' }]) assert.throws(() => searchPayload(query));
  let calls = 0;
  const api = new MTeamApi({ apiKey: '' }, { fetchFn: () => { calls++; } });
  await assert.rejects(api.search({}), { code: 'NO_KEY' }); assert.equal(calls, 0);
});

test('service stores keys locally, never returns keys, changes revision and clears config', async () => {
  const storage = fakeStorage();
  const service = createService({ storage });
  assert.equal((await service({ type: 'config.status' })).configured, false);
  assert.deepEqual(await service({ type: 'config.save', config }), { saved: true });
  const first = await service({ type: 'config.status' });
  assert.equal(first.configured, true); assert.ok(first.revision); assert.equal(JSON.stringify(first).includes(config.apiKey), false);
  await service({ type: 'config.save', config }); assert.notEqual((await service({ type: 'config.status' })).revision, first.revision);
  await service({ type: 'config.clear' }); assert.equal((await service({ type: 'config.status' })).configured, false);
});

test('changing accounts invalidates cached API results', async () => {
  const keys = []; const storage = fakeStorage({ config });
  const service = createService({ storage, apiOptions: { minInterval: 0, fetchFn: async (_url, options) => { keys.push(options.headers['x-api-key']); return json({ data: [torrent], total: 1 }); } } });
  await service({ type: 'search', query: {} }); await service({ type: 'search', query: {} });
  await service({ type: 'config.save', config: { ...config, apiKey: 'second-account' } });
  await service({ type: 'search', query: {} });
  assert.deepEqual(keys, [config.apiKey, 'second-account']);
});

test('download uses a safe filename without forwarding the API key, blocks foreign token URLs', async () => {
  let called; let link = 'https://api.m-team.cc/api/rss/dl?token=private';
  const service = createService({ storage: fakeStorage({ config }), downloads: { async download(options) { called = options; return 7; } }, apiOptions: { minInterval: 0, fetchFn: async () => json(link) } });
  assert.deepEqual(await service({ type: 'download', id: 123, name: '../../Film:2026' }), { downloadId: 7 });
  assert.equal(called.url, link); assert.equal(called.saveAs, true); assert.ok(called.filename.endsWith('-123.torrent'));
  assert.equal(called.filename.includes('/'), false); assert.equal(JSON.stringify(called).includes(config.apiKey), false);
  called = undefined; link = 'https://evil.example/download';
  await assert.rejects(service({ type: 'download', id: 123 }), { code: 'BAD_URL' }); assert.equal(called, undefined);
});

test('dates use the M-Team timezone and expired discounts are never labelled free', () => {
  assert.equal(parseDate('2026-10-20 10:00:00').toISOString(), '2026-10-20T02:00:00.000Z');
  assert.equal(promotion({ discount: 'FREE', discountEndTime: '2000-01-01 00:00:00' }), '');
  assert.equal(promotion({ discount: 'FREE', discountEndTime: 'invalid' }), '');
  assert.equal(promotion({ discount: '_2X_FREE', discountEndTime: '2099-01-01 00:00:00' }), '2× FREE');
});

test('safe filenames reject path traversal and invalid IDs', () => {
  assert.ok(!/[\\/<>:"|?*]/.test(safeFilename('../bad/name?.', '123')));
  assert.throws(() => safeFilename('name', '../x'));
});

test('default transport keeps the native fetch receiver required by Chrome', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = function () {
    assert.equal(this, globalThis, 'native fetch must receive the browser global');
    calls++;
    return Promise.resolve(json([{ id: 401, name: '电影' }]));
  };
  try {
    const api = new MTeamApi(config, { minInterval: 0 });
    assert.deepEqual(await api.categories(), [{ id: '401', name: '电影', mode: '' }]);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('missing host permission is reported before an authenticated request is sent', async () => {
  let calls = 0;
  const api = new MTeamApi(config, { canAccess: async origin => { assert.equal(origin, config.apiOrigin); return false; }, fetchFn: async () => { calls++; } });
  await assert.rejects(api.categories(), { code: 'PERMISSION' });
  assert.equal(calls, 0);
});

test('redirect responses are distinguished from network errors and never followed', async () => {
  for (const response of [{ type: 'opaqueredirect', status: 0 }, new Response('', { status: 302, headers: { location: 'https://example.com/' } })]) {
    let calls = 0;
    const api = new MTeamApi(config, { fetchFn: async (_url, options) => {
      calls++; assert.equal(options.redirect, 'manual'); return response;
    } });
    await assert.rejects(api.categories(), { code: 'REDIRECT' }); assert.equal(calls, 1);
  }
});

test('invalid key characters are rejected instead of surfacing as fetch errors', () => {
  for (const apiKey of ['令牌', 'key with spaces', 'key\u200bvalue']) assert.throws(() => new MTeamApi({ ...config, apiKey }), { code: 'CONFIG' });
});

test('search results retain the first valid poster from the official imageList field', async () => {
  const images = ['https://images.example.org/poster.jpg', 'https://images.example.org/screenshot.jpg'];
  const api = new MTeamApi(config, { minInterval: 0, fetchFn: async () => json({ data: [{ ...torrent, imageList: images }], total: 1 }) });
  const result = await api.search({});
  assert.equal(result.items[0].posterUrl, images[0]);
  assert.equal(normalizeTorrent(torrent).posterUrl, '');
});

test('missing and unsafe poster values fall back without affecting resource results', () => {
  for (const images of [undefined, null, [], 'https://example.org/poster.jpg', ['javascript:alert(1)', 'data:image/svg+xml,test', 'http://example.org/a', 'https://user:secret@example.org/a', null, {}]]) assert.equal(posterUrl(images), '');
  assert.equal(posterUrl(['invalid', '  https://example.org/cover.jpg  ']), 'https://example.org/cover.jpg');
});
