import test from 'node:test';
import assert from 'node:assert/strict';
import { QBittorrent, downloaderUrl, downloaderPermission, validateDownloader, publicDownloader, downloadPath, resolveLocation, passwordHeaderRule } from '../lib/qbittorrent.js';
import { createDownloaders } from '../lib/downloaders.js';
import { safeError } from '../lib/core.js';
import { createService } from '../lib/service.js';

const passwordConfig = { id: 'nas', revision: 'r1', name: 'NAS', url: 'http://192.168.1.2:8080', auth: 'password', username: 'admin', password: 'private-password' };
const keyConfig = { id: 'remote', revision: 'r2', name: 'Remote', url: 'https://seed.example/qbt', auth: 'apikey', username: '', apiKey: 'qbt_private-test-key' };
const tokenUrl = 'https://api.m-team.cc/api/rss/dl?token=private-mteam-token';
const metadata = { defaultPath: '/downloads', categories: [{ name: '电影', path: 'movies' }] };
const reply = (text, status = 200) => new Response(text, { status });
const json = data => reply(JSON.stringify(data));
function memory(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) { return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]]))); },
    async set(values) { Object.assign(data, structuredClone(values)); }
  };
}
function server(calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('auth/login')) return reply('Ok.');
    if (url.endsWith('app/defaultSavePath')) return reply('/downloads');
    if (url.endsWith('torrents/categories')) return json({ '电影': { name: '电影', savePath: 'movies' } });
    if (url.endsWith('torrents/add')) return reply('Ok.');
    assert.fail('Unexpected endpoint');
  };
}
function manager(storage, options = {}) {
  return createDownloaders({ storage, makeLink: async () => tokenUrl, qbtOptions: { fetchFn: server() }, ...options });
}

test('downloader URL preserves ports, IPv6 and reverse-proxy prefixes and rejects embedded credentials', () => {
  assert.equal(downloaderUrl(' https://seed.example/qbt/ '), keyConfig.url);
  assert.equal(downloaderPermission('http://[::1]:8080/'), 'http://[::1]:8080/*');
  for (const url of ['file:///tmp/a', 'https://user:secret@host/', 'https://host/?apiKey=secret', 'https://host/#key', 'http://host\\path', 'https://host/\npath']) {
    assert.throws(() => downloaderUrl(url), { code: 'QBT_CONFIG' });
  }
});

test('blank secret is retained only for the same endpoint, authentication and username', () => {
  assert.equal(validateDownloader({ ...passwordConfig, password: '' }, passwordConfig).password, passwordConfig.password);
  assert.equal(validateDownloader({ ...keyConfig, apiKey: '' }, keyConfig).apiKey, keyConfig.apiKey);
  for (const changes of [{ url: 'http://other:8080' }, { username: 'other' }, { auth: 'apikey' }]) {
    assert.throws(() => validateDownloader({ ...passwordConfig, password: '', ...changes }, passwordConfig), { code: 'QBT_CONFIG' });
  }
  assert.throws(() => validateDownloader({ ...keyConfig, apiKey: 'secret\r\nHeader: leak' }), { code: 'QBT_CONFIG' });
  const changedAuth = validateDownloader({ ...passwordConfig, auth: 'apikey', apiKey: 'new-key' });
  assert.equal(changedAuth.password, undefined); assert.equal(changedAuth.username, '');
  const publicConfig = publicDownloader(passwordConfig);
  assert.equal(publicConfig.hasSecret, true); assert.equal(publicConfig.password, undefined);
});

