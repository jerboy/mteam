import test from 'node:test';
import assert from 'node:assert/strict';
import { createPathPicker } from '../path-picker.js';
import { mockDocument } from './dom-fixture.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const metadata = { downloaderId: 'nas', revision: 'r1', defaultPath: '/data', recentPaths: [], categories: [] };
function harness(t, fetchDirectories) {
  const get = mockDocument(t);
  const input = get('input'), menu = get('menu'), list = get('suggestions'), status = get('status'), feedback = get('feedback'), retry = get('retry');
  feedback.replaceChildren(status, retry); menu.replaceChildren(list, feedback);
  let timer, readTimer;
  const picker = createPathPicker({ input, menu, list, feedback, status, retry, fetchDirectories,
    timing: { setTimer: fn => { timer = fn; return 1; }, clearTimer: () => { timer = null; },
      setReadTimer: fn => { readTimer = fn; return 1; }, clearReadTimer: () => { readTimer = null; } } });
  picker.setContext(metadata);
  const flush = async () => { const fn = timer; timer = null; fn?.(); await tick(); };
  return { input, menu, list, status, feedback, retry, picker, flush, expire: () => readTimer?.() };
}

test('focus opens a real list with every matching remote directory, including more than 30 entries', async t => {
  const folders = Array.from({ length: 65 }, (_, i) => `/data/Folder${i}`);
  const h = harness(t, async () => folders);
  h.input.value = '/data/'; h.input.focus();
  assert.equal(h.menu.hidden, false);
  assert.equal(h.status.textContent, '读取中…');
  await h.flush();
  assert.equal(h.list.children.length, 65);
  assert.equal(h.feedback.hidden, true);
  assert.equal(h.input.getAttribute('aria-expanded'), 'true');
  assert.equal(h.list.children[64].textContent, '/data/Folder64/');
  h.input.value = '/data/Folder6'; await h.input.emit('input');
  assert.deepEqual(h.list.children.map(option => option.textContent),
    ['/data/Folder6/', '/data/Folder60/', '/data/Folder61/', '/data/Folder62/', '/data/Folder63/', '/data/Folder64/']);
});

test('arrows select, Tab completes the selected directory, and another Tab can enter its child', async t => {
  const queried = [];
  const h = harness(t, async ({ directory }) => {
    queried.push(directory);
    return directory === '/data/' ? ['/data/Films', '/data/Music'] : ['/data/Music/Live'];
  });
  h.input.value = '/data/'; h.input.focus(); await h.flush();
  await h.input.emit('keydown', { key: 'ArrowDown' });
  assert.equal(h.input.getAttribute('aria-activedescendant'), h.list.children[1].id);
  const accepted = await h.input.emit('keydown', { key: 'Tab' });
  assert.equal(accepted.defaultPrevented, true);
  assert.equal(h.input.value, '/data/Music/');
  assert.equal(document.activeElement, h.input);
  assert.deepEqual(h.input.selection, [12, 12]);
  await h.flush();
  assert.deepEqual(queried, ['/data/', '/data/Music/']);
  await h.input.emit('keydown', { key: 'Tab' });
  assert.equal(h.input.value, '/data/Music/Live/');
});

test('pointer selection retains focus and Enter accepts a directory instead of submitting the download', async t => {
  const h = harness(t, async () => ['/data/A', '/data/B']);
  h.input.value = '/data/'; h.input.focus(); await h.flush();
  const option = h.list.children[1];
  assert.equal((await option.emit('pointerdown')).defaultPrevented, true);
  await option.emit('click');
  assert.equal(h.input.value, '/data/B/');
  assert.equal(document.activeElement, h.input);
  h.input.value = '/data/'; await h.input.emit('input');
  const event = await h.input.emit('keydown', { key: 'Enter' });
  assert.equal(event.defaultPrevented, true);
  assert.equal(h.input.value, '/data/A/');
});

