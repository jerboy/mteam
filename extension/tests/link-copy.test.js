import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { createLinkCopy } from '../link-copy.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const url = 'https://api.m-team.cc/download/test-link';
function fixture(page, writeText) {
  const { document, Event } = parseHTML(readFileSync(new URL(`../${page}.html`, import.meta.url), 'utf8'));
  const get = id => document.getElementById(id);
  const dialog = get('link-dialog'), calls = [], notices = [];
  let selections = 0;
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new Event('close')); };
  get('download-link').select = () => selections++;
  const links = createLinkCopy({ document, writeText, notify: (...args) => notices.push(args), request: async (type, payload) => {
    calls.push({ type, ...payload }); return { url };
  } });
  return { get, dialog, calls, notices, links, selections: () => selections };
}

test('search and detail pages generate a private link only on an explicit copy action', async () => {
  for (const page of ['popup', 'detail']) {
    const written = [], h = fixture(page, async text => written.push(text));
    assert.deepEqual(h.calls, []);
    await h.links.copy({ id: '123' });
    assert.deepEqual(h.calls, [{ type: 'link', id: '123' }]);
    assert.deepEqual(written, [url]);
    assert.deepEqual(h.notices, [['下载链接已复制']]);
    assert.equal(h.dialog.open, false);
  }
});

test('clipboard rejection offers manual copy and closing erases the private URL', async () => {
  const h = fixture('detail', async () => { throw new Error('Clipboard denied'); });
  await h.links.copy({ id: '123' });
  assert.equal(h.dialog.open, true);
  assert.equal(h.get('download-link').value, url);
  assert.equal(h.selections(), 1);
  h.get('copy-again').click(); await tick();
  assert.equal(h.calls.length, 1);
  assert.equal(h.selections(), 2);
  assert.equal(h.notices[0][1], true);
  h.get('close-link').click();
  assert.equal(h.dialog.open, false);
  assert.equal(h.get('download-link').value, '');
});

test('a late clipboard result after closing the fallback does not reopen it or announce another action', async () => {
  let finish, writes = 0;
  const h = fixture('detail', async () => {
    if (++writes === 1) throw new Error('Clipboard denied');
    return new Promise(resolve => { finish = resolve; });
  });
  await h.links.copy({ id: '123' });
  h.get('copy-again').click(); h.get('copy-again').click();
  assert.equal(writes, 2);
  h.dialog.close(); finish(); await tick();
  assert.equal(h.get('download-link').value, '');
  assert.equal(h.dialog.open, false);
  assert.deepEqual(h.notices, []);
});