test('password authentication logs in with a form and sends cookie credentials; API keys never log in or send cookies', async () => {
  const calls = [];
  const password = new QBittorrent(passwordConfig, { fetchFn: server(calls) });
  await password.login(); await password.locations();
  assert.equal(calls[0].url, `${passwordConfig.url}/api/v2/auth/login`);
  assert.deepEqual(Object.fromEntries(calls[0].options.body), { username: 'admin', password: passwordConfig.password });
  assert.equal(calls[0].options.credentials, 'include');
  const keyCalls = [];
  const key = new QBittorrent(keyConfig, { fetchFn: server(keyCalls) });
  await key.login(); await key.locations();
  assert.equal(keyCalls.length, 2);
  for (const call of keyCalls) {
    assert.ok(call.url.startsWith(`${keyConfig.url}/api/v2/`));
    assert.equal(call.options.headers.Authorization, `Bearer ${keyConfig.apiKey}`);
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.redirect, 'manual');
    assert.equal(call.options.cache, 'no-store');
  }
});

test('password request header rule matches only known endpoints of the chosen URL and extension', () => {
  const rule = passwordHeaderRule(keyConfig, 'extension-id');
  const pattern = new RegExp(rule.condition.regexFilter);
  assert.deepEqual(rule.condition.initiatorDomains, ['extension-id']);
  assert.ok(pattern.test(`${keyConfig.url}/api/v2/torrents/add`));
  assert.ok(pattern.test(`${keyConfig.url}/api/v2/app/getDirectoryContent?dirPath=%2Fdata%2F&mode=dirs`));
  assert.equal(pattern.test(`${keyConfig.url}/api/v2/app/getDirectoryContent?dirPath=%2Fdata%2F&mode=all`), false);
  for (const url of ['https://seedXexample/qbt/api/v2/torrents/add', `${keyConfig.url}/api/v2/app/shutdown`, `${keyConfig.url}/api/v2/torrents/add?secret=x`, 'https://other.example/api/v2/auth/login']) assert.equal(pattern.test(url), false);
  assert.equal(rule.action.requestHeaders.find(item => item.header === 'Origin').value, 'https://seed.example');
});

test('missing host permission blocks the request before credentials leave the extension', async () => {
  let called = false, origin;
  const client = new QBittorrent(keyConfig, { canAccess: async pattern => { origin = pattern; return false; }, fetchFn: async () => { called = true; } });
  await assert.rejects(client.locations(), { code: 'QBT_PERMISSION' });
  assert.equal(origin, 'https://seed.example/*'); assert.equal(called, false);
});

test('login failure, auth rejection and redirects produce safe errors with no remote body reflection', async () => {
  const password = new QBittorrent(passwordConfig, { fetchFn: async () => reply('Fails.') });
  await assert.rejects(password.login(), { code: 'QBT_AUTH' });
  for (const [response, code] of [[reply(passwordConfig.password, 403), 'QBT_AUTH'], [reply('redirect', 302), 'QBT_REDIRECT'],
    [{ type: 'opaqueredirect', status: 0 }, 'QBT_REDIRECT']]) {
    const client = new QBittorrent(keyConfig, { fetchFn: async () => response });
    await assert.rejects(client.request('app/defaultSavePath'), error => {
      assert.equal(error.code, code);
      assert.equal(JSON.stringify(safeError(error)).includes(passwordConfig.password), false);
      return true;
    });
  }
});

test('network failure during add is uncertain and never automatically retried', async () => {
  let calls = 0;
  const client = new QBittorrent(keyConfig, { fetchFn: async () => { calls++; throw new Error(tokenUrl); } });
  await assert.rejects(client.add(tokenUrl, {}), error => {
    assert.equal(error.code, 'QBT_UNCERTAIN');
    assert.equal(error.message.includes(tokenUrl), false); return true;
  });
  assert.equal(calls, 1);
});

test('request timeout covers reading the response body and reports uncertain submission', async () => {
  const client = new QBittorrent(keyConfig, { timeout: 5, fetchFn: async (_url, options) => ({
    ok: true, status: 200,
    text: () => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))))
  }) });
  await assert.rejects(client.add(tokenUrl, {}), { code: 'QBT_UNCERTAIN' });
});

