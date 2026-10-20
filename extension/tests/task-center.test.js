import test from 'node:test';
import assert from 'node:assert/strict';
import { mockDocument } from './dom-fixture.js';
import { createTaskCenter } from '../task-center.js';

const hash = 'a'.repeat(40);
const entries = [{ id: 'nas', revision: 'r1', name: 'NAS' }, { id: 'remote', revision: 'r2', name: 'Remote' }];
const task = { hash, name: '<My download>', savePath: '/data', contentPath: '/data/video', addedOn: 100,
  progress: 0.5, size: 1000, downloadSpeed: 100, uploadSpeed: 0, state: 'downloading' };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(t, handler = async () => ({ items: [task], hasMore: false })) {
  const $ = mockDocument(t), calls = [], timers = new Map();
  let timerId = 0;
  const center = createTaskCenter({
    rpc: async (type, payload) => {
      calls.push({ type, payload });
      if (type === 'downloaders.list') return { items: entries, lastId: 'nas' };
      return handler(type, payload);
    },
    timerOptions: {
      setTimer(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
      clearTimer(id) { timers.delete(id); }
    }
  });
  const poll = async () => {
    const [id, timer] = timers.entries().next().value;
    timers.delete(id); await timer.fn();
  };
  const row = () => $('tasks-list').children[0];
  const remove = () => row().children[0].children[1];
  return { $, calls, timers, center, poll, row, remove };
}

test('task progress refreshes every five seconds in place and polling pauses while hidden or closed', async t => {
  let progress = 0.5;
  const { $, center, timers, poll, row, calls } = setup(t, async () => ({ items: [{ ...task, progress }], hasMore: false }));
  await center.open();
  const original = row();
  assert.equal(original.children[1].value, 0.5);
  assert.equal(original.children[0].children[0].textContent, '<My download>');
  assert.equal([...timers.values()][0].ms, 5000);
  progress = 0.8; await poll();
  assert.equal(row(), original); assert.equal(row().children[1].value, 0.8);
  document.visibilityState = 'hidden';
  const count = calls.length;
  await poll(); assert.equal(calls.length, count);
  await $('close-tasks').emit('click');
  assert.equal(timers.size, 0);
});

test('switching downloaders ignores stale responses and never queues overlapping reads', async t => {
  const gate = deferred();
  const { $, center, calls, row } = setup(t, async (_, payload) => {
    if (payload.downloaderId === 'nas') return gate.promise;
    return { items: [{ ...task, name: 'Remote item' }], hasMore: false };
  });
  const opening = center.open(); await tick();
  $('tasks-downloader').value = 'remote'; await $('tasks-downloader').emit('change');
  assert.equal(calls.filter(call => call.type === 'downloaders.tasks').length, 1);
  gate.resolve({ items: [task], hasMore: false }); await opening;
  assert.equal(row().children[0].children[0].textContent, 'Remote item');
  assert.equal(calls.at(-1).payload.revision, 'r2');
});

test('cancelled confirmation sends no deletion; confirm binds the exact task and downloader', async t => {
  let deleted = false;
  const { $, center, remove, calls, poll } = setup(t, async type => {
    if (type === 'downloaders.deleteTask') { deleted = true; return { requested: true }; }
    return { items: deleted ? [] : [task], hasMore: false };
  });
  await center.open(); await remove().emit('click');
  assert.equal($('task-delete-name').textContent, task.name);
  assert.equal($('task-delete-path').textContent, 'NAS · /data/video');
  assert.equal(document.activeElement, $('task-delete-cancel'));
  const count = calls.length; await poll(); assert.equal(calls.length, count);
  await $('task-delete-cancel').emit('click');
  assert.equal(calls.some(call => call.type === 'downloaders.deleteTask'), false);
  await remove().emit('click'); await $('task-delete-confirm').emit('click');
  const deletion = calls.find(call => call.type === 'downloaders.deleteTask');
  assert.deepEqual(deletion.payload, {
    downloaderId: 'nas', revision: 'r1', hash, confirmed: true,
    expected: { name: task.name, savePath: task.savePath, contentPath: task.contentPath, addedOn: task.addedOn }
  });
  assert.equal($('task-delete-dialog').open, false);
  assert.equal($('tasks-list').children[0].textContent, '暂无任务');
});

test('deleting locks navigation and repeated clicks, and uncertain results are not resent by polling', async t => {
  const gate = deferred();
  const { $, center, remove, calls, poll } = setup(t, async type => {
    if (type === 'downloaders.deleteTask') {
      await gate.promise;
      throw Object.assign(new Error('删除结果未知'), { code: 'QBT_UNCERTAIN' });
    }
    return { items: [task], hasMore: false };
  });
  await center.open(); await remove().emit('click');
  const deleting = $('task-delete-confirm').emit('click');
  await $('task-delete-confirm').emit('click');
  assert.equal($('tasks-downloader').disabled, true);
  assert.equal((await $('task-delete-dialog').emit('cancel')).defaultPrevented, true);
  gate.resolve(); await deleting;
  assert.equal(remove().disabled, true);
  await poll(); await remove().emit('click');
  assert.equal(calls.filter(call => call.type === 'downloaders.deleteTask').length, 1);
  assert.equal($('task-delete-dialog').open, false);
});

test('paging and filters request the right subset and a close discards late responses', async t => {
  let gate;
  const { $, center, calls } = setup(t, async () => gate ? gate.promise : { items: [task], hasMore: true });
  await center.open();
  await $('tasks-next').emit('click');
  assert.equal(calls.at(-1).payload.page, 1);
  $('tasks-filter').value = 'downloading'; await $('tasks-filter').emit('change');
  assert.equal(calls.at(-1).payload.page, 0);
  assert.equal(calls.at(-1).payload.filter, 'downloading');
  gate = deferred();
  const refreshing = $('tasks-refresh').emit('click'); await tick();
  await $('close-tasks').emit('click');
  gate.resolve({ items: [], hasMore: false }); await refreshing;
  assert.equal($('tasks-dialog').open, false);
  assert.notEqual($('tasks-list').children[0].textContent, '暂无任务');
});

test('a failed refresh retains the last progress and stops automatic reads after auth rejection', async t => {
  let fail = false;
  const { $, center, poll, row, timers } = setup(t, async () => {
    if (fail) throw Object.assign(new Error('认证失败'), { code: 'QBT_AUTH' });
    return { items: [task], hasMore: false };
  });
  await center.open();
  fail = true; await poll();
  assert.equal(row().children[1].value, 0.5);
  assert.match($('tasks-status').textContent, /显示上次结果.*认证失败/);
  assert.equal(timers.size, 0);
  fail = false; await $('tasks-refresh').emit('click');
  assert.equal(timers.size, 1);
  assert.equal($('tasks-status').hidden, true);
});

test('filters cannot invalidate a pending downloader configuration read', async t => {
  const $ = mockDocument(t), gate = deferred(), timers = new Map();
  const center = createTaskCenter({
    rpc: async type => type === 'downloaders.list' ? gate.promise : { items: [task], hasMore: false },
    timerOptions: { setTimer(fn) { timers.set(1, fn); return 1; }, clearTimer(id) { timers.delete(id); } }
  });
  const opening = center.open();
  assert.equal($('tasks-filter').disabled, true);
  await $('tasks-filter').emit('change');
  gate.resolve({ items: entries, lastId: 'nas' }); await opening;
  assert.equal($('tasks-filter').disabled, false);
  assert.equal($('tasks-list').children[0].children[1].value, 0.5);
});
