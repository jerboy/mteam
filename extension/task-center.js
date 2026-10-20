import { $, node, notice, rpc as defaultRpc } from './lib/ui.js';
import { RefreshLoop } from './lib/refresh.js';
import { taskIdentity, taskMetrics, taskStatus } from './lib/tasks.js';

export function createTaskCenter({ rpc = defaultRpc, timerOptions = {} } = {}) {
  const dialog = $('tasks-dialog'), confirmation = $('task-delete-dialog');
  let entries = [], page = 0, hasMore = false, generation = 0, reading = false, queued = false;
  let configuring = false, deleting = false, selection = null, rows = new Map(), order = '';
  // Keep uncertain/accepted deletes disabled for this panel's lifetime. Polling
  // only reads; it must never replay a deletion whose result was lost.
  const deletions = new Map();
  const target = () => entries.find(entry => entry.id === $('tasks-downloader').value);
  const key = (entry, hash) => `${entry.id}:${entry.revision}:${hash}`;
  const loop = new RefreshLoop(refresh, { ...timerOptions,
    canRun: () => dialog.open && document.visibilityState === 'visible' && !reading && !deleting && !confirmation.open
  });

  function controls() {
    $('tasks-refresh').disabled = reading || deleting || !target();
    $('tasks-previous').disabled = reading || deleting || !page;
    $('tasks-next').disabled = reading || deleting || !hasMore;
    $('tasks-downloader').disabled = deleting || configuring;
    $('tasks-filter').disabled = deleting || configuring;
    $('close-tasks').disabled = deleting;
    $('tasks-page').textContent = `第 ${page + 1} 页`;
    $('tasks-list').setAttribute('aria-busy', String(reading));
  }

  function reset(nextPage = 0) {
    ++generation; page = nextPage; hasMore = false; rows = new Map(); order = '';
    $('tasks-list').replaceChildren();
    notice($('tasks-status'), '');
    controls();
  }

  function confirmDelete(task) {
    const entry = target();
    if (!entry || deleting || confirmation.open || deletions.has(key(entry, task.hash))) return;
    selection = { downloaderId: entry.id, revision: entry.revision, hash: task.hash, expected: taskIdentity(task) };
    $('task-delete-name').textContent = task.name;
    $('task-delete-path').textContent = `${entry.name} · ${task.contentPath || task.savePath}`;
    notice($('task-delete-status'), '');
    confirmation.showModal();
    $('task-delete-cancel').focus();
  }

  function render(items, entry) {
    const nextRows = new Map();
    for (const task of items) {
      let row = rows.get(task.hash);
      if (!row) {
        row = { root: node('article', 'task-row'), title: node('h3', 'task-name'), status: node('span', 'task-state'),
          metrics: node('span', 'task-metrics'), progress: node('progress', 'task-progress'), remove: node('button', 'text-button task-remove', '删除') };
        row.remove.type = 'button';
        row.remove.addEventListener('click', () => confirmDelete(row.task));
        const heading = node('div', 'task-heading'), meta = node('div', 'task-meta');
        heading.append(row.title, row.remove); meta.append(row.status, row.metrics);
        row.root.append(heading, row.progress, meta);
      }
      row.task = task;
      row.title.textContent = task.name; row.title.title = task.name;
      row.remove.setAttribute('aria-label', `删除任务及文件：${task.name}`);
      row.remove.disabled = deleting || deletions.has(key(entry, task.hash));
      row.status.textContent = deletions.get(key(entry, task.hash)) || taskStatus(task);
      row.metrics.textContent = taskMetrics(task);
      row.progress.max = 1; row.progress.value = task.progress;
      row.progress.setAttribute('aria-label', `${task.name} 下载进度`);
      nextRows.set(task.hash, row);
    }
    rows = nextRows;
    const nextOrder = items.map(task => task.hash).join(',');
    // Leave focused controls in place while only progress values change.
    if (nextOrder !== order || !items.length) {
      $('tasks-list').replaceChildren(...(items.length ? [...rows.values()].map(row => row.root) : [node('p', 'tasks-empty', '暂无任务')]));
    }
    order = nextOrder;
  }

  async function refresh() {
    if (!dialog.open || !target() || deleting || confirmation.open) return;
    if (reading) { queued = true; return; }
    const version = generation, entry = target();
    reading = true; controls();
    if (!rows.size) notice($('tasks-status'), '读取中…');
    try {
      const data = await rpc('downloaders.tasks', { downloaderId: entry.id, revision: entry.revision, page, filter: $('tasks-filter').value });
      if (version !== generation || !dialog.open) return;
      hasMore = data.hasMore;
      if (!data.items.length && page > 0) { reset(); queued = true; return; }
      render(data.items, entry);
      notice($('tasks-status'), '');
      if (!loop.intervalMs) loop.setInterval(5000);
    } catch (error) {
      if (version !== generation || !dialog.open) return;
      notice($('tasks-status'), `${rows.size ? '刷新失败，显示上次结果。' : ''}${error.message}`);
      if (['QBT_AUTH', 'QBT_PERMISSION', 'QBT_CONFIG', 'QBT_CHANGED', 'QBT_RULES'].includes(error.code)) loop.setInterval(0);
      else loop.pauseFor(30000);
    } finally {
      reading = false; controls();
      if (queued) { queued = false; await refresh(); }
    }
  }

  async function open(preferredId) {
    if (dialog.open) return;
    configuring = true; entries = []; reset(); $('tasks-filter').value = 'all';
    $('tasks-downloader').replaceChildren(new Option('读取中…', ''));
    $('tasks-setup').hidden = true;
    dialog.showModal();
    notice($('tasks-status'), '读取中…');
    const version = generation;
    try {
      const data = await rpc('downloaders.list');
      if (version !== generation || !dialog.open) return;
      entries = data.items; configuring = false;
      $('tasks-downloader').replaceChildren(...entries.map(entry => new Option(entry.name, entry.id)));
      const id = preferredId || data.lastId;
      if (entries.some(entry => entry.id === id)) $('tasks-downloader').value = id;
      $('tasks-setup').hidden = Boolean(entries.length);
      if (entries.length) await refresh();
      else notice($('tasks-status'), '尚未添加下载器');
    } catch (error) {
      if (version === generation && dialog.open) notice($('tasks-status'), error.message);
    } finally {
      if (version === generation) configuring = false;
      controls();
    }
  }

  for (const id of ['tasks-downloader', 'tasks-filter']) $(id).addEventListener('change', () => {
    if (deleting || configuring) return;
    reset(); return refresh();
  });
  $('tasks-refresh').addEventListener('click', refresh);
  for (const [id, step] of [['tasks-previous', -1], ['tasks-next', 1]]) $(id).addEventListener('click', () => {
    if (reading || deleting || (step < 0 ? !page : !hasMore)) return;
    reset(page + step); return refresh();
  });
  $('tasks-setup').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('close-tasks').addEventListener('click', () => { if (!deleting) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (deleting) event.preventDefault(); });
  dialog.addEventListener('close', () => { ++generation; queued = false; loop.setInterval(0); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') return refresh();
  });
  for (const id of ['task-delete-cancel', 'close-task-delete']) $(id).addEventListener('click', () => {
    if (!deleting) confirmation.close();
  });
  confirmation.addEventListener('cancel', event => { if (deleting) event.preventDefault(); });
  confirmation.addEventListener('close', () => { selection = null; });
  $('task-delete-confirm').addEventListener('click', async () => {
    if (!selection || deleting || !confirmation.open) return;
    const chosen = selection, entry = { id: chosen.downloaderId, revision: chosen.revision };
    const deleteKey = key(entry, chosen.hash);
    if (deletions.has(deleteKey)) return;
    deleting = true; controls();
    for (const id of ['task-delete-confirm', 'task-delete-cancel', 'close-task-delete']) $(id).disabled = true;
    $('task-delete-confirm').textContent = '删除中…';
    try {
      await rpc('downloaders.deleteTask', { ...chosen, confirmed: true });
      deletions.set(deleteKey, '已请求删除');
      confirmation.close();
    } catch (error) {
      if (error.code === 'QBT_UNCERTAIN') {
        deletions.set(deleteKey, '删除结果待确认');
        confirmation.close();
        notice($('tasks-status'), error.message);
      } else notice($('task-delete-status'), error.message);
    } finally {
      deleting = false;
      for (const id of ['task-delete-confirm', 'task-delete-cancel', 'close-task-delete']) $(id).disabled = false;
      $('task-delete-confirm').textContent = '删除任务及文件';
      controls();
      if (deletions.has(deleteKey)) {
        const row = rows.get(chosen.hash);
        if (row) { row.remove.disabled = true; row.status.textContent = deletions.get(deleteKey); }
        // Refresh only after a confirmed response; leave an uncertain result visible.
        if (deletions.get(deleteKey) === '已请求删除') await refresh();
      }
    }
  });
  return { open };
}