test('default, category, Windows, UNC and custom paths resolve correctly without guessing category paths', () => {
  assert.equal(downloadPath(' C:\\Downloads\\Movies '), 'C:\\Downloads\\Movies');
  assert.equal(downloadPath('\\\\NAS\\media\\films'), '\\\\NAS\\media\\films');
  for (const path of ['', 'relative/folder', '~user/Downloads', '/downloads\nanother']) assert.throws(() => downloadPath(path), { code: 'QBT_PATH' });
  assert.deepEqual(resolveLocation({ kind: 'default' }, metadata).fields, { savepath: '/downloads', autoTMM: 'false' });
  assert.deepEqual(resolveLocation({ kind: 'category', name: '电影' }, metadata).fields, { category: '电影', autoTMM: 'true' });
  assert.deepEqual(resolveLocation({ kind: 'path', path: '/mnt/a' }, metadata).fields, { savepath: '/mnt/a', autoTMM: 'false' });
  assert.throws(() => resolveLocation({ kind: 'category', name: 'removed' }, metadata), { code: 'QBT_PATH' });
});

test('add submits one multipart M-Team URL and rejects unexpected successes or external URLs', async () => {
  const calls = [];
  const client = new QBittorrent(keyConfig, { fetchFn: server(calls) });
  await client.add(tokenUrl, { savepath: '/downloads/电影', autoTMM: 'false' });
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(Object.fromEntries(calls[0].options.body), { urls: tokenUrl, savepath: '/downloads/电影', autoTMM: 'false', stopped: 'false', paused: 'false' });
  await assert.rejects(client.add('https://other.example/private', {}), { code: 'BAD_URL' });
  assert.equal(calls.length, 1);
  for (const [text, code] of [['<html>Login</html>', 'QBT_UNCERTAIN'], ['Fails.', 'QBT_ADD']]) {
    await assert.rejects(new QBittorrent(keyConfig, { fetchFn: async () => reply(text) }).add(tokenUrl, {}), { code });
  }
});

test('multiple downloaders can be edited and removed without exposing secrets or losing other instances', async () => {
  const storage = memory();
  const handle = manager(storage);
  const results = await Promise.all([passwordConfig, keyConfig].map(({ id, ...downloader }) => handle({ type: 'downloaders.save', downloader })));
  const list = await handle({ type: 'downloaders.list' });
  assert.equal(list.items.length, 2);
  assert.equal(JSON.stringify(list).includes(passwordConfig.password), false);
  assert.equal(JSON.stringify(list).includes(keyConfig.apiKey), false);
  assert.equal(JSON.stringify(results).includes(keyConfig.apiKey), false);
  const edited = await handle({ type: 'downloaders.save', downloader: { ...results[0], name: 'Renamed' } });
  assert.equal(storage.data.downloaders[0].password, passwordConfig.password);
  await assert.rejects(handle({ type: 'downloaders.save', downloader: { ...results[0], name: 'Stale' } }), { code: 'QBT_CHANGED' });
  await handle({ type: 'downloaders.remove', downloaderId: edited.id, revision: edited.revision });
  assert.equal((await handle({ type: 'downloaders.list' })).items[0].name, 'Remote');
});

test('changing downloader URL clears remembered paths and requires a fresh credential', async () => {
  const storage = memory({ downloaders: [passwordConfig], downloaderPrefs: { lastId: 'nas', locations: { nas: { last: { kind: 'path', path: '/old' }, paths: ['/old'] } } } });
  const handle = manager(storage);
  await assert.rejects(handle({ type: 'downloaders.save', downloader: { ...publicDownloader(passwordConfig), url: 'http://other:8080' } }), { code: 'QBT_CONFIG' });
  await handle({ type: 'downloaders.save', downloader: { ...passwordConfig, url: 'http://other:8080' } });
  assert.equal(storage.data.downloaderPrefs.locations.nas, undefined);
});

