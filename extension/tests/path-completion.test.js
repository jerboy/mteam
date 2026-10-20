import test from 'node:test';
import assert from 'node:assert/strict';
import { directoryQuery, directoryValue, pathSuggestions, PathCompletion } from '../lib/path-completion.js';

const metadata = { downloaderId: 'nas', revision: 'r1', defaultPath: '/data', recentPaths: ['/data/Movies', '/data/电影'],
  categories: [{ path: '/data/Music' }, { path: 'relative' }] };
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
function harness(fetchDirectories) {
  let timer, readTimer, time = 0;
  const updates = [], states = [];
  const completion = new PathCompletion({ fetchDirectories, onSuggestions: (paths, state) => { updates.push(paths); states.push(state); },
    setTimer: fn => { timer = fn; return 1; }, clearTimer: () => { timer = null; },
    setReadTimer: fn => { readTimer = fn; return 1; }, clearReadTimer: () => { readTimer = null; }, now: () => time });
  completion.setContext(metadata);
  return { completion, updates, states, flush: () => { const fn = timer; timer = null; fn?.(); },
    advance: ms => { time += ms; }, expire: () => readTimer?.() };
}

test('native browser timers keep their global receiver so directory reads are actually scheduled', async t => {
  const timers = new Map();
  let sequence = 0, calls = 0;
  t.mock.method(globalThis, 'setTimeout', function (callback, delay) {
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    const id = ++sequence; timers.set(id, { callback, delay }); return id;
  });
  t.mock.method(globalThis, 'clearTimeout', function (id) {
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    timers.delete(id);
  });
  const updates = [];
  const completion = new PathCompletion({
    fetchDirectories: async () => { calls++; return ['/remote/Movies']; },
    onSuggestions: (paths, state) => updates.push({ paths, state })
  });
  completion.setContext(metadata);
  assert.doesNotThrow(() => completion.update('/remote/'));
  assert.doesNotThrow(() => completion.update('/remote/M'));
  const [id, timer] = [...timers].find(([, timer]) => timer.delay === 250);
  timers.delete(id); timer.callback(); await tick();
  assert.equal(calls, 1);
  assert.deepEqual(updates.at(-1).paths, ['/remote/Movies/']);
  assert.equal(updates.at(-1).state.loading, false);
  completion.stop();
  assert.equal(timers.size, 0);
});

test('directory queries use the parent of an incomplete segment and support Linux, Windows, UNC and Unicode', () => {
  assert.equal(directoryQuery('/data/电'), '/data/');
  assert.equal(directoryQuery('/data/电影/'), '/data/电影/');
  assert.equal(directoryQuery('/'), '/');
  assert.equal(directoryQuery('D:\\Media\\Mov'), 'D:/Media/');
  assert.equal(directoryQuery('D:\\'), 'D:/');
  assert.equal(directoryQuery('\\\\NAS\\media\\Film'), '//NAS/media/');
  for (const path of ['', 'relative', 'D:', '\\\\NAS\\', '/data\nbad']) assert.equal(directoryQuery(path), null);
});

test('editable defaults end with a separator without breaking POSIX, Windows or UNC roots', () => {
  for (const [input, output] of [['/data', '/data/'], ['/', '/'], ['D:\\', 'D:\\'],
    ['D:\\Media\\', 'D:\\Media\\'], ['//nas/share', '//nas/share/'], ['\\\\nas\\share', '\\\\nas\\share\\']]) {
    assert.equal(directoryValue(input), output);
  }
});

test('suggestions merge real folders and known absolute paths, deduplicate and append a separator for the next level', () => {
  assert.deepEqual(pathSuggestions('/data/M', metadata, ['/data/Movies', '/data/Movies/', '/data/More']),
    ['/data/More/', '/data/Movies/', '/data/Music/']);
  assert.deepEqual(pathSuggestions('/data/电', metadata), ['/data/电影/']);
  assert.deepEqual(pathSuggestions('/data/relative', metadata), []);
  assert.deepEqual(pathSuggestions('/data/m', metadata), []); // POSIX is case sensitive.
  assert.deepEqual(pathSuggestions('d:\\media\\m', { defaultPath: 'D:/Media' }, ['D:/Media/Movies']), ['D:\\Media\\Movies\\']);
  assert.deepEqual(pathSuggestions('\\\\NAS\\media\\F', {}, ['//NAS/media/Films']), ['\\\\NAS\\media\\Films\\']);
});

