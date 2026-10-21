import { openSettings } from './lib/navigation.js';
import { $, notice, rpc } from './lib/ui.js';
import { downloadPath } from './lib/qbittorrent.js';
import { directoryValue } from './lib/path-completion.js';
import { createPathPicker } from './path-picker.js';

export function createDownloadDialog(toast) {
  let item, entries = [], locations, choices = [], loadId = 0, sending = false, uncertain = false, manualPath = '';
  const dialog = $('send-dialog');
  const pathInput = $('send-custom-path');
  const picker = createPathPicker({
    input: pathInput, menu: $('send-path-menu'), list: $('send-path-suggestions'),
    feedback: $('send-path-feedback'), status: $('send-path-status'), retry: $('send-path-retry'),
    fetchDirectories: ({ downloaderId, revision, directory }) => rpc('downloaders.directories', { downloaderId, revision, directory }),
    enabled: () => Boolean(dialog.open && locations && !sending && !uncertain && selection()?.kind === 'custom'),
    onChange: path => { manualPath = path; }
  });
  const selection = () => choices[Number($('send-location').value)];
  function updatePath() {
    const choice = selection();
    const custom = choice?.kind === 'custom';
    pathInput.required = custom;
    pathInput.readOnly = !custom;
    pathInput.value = custom ? manualPath : choice?.path || '';
    if (!custom) picker.stop();
    const preview = choice?.kind === 'category' ? '由分类自动管理' : '';
    $('send-path-preview').textContent = preview;
    $('send-path-preview').hidden = !preview;
  }
  function renderLocations(data) {
    choices = [{ kind: 'custom', label: '手动填写' },
      ...data.categories.map(category => ({ kind: 'category', name: category.name, label: `分类 · ${category.name}`,
        path: category.path || data.defaultPath }))];
    $('send-location').replaceChildren(...choices.map((choice, index) => new Option(choice.label, String(index))));
    // Every download starts with an editable server default; history only supplies suggestions.
    $('send-location').value = '0';
    $('send-location').hidden = !data.categories.length;
    $('send-location').disabled = false;
    manualPath = directoryValue(data.defaultPath);
    pathInput.disabled = false;
    updatePath();
  }
  async function loadLocations() {
    const generation = ++loadId;
    picker.setContext(null);
    locations = null; choices = [];
    $('send-submit').disabled = true; $('send-location').disabled = true;
    $('send-location').hidden = true;
    pathInput.disabled = true; pathInput.placeholder = '读取中…';
    updatePath(); notice($('send-status'), '');
    const target = entries.find(entry => entry.id === $('send-downloader').value);
    if (!target) return;
    try {
      const data = await rpc('downloaders.locations', { downloaderId: target.id, revision: target.revision });
      if (generation !== loadId || !dialog.open) return;
      locations = data;
      picker.setContext({ ...data, downloaderId: target.id });
      renderLocations(data); $('send-submit').disabled = uncertain;
      pathInput.placeholder = '输入路径 · Tab 补全';
      if (document.activeElement === pathInput) picker.update();
    } catch (error) {
      if (generation !== loadId || !dialog.open) return;
      pathInput.placeholder = '未能读取目录';
      notice($('send-status'), error.message);
    }
  }
  async function open(resource) {
    picker.setContext(null);
    item = resource; locations = null; uncertain = false; sending = false;
    $('send-resource').textContent = resource.name;
    $('send-empty').hidden = true; $('send-fields').hidden = false;
    $('send-downloader').replaceChildren(new Option('读取中…', ''));
    $('send-location').hidden = true;
    pathInput.value = ''; pathInput.disabled = true; pathInput.placeholder = '读取中…';
    $('send-submit').disabled = true; $('send-path-preview').hidden = true;
    notice($('send-status'), '');
    dialog.showModal();
    const generation = ++loadId;
    try {
      const data = await rpc('downloaders.list');
      if (generation !== loadId || !dialog.open) return;
      entries = data.items;
      $('send-empty').hidden = Boolean(entries.length); $('send-fields').hidden = !entries.length;
      $('send-downloader').replaceChildren(...entries.map(entry => new Option(entry.name, entry.id)));
      $('send-downloader').required = Boolean(entries.length);
      if (entries.some(entry => entry.id === data.lastId)) $('send-downloader').value = data.lastId;
      if (entries.length) await loadLocations();
    } catch (error) {
      if (generation === loadId && dialog.open) notice($('send-status'), error.message);
    }
  }
  function lock(value) {
    sending = value;
    if (value) picker.stop();
    for (const id of ['send-downloader', 'send-location', 'send-custom-path', 'save-torrent-file', 'close-send']) $(id).disabled = value;
    $('send-submit').disabled = value || uncertain || !locations;
    $('send-submit').textContent = value ? '提交中…' : '开始下载';
  }
  $('send-downloader').addEventListener('change', loadLocations);
  $('send-location').addEventListener('change', () => {
    updatePath();
    if (selection()?.kind === 'custom') {
      pathInput.focus(); pathInput.setSelectionRange(pathInput.value.length, pathInput.value.length);
      picker.update();
    }
  });
  $('setup-downloader').addEventListener('click', () => openSettings());
  $('close-send').addEventListener('click', () => { if (!sending) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (sending) event.preventDefault(); });
  dialog.addEventListener('close', () => { ++loadId; picker.setContext(null); });
  $('send-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (sending || uncertain || !locations) return;
    const target = entries.find(entry => entry.id === $('send-downloader').value);
    try {
      const chosen = selection();
      const location = chosen?.kind === 'custom'
        ? { kind: 'path', path: downloadPath($('send-custom-path').value) }
        : { kind: chosen.kind, name: chosen.name, path: chosen.path };
      lock(true); notice($('send-status'), '');
      const result = await rpc('downloaders.send', { id: item.id, downloaderId: target.id, revision: locations.revision, location });
      dialog.close(); toast(`已提交到 ${result.name}`);
    } catch (error) {
      if (error.code === 'QBT_UNCERTAIN') uncertain = true;
      notice($('send-status'), error.message);
    } finally { lock(false); }
  });
  $('save-torrent-file').addEventListener('click', async () => {
    if (sending) return;
    lock(true);
    try {
      await rpc('download', { id: item.id, name: item.name });
      dialog.close(); toast('已发起种子文件下载');
    } catch (error) { notice($('send-status'), error.message); }
    finally { lock(false); }
  });
  return { open, isSending: () => sending };
}