test('submission validates target and category before minting a private M-Team link', async () => {
  const storage = memory({ downloaders: [keyConfig] });
  let links = 0;
  const handle = manager(storage, { makeLink: async () => { links++; return tokenUrl; } });
  for (const message of [
    { downloaderId: 'missing', location: { kind: 'default' } },
    { downloaderId: keyConfig.id, revision: 'old', location: { kind: 'default' } },
    { downloaderId: keyConfig.id, location: { kind: 'category', name: 'removed' } }
  ]) await assert.rejects(handle({ type: 'downloaders.send', id: '123', ...message }));
  assert.equal(links, 0);
});

test('submission uses the selected downloader and only remembers successful paths per instance', async () => {
  const storage = memory({ downloaders: [passwordConfig, keyConfig] });
  const calls = [];
  let cleaned = 0;
  const handle = manager(storage, { qbtOptions: { fetchFn: server(calls) }, cleanup: async () => { cleaned++; } });
  const result = await handle({ type: 'downloaders.send', downloaderId: keyConfig.id, id: '9007199254740993', location: { kind: 'path', path: '/mnt/films' } });
  assert.deepEqual(result, { submitted: true, name: 'Remote' });
  assert.ok(calls.every(call => call.url.startsWith(keyConfig.url)));
  assert.equal(storage.data.downloaderPrefs.lastId, keyConfig.id);
  assert.deepEqual(storage.data.downloaderPrefs.locations.remote, { last: { kind: 'path', path: '/mnt/films' }, paths: ['/mnt/films'] });
  assert.equal(storage.data.downloaderPrefs.locations.nas, undefined); assert.equal(cleaned, 1);
  const locations = await handle({ type: 'downloaders.locations', downloaderId: keyConfig.id });
  assert.equal(locations.last.path, '/mnt/films');
});

test('removed categories fall back to the default, and removal cleans only the selected instance preferences', async () => {
  const storage = memory({ downloaders: [keyConfig, passwordConfig], downloaderPrefs: { lastId: 'remote', locations: {
    remote: { last: { kind: 'category', name: 'removed' }, paths: ['/remote'] }, nas: { paths: ['/nas'] }
  } } });
  const handle = manager(storage);
  const locations = await handle({ type: 'downloaders.locations', downloaderId: 'remote' });
  assert.deepEqual(locations.last, { kind: 'default' });
  await handle({ type: 'downloaders.remove', downloaderId: 'remote' });
  assert.equal(storage.data.downloaderPrefs.lastId, undefined);
  assert.deepEqual(storage.data.downloaderPrefs.locations, { nas: { paths: ['/nas'] } });
});

test('simultaneous submission of the same resource is blocked and password header rules are always cleaned up', async () => {
  const storage = memory({ downloaders: [passwordConfig] });
  let release, prepared = 0, cleaned = 0, links = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const handle = manager(storage, { makeLink: async () => { links++; await gate; return tokenUrl; },
    prepare: async () => { prepared++; }, cleanup: async () => { cleaned++; } });
  const message = { type: 'downloaders.send', downloaderId: 'nas', id: '123', location: { kind: 'default' } };
  const first = handle(message);
  await assert.rejects(handle(message), { code: 'QBT_BUSY' });
  release(); await first;
  assert.equal(links, 1); assert.equal(prepared, 1); assert.equal(cleaned, 1);
  const failed = manager(storage, { qbtOptions: { fetchFn: async () => reply('Fails.') }, cleanup: async () => { cleaned++; } });
  await assert.rejects(failed({ type: 'downloaders.locations', downloaderId: 'nas' }), { code: 'QBT_AUTH' });
  assert.equal(cleaned, 2);
});

test('failed submissions do not remember directories; local persistence failures do not hide accepted submissions', async () => {
  const storage = memory({ downloaders: [keyConfig] });
  const message = { type: 'downloaders.send', downloaderId: 'remote', id: '123', location: { kind: 'path', path: '/new' } };
  const handle = manager(storage, { qbtOptions: { fetchFn: async (url, options) => url.endsWith('/add') ? reply('Fails.') : server()(url, options) } });
  await assert.rejects(handle(message), { code: 'QBT_ADD' });
  assert.equal(storage.data.downloaderPrefs, undefined);
  storage.set = async () => { throw new Error('storage full'); };
  assert.equal((await manager(storage)(message)).submitted, true);
});

