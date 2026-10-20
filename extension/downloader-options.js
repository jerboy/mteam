import { $, node, notice, rpc } from './lib/ui.js';
import { downloaderPermission, downloaderUrl } from './lib/qbittorrent.js';

let entries = [];
let editing = null;
let busy = false;

function showAuth() {
  const password = $('qbt-auth').value === 'password';
  $('qbt-password-fields').hidden = !password;
  $('qbt-key-field').hidden = password;
  $('qbt-username').required = password;
}

function edit(entry = null) {
  editing = entry;
  $('qbt-name').value = entry?.name || '';
  $('qbt-url').value = entry?.url || '';
  $('qbt-auth').value = entry?.auth || 'password';
  $('qbt-username').value = entry?.username || '';
  $('qbt-password').value = ''; $('qbt-api-key').value = '';
  $('qbt-password').placeholder = entry?.auth === 'password' ? '留空保留已保存的密码' : '';
  $('qbt-api-key').placeholder = entry?.auth === 'apikey' ? '留空保留已保存的密钥' : 'qbt_…';
  $('remove-downloader').hidden = !entry;
  $('downloader-form').hidden = false;
  showAuth(); notice($('downloader-status'), '');
  $('qbt-name').focus();
}

function closeEditor() {
  $('downloader-form').hidden = true;
  $('qbt-password').value = ''; $('qbt-api-key').value = '';
  editing = null;
}

async function render() {
  const data = await rpc('downloaders.list');
  entries = data.items;
  const rows = entries.map(entry => {
    const row = node('div', 'downloader-row');
    const info = node('div', 'downloader-info');
    info.append(node('strong', '', entry.name), node('span', '', entry.url));
    const connect = node('button', 'text-button', '连接');
    connect.type = 'button';
    connect.setAttribute('aria-label', `检查连接：${entry.name}`);
    connect.addEventListener('click', () => act(async () => {
      notice($('downloader-status'), '连接中…');
      const result = await rpc('downloaders.test', { downloaderId: entry.id, revision: entry.revision });
      notice($('downloader-status'), `已连接 · ${result.defaultPath}`, true);
    }));
    const change = node('button', 'text-button', '编辑');
    change.type = 'button'; change.setAttribute('aria-label', `编辑：${entry.name}`);
    change.addEventListener('click', () => edit(entry));
    row.append(info, connect, change); return row;
  });
  $('downloader-list').replaceChildren(...(rows.length ? rows : [node('p', 'muted', '尚未添加下载器')]));
}

async function act(task) {
  if (busy) return;
  busy = true;
  const controls = [...$('downloaders-section').querySelectorAll('button, input, select')];
  controls.forEach(control => { control.disabled = true; });
  try { await task(); } catch (error) { notice($('downloader-status'), error.message); }
  finally {
    busy = false;
    controls.forEach(control => { control.disabled = false; });
  }
}

$('add-downloader').addEventListener('click', () => edit());
$('cancel-downloader').addEventListener('click', closeEditor);
$('qbt-auth').addEventListener('change', showAuth);
$('downloader-form').addEventListener('submit', event => {
  event.preventDefault();
  act(async () => {
    const downloader = {
      id: editing?.id, revision: editing?.revision, name: $('qbt-name').value,
      url: downloaderUrl($('qbt-url').value), auth: $('qbt-auth').value,
      username: $('qbt-username').value, password: $('qbt-password').value, apiKey: $('qbt-api-key').value
    };
    // Request only the user-entered host, synchronously from the submit gesture.
    const granted = await chrome.permissions.request({ origins: [downloaderPermission(downloader.url)] });
    if (!granted) throw new Error('未授权访问此下载器。');
    await rpc('downloaders.save', { downloader });
    closeEditor(); await render();
    notice($('downloader-status'), '已保存', true);
  });
});
$('remove-downloader').addEventListener('click', () => act(async () => {
  if (!editing) return;
  await rpc('downloaders.remove', { downloaderId: editing.id, revision: editing.revision });
  closeEditor(); await render();
  notice($('downloader-status'), '已移除', true);
}));
render().catch(error => notice($('downloader-status'), error.message));