test('typing is debounced and same-parent results are cached while filtering the latest input', async () => {
  const gate = deferred(), requests = [];
  const h = harness(request => { requests.push(request); return gate.promise; });
  h.completion.update('/data/M'); h.completion.update('/data/Mo'); h.flush();
  assert.equal(requests.length, 1); assert.equal(requests[0].directory, '/data/');
  h.completion.update('/data/Mov'); h.flush();
  gate.resolve(['/data/Movies', '/data/Music']);
  await tick();
  assert.deepEqual(h.updates.at(-1), ['/data/Movies/']);
  assert.equal(requests.length, 1);
  h.completion.update('/data/Mu'); h.flush();
  assert.equal(requests.length, 1);
  assert.deepEqual(h.updates.at(-1), ['/data/Music/']);
});

test('only the latest pending parent is fetched and an older response cannot replace current suggestions', async () => {
  const gates = [], requests = [];
  const h = harness(request => { requests.push(request); const gate = deferred(); gates.push(gate); return gate.promise; });
  h.completion.update('/first/'); h.flush();
  h.completion.update('/skipped/'); h.flush();
  h.completion.update('/last/'); h.flush();
  gates[0].resolve(['/first/old']);
  await tick();
  assert.deepEqual(requests.map(request => request.directory), ['/first/', '/last/']);
  assert.deepEqual(h.updates.at(-1), []);
  gates[1].resolve(['/last/new']);
  await tick();
  assert.deepEqual(h.updates.at(-1), ['/last/new/']);
});

test('a never-resolving read releases the queue on timeout and allows the latest directory to load', async () => {
  let calls = 0;
  const h = harness(() => ++calls === 1 ? new Promise(() => {}) : Promise.resolve(['/second/Movies']));
  h.completion.update('/first/'); h.flush();
  h.completion.update('/second/'); h.flush();
  assert.equal(calls, 1);
  h.expire(); await tick();
  assert.equal(calls, 2);
  assert.deepEqual(h.updates.at(-1), ['/second/Movies/']);
  assert.equal(h.states.at(-1).loading, false);
});

test('switching context immediately releases a stalled read and late failures cannot affect the new server', async () => {
  const stalled = deferred();
  const h = harness(request => request.downloaderId === 'nas' ? stalled.promise : Promise.resolve(['/data/other']));
  h.completion.update('/data/'); h.flush();
  h.completion.setContext({ ...metadata, downloaderId: 'other', recentPaths: [], categories: [] });
  h.completion.update('/data/'); h.flush(); await tick();
  assert.deepEqual(h.updates.at(-1), ['/data/other/']);
  stalled.reject(new Error('old server failed')); await tick();
  assert.deepEqual(h.updates.at(-1), ['/data/other/']);
  assert.equal(h.states.at(-1).failed, false);
});

test('switching downloaders clears history and excludes in-flight folders from the previous server', async () => {
  const gates = [], requests = [];
  const h = harness(request => { requests.push(request); const gate = deferred(); gates.push(gate); return gate.promise; });
  h.completion.update('/data/'); h.flush();
  h.completion.setContext({ downloaderId: 'other', revision: 'r2', defaultPath: '/data', categories: [], recentPaths: [] });
  h.completion.update('/data/'); h.flush();
  gates[0].resolve(['/data/private-on-nas']); await tick();
  assert.equal(requests[1].downloaderId, 'other'); assert.equal(requests[1].revision, 'r2');
  assert.deepEqual(h.updates.at(-1), []);
  gates[1].resolve(['/data/other-server']); await tick();
  assert.deepEqual(h.updates.at(-1), ['/data/other-server/']);
});

test('failed lookups retain local suggestions, back off briefly and allow another lookup after expiry', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; throw new Error('offline'); });
  h.completion.update('/data/M'); h.flush(); await tick();
  assert.deepEqual(h.updates.at(-1), ['/data/Movies/', '/data/Music/']);
  h.completion.update('/data/Mo'); h.flush();
  assert.equal(calls, 1);
  h.advance(5001); h.completion.update('/data/Mo'); h.flush(); await tick();
  assert.equal(calls, 2);
});

test('closing or leaving the field cancels pending queries and prevents late results from reopening suggestions', async () => {
  const gate = deferred(); let calls = 0;
  const h = harness(() => { calls++; return gate.promise; });
  h.completion.update('/data/'); h.completion.stop(); h.flush();
  assert.equal(calls, 0);
  h.completion.update('/data/'); h.flush(); h.completion.stop();
  gate.resolve(['/data/late']); await tick();
  assert.deepEqual(h.updates.at(-1), []);
  h.completion.setContext(null); h.completion.update('/data/'); h.flush();
  assert.equal(calls, 1);
});