test('service mints the M-Team link only on submission and keeps the two services credentials separate', async () => {
  const storage = memory({ config: { apiKey: 'private-mteam-api-key' }, downloaders: [keyConfig] });
  const calls = [];
  let minted = 0;
  const handle = createService({ storage, qbtOptions: { fetchFn: server(calls) },
    apiOptions: { minInterval: 0, fetchFn: async (url, options) => {
      assert.ok(url.endsWith('/torrent/genDlToken'));
      assert.equal(options.headers['x-api-key'], 'private-mteam-api-key');
      assert.equal(options.headers.Authorization, undefined);
      minted++; return json({ code: 0, data: tokenUrl });
    } } });
  await handle({ type: 'downloaders.locations', downloaderId: 'remote' });
  assert.equal(minted, 0);
  await handle({ type: 'downloaders.send', downloaderId: 'remote', id: '123', location: { kind: 'default' } });
  assert.equal(minted, 1);
  for (const { options } of calls) {
    assert.equal(options.headers['x-api-key'], undefined);
    assert.equal(options.headers.Authorization, `Bearer ${keyConfig.apiKey}`);
  }
});

test('directory autocomplete uses the read-only folders API with encoded paths and discards invalid responses', async () => {
  let call;
  const client = new QBittorrent(keyConfig, { fetchFn: async (url, options) => {
    call = { url, options };
    return json(['/data/电影 & TV/Movies', '/data/电影 & TV/Movies', 'relative', '/bad\npath', 4, { name: 'file' }]);
  } });
  assert.deepEqual(await client.directories('/data/电影 & TV/'), ['/data/电影 & TV/Movies']);
  const url = new URL(call.url);
  assert.equal(url.pathname, '/qbt/api/v2/app/getDirectoryContent');
  assert.equal(url.searchParams.get('dirPath'), '/data/电影 & TV/');
  assert.equal(url.searchParams.get('mode'), 'dirs');
  assert.equal(call.options.method, 'GET');
  assert.equal(call.options.credentials, 'omit');
  assert.equal(call.options.headers.Authorization, `Bearer ${keyConfig.apiKey}`);
  const missing = new QBittorrent(keyConfig, { fetchFn: async () => reply('Missing', 404) });
  assert.deepEqual(await missing.directories('/new-folder/'), []);
  await assert.rejects(client.directories('relative'), { code: 'QBT_PATH' });
});

test('directory lookup reuses a password session, renews it once on expiry, and rejects stale configuration before requests', async () => {
  const storage = memory({ downloaders: [passwordConfig] });
  let logins = 0, directories = 0, expire = false;
  const handle = manager(storage, { qbtOptions: { fetchFn: async (url, options) => {
    if (url.endsWith('/auth/login')) { logins++; return reply('Ok.'); }
    if (url.includes('/getDirectoryContent?')) {
      directories++;
      if (expire) { expire = false; return reply('Forbidden', 403); }
      return json(['/data/Movies']);
    }
    return server()(url, options);
  } } });
  await handle({ type: 'downloaders.locations', downloaderId: 'nas' });
  const message = { type: 'downloaders.directories', downloaderId: 'nas', revision: 'r1', directory: '/data/' };
  assert.deepEqual(await handle(message), ['/data/Movies']);
  assert.equal(logins, 1);
  expire = true; await handle(message);
  assert.equal(logins, 2); assert.equal(directories, 3);
  await assert.rejects(handle({ ...message, revision: 'old' }), { code: 'QBT_CHANGED' });
  await assert.rejects(handle({ ...message, directory: 'relative' }), { code: 'QBT_PATH' });
  assert.equal(directories, 3);
});
