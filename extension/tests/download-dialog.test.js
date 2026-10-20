import test from 'node:test';
import assert from 'node:assert/strict';
import { createDownloadDialog } from '../download-dialog.js';
import { mockDocument } from './dom-fixture.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function harness(t, rpc) {
  const previous = { chrome: globalThis.chrome };
  const get = mockDocument(t);
  globalThis.chrome = { runtime: { sendMessage: async message => {
    try { return { ok: true, data: await rpc(message) }; }
    catch (error) { return { ok: false, error: { code: error.code, message: error.message } }; }
  } } };
  t.after(() => Object.assign(globalThis, previous));
  const toasts = [];
  return { get, dialog: createDownloadDialog(text => toasts.push(text)), toasts };
}
const items = [{ id: 'a', revision: 'r-a', name: 'NAS' }, { id: 'b', revision: 'r-b', name: 'Remote' }];
const dirs = (path, revision) => ({ defaultPath: path, revision, categories: [], recentPaths: [], last: { kind: 'default' } });

test('switching downloader discards slower directory responses and submits the visible target and revision', async t => {
  const first = deferred(), second = deferred();
  let sent;
  const { get, dialog, toasts } = harness(t, message => {
    if (message.type === 'downloaders.list') return { items, lastId: 'a' };
    if (message.type === 'downloaders.locations') return message.downloaderId === 'a' ? first.promise : second.promise;
    if (message.type === 'downloaders.send') { sent = message; return { submitted: true, name: 'Remote' }; }
    assert.fail(message.type);
  });
  const opening = dialog.open({ id: '123', name: 'Film' });
  await tick();
  get('send-downloader').value = 'b';
  const changing = get('send-downloader').emit('change');
  second.resolve(dirs('/remote', 'r-b')); await changing;
  first.resolve(dirs('/nas', 'r-a')); await opening;
  assert.equal(get('send-custom-path').value, '/remote/');
  assert.equal(get('send-custom-path').readOnly, false);
  assert.equal(get('send-submit').disabled, false);
  await get('send-form').emit('submit');
  assert.equal(sent.downloaderId, 'b'); assert.equal(sent.revision, 'r-b');
  assert.deepEqual(sent.location, { kind: 'path', path: '/remote/' });
  assert.deepEqual(toasts, ['已提交到 Remote']);
});

test('custom directory starts at the server default and an uncertain submission cannot be retried in the same dialog', async t => {
  let calls = 0, sent;
  const { get, dialog } = harness(t, message => {
    if (message.type === 'downloaders.list') return { items: [items[0]] };
    if (message.type === 'downloaders.locations') return dirs('D:\\Downloads', 'r-a');
    if (message.type === 'downloaders.send') { calls++; sent = message; throw Object.assign(new Error('结果未知'), { code: 'QBT_UNCERTAIN' }); }
    assert.fail(message.type);
  });
  await dialog.open({ id: '123', name: 'Film' });
  assert.equal(get('send-custom-path').value, 'D:\\Downloads\\');
  assert.equal(get('send-custom-path').readOnly, false);
  get('send-custom-path').value += 'Movies';
  await get('send-form').emit('submit');
  assert.equal(sent.location.path, 'D:\\Downloads\\Movies');
  assert.equal(get('send-submit').disabled, true);
  await get('send-form').emit('submit');
  assert.equal(calls, 1);
});

test('remembered categories do not replace the editable default, but can be explicitly selected', async t => {
  let sent;
  const { get, dialog } = harness(t, message => {
    if (message.type === 'downloaders.list') return { items: [items[0]] };
    if (message.type === 'downloaders.locations') return { ...dirs('/data', 'r-a'), last: { kind: 'category', name: '电影' },
      categories: [{ name: '电影', path: 'movies' }], recentPaths: ['/old/download'] };
    if (message.type === 'downloaders.send') { sent = message; return { submitted: true, name: 'NAS' }; }
    assert.fail(message.type);
  });
  await dialog.open({ id: '123', name: 'Film' });
  assert.equal(get('send-location').value, '0');
  assert.equal(get('send-custom-path').value, '/data/');
  get('send-custom-path').value = '/data/edited';
  await get('send-custom-path').emit('input');
  get('send-location').value = '1'; await get('send-location').emit('change');
  assert.equal(get('send-custom-path').readOnly, true);
  assert.equal(get('send-custom-path').value, 'movies');
  assert.equal(get('send-path-menu').hidden, true);
  get('send-location').value = '0'; await get('send-location').emit('change');
  assert.equal(get('send-custom-path').readOnly, false);
  assert.equal(get('send-custom-path').value, '/data/edited');
  get('send-location').value = '1'; await get('send-location').emit('change');
  await get('send-form').emit('submit');
  assert.equal(sent.location.kind, 'category');
  assert.equal(sent.location.name, '电影');
});

test('closing a dialog discards in-flight directory results', async t => {
  const response = deferred();
  const { get, dialog } = harness(t, message => {
    if (message.type === 'downloaders.list') return { items: [items[0]] };
    if (message.type === 'downloaders.locations') return response.promise;
    assert.fail(message.type);
  });
  const opening = dialog.open({ id: '123', name: 'Film' });
  await tick();
  await get('close-send').emit('click');
  response.resolve(dirs('/late', 'r-a')); await opening;
  assert.equal(get('send-dialog').open, false);
  assert.equal(get('send-submit').disabled, true);
});