test('Escape dismisses suggestions, Shift+Tab and Tab without matches retain normal focus navigation', async t => {
  const h = harness(t, async () => ['/data/A']);
  h.input.value = '/data/'; h.input.focus(); await h.flush();
  assert.equal((await h.input.emit('keydown', { key: 'Tab', shiftKey: true })).defaultPrevented, false);
  const escape = await h.input.emit('keydown', { key: 'Escape' });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(escape.propagationStopped, true);
  assert.equal(h.menu.hidden, true);
  assert.equal(h.input.getAttribute('aria-activedescendant'), null);
  assert.equal((await h.input.emit('keydown', { key: 'Tab' })).defaultPrevented, false);
  await h.input.emit('keydown', { key: 'ArrowUp' });
  assert.equal(h.menu.hidden, false);
  h.input.value = '/data/no-match'; await h.input.emit('input');
  assert.equal(h.status.textContent, '没有匹配目录');
  assert.equal((await h.input.emit('keydown', { key: 'Tab' })).defaultPrevented, false);
});

test('IME composition and readonly category paths do not consume Tab or change the path', async t => {
  const h = harness(t, async () => ['/data/电影']);
  h.input.value = '/data/'; h.input.focus(); await h.flush();
  await h.input.emit('compositionstart');
  h.input.value = '/data/电';
  await h.input.emit('input', { isComposing: true });
  assert.equal(h.menu.hidden, true);
  assert.equal((await h.input.emit('keydown', { key: 'Tab', isComposing: true })).defaultPrevented, false);
  await h.input.emit('compositionend');
  assert.equal(h.menu.hidden, false);
  assert.equal((await h.input.emit('keydown', { key: 'Enter', keyCode: 229 })).defaultPrevented, false);
  h.input.readOnly = true;
  assert.equal((await h.input.emit('keydown', { key: 'Tab' })).defaultPrevented, false);
  assert.equal(h.input.value, '/data/电');
});

test('lookup failures are visible and do not prevent typing a manual path or leaving the field', async t => {
  const h = harness(t, async () => { throw new Error('offline'); });
  h.input.value = '/data/new'; h.input.focus(); await h.flush();
  assert.equal(h.menu.hidden, false);
  assert.equal(h.status.textContent, '暂时无法读取目录');
  assert.equal(h.input.value, '/data/new');
  assert.equal((await h.input.emit('keydown', { key: 'Tab' })).defaultPrevented, false);
  await h.input.emit('blur');
  assert.equal(h.menu.hidden, true);
});

test('a stalled RPC stops loading at its deadline and retry can load folders without changing the input', async t => {
  let calls = 0, finishOld;
  const h = harness(t, () => ++calls === 1
    ? new Promise(resolve => { finishOld = resolve; })
    : Promise.resolve(['/data/new/Movies']));
  h.input.value = '/data/new/'; h.input.focus(); await h.flush();
  assert.equal(h.status.textContent, '读取中…');
  h.expire();
  assert.equal(h.status.textContent, '读取超时');
  assert.equal(h.list.getAttribute('aria-busy'), 'false');
  assert.equal(h.retry.hidden, false);
  assert.equal(h.input.value, '/data/new/');
  await h.input.emit('blur', { relatedTarget: h.retry });
  assert.equal(h.menu.hidden, false); // Keyboard focus can reach the retry button.
  await h.retry.emit('click'); await h.flush();
  assert.equal(calls, 2);
  assert.deepEqual(h.list.children.map(option => option.textContent), ['/data/new/Movies/']);
  assert.equal(h.feedback.hidden, true);
  finishOld(['/data/new/stale']); await tick();
  assert.deepEqual(h.list.children.map(option => option.textContent), ['/data/new/Movies/']);
});

test('late responses cannot reopen a list after the downloader changes or input loses focus', async t => {
  let resolve;
  const h = harness(t, () => new Promise(done => { resolve = done; }));
  h.input.value = '/data/'; h.input.focus(); await h.flush();
  h.picker.setContext({ ...metadata, downloaderId: 'other' });
  resolve(['/data/private']); await tick();
  assert.equal(h.menu.hidden, true);
  assert.equal(h.list.children.length, 0);
  h.input.value = '/other/'; await h.input.emit('input'); await h.flush();
  await h.input.emit('blur');
  resolve(['/other/late']); await tick();
  assert.equal(h.menu.hidden, true);
});
