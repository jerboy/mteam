import { DEFAULT_CONFIG } from './lib/core.js';
import { $, notice, rpc } from './lib/ui.js';
import './downloader-options.js';

let savedConfig = {};
let active = false;
$('extension-version').textContent = `v${chrome.runtime.getManifest().version}`;
function renderVisit(data) {
  $('visit-enabled').checked = data.enabled;
  $('visit-interval').value = String(data.intervalDays || 14);
  const time = data.nextAt ? new Date(data.nextAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  $('visit-state').textContent = `下次访问 ${time}`;
  $('visit-state').hidden = !data.enabled || !time;
  $('browse-state').textContent = data.lastWebBrowse ? `最近浏览 ${data.lastWebBrowse}` : '';
  $('browse-state').hidden = !data.lastWebBrowse;
  const messages = { opening: '正在打开…', checking: '已打开，正在确认…', unverified: '未确认登录，请到官网查看。', failed: '打开失败，请重试。' };
  notice($('visit-status'), messages[data.status] || '', ['opening', 'checking'].includes(data.status) ? 'neutral' : false);
}
function updateKeyState() {
  const hasKey = Boolean(savedConfig.apiKey);
  $('key-state').textContent = hasKey ? '已保存' : '未配置';
  $('api-key').placeholder = hasKey ? '已保存' : 'API Key';
  $('test').disabled = !hasKey; $('clear').disabled = !hasKey;
}

async function action(task) {
  if (active) return;
  active = true;
  for (const id of ['save', 'test', 'clear']) $(id).disabled = true;
  try { await task(); } catch (error) { notice($('settings-status'), error.message); }
  finally { active = false; $('save').disabled = false; updateKeyState(); }
}

$('settings-form').addEventListener('submit', event => {
  event.preventDefault();
  action(async () => {
    const apiKey = $('api-key').value.trim() || savedConfig.apiKey || '';
    const config = { apiKey, apiOrigin: $('api-origin').value, siteOrigin: $('site-origin').value.trim(), pageSize: Number($('page-size').value) };
    await rpc('config.save', { config });
    savedConfig = config; $('api-key').value = ''; $('api-key').type = 'password'; $('reveal-key').textContent = '显示';
    await chrome.storage.session.remove('viewState');
    notice($('settings-status'), '已保存', true);
    renderVisit(await rpc('activity.status'));
  });
});
$('test').addEventListener('click', () => action(async () => {
  notice($('settings-status'), '连接中…', 'neutral');
  const { categoryCount } = await rpc('test');
  notice($('settings-status'), `已连接 · ${categoryCount} 个分类`, true);
}));
$('clear').addEventListener('click', () => action(async () => {
  await rpc('config.clear'); await chrome.storage.session.remove('viewState'); savedConfig = {}; $('api-key').value = '';
  notice($('settings-status'), '已清除', 'neutral');
  renderVisit(await rpc('activity.status'));
}));
$('reveal-key').addEventListener('click', () => {
  const reveal = $('api-key').type === 'password'; $('api-key').type = reveal ? 'text' : 'password';
  $('reveal-key').textContent = reveal ? '隐藏' : '显示'; $('reveal-key').setAttribute('aria-label', `${reveal ? '隐藏' : '显示'}输入的 API Key`);
});
$('open-search').addEventListener('click', () => action(() => rpc('open.dashboard')));

$('visit-form').addEventListener('submit', event => {
  event.preventDefault();
  visitAction($('save-visit'), async () => {
    renderVisit(await rpc('activity.configure', { preferences: { enabled: $('visit-enabled').checked, intervalDays: Number($('visit-interval').value) } }));
    notice($('visit-status'), '已保存', true);
  });
});
async function visitAction(button, task) {
  button.disabled = true;
  try { await task(); } catch (error) { notice($('visit-status'), error.message); }
  finally { button.disabled = false; }
}
$('visit-now').addEventListener('click', () => visitAction($('visit-now'), async () => {
  const result = await rpc('activity.visit');
  renderVisit(await rpc('activity.status'));
  if (result.skipped) notice($('visit-status'), '请稍后重试。');
}));
$('check-activity').addEventListener('click', () => visitAction($('check-activity'), async () => renderVisit(await rpc('activity.check'))));

async function initialize() {
  try {
    savedConfig = (await chrome.storage.local.get('config')).config || {};
    const config = { ...DEFAULT_CONFIG, ...savedConfig };
    $('api-origin').value = config.apiOrigin; $('site-origin').value = config.siteOrigin; $('page-size').value = String(config.pageSize);
    updateKeyState();
    renderVisit(await rpc('activity.status'));
  } catch { notice($('settings-status'), '无法读取本机配置，请重新加载扩展。'); }
}
initialize();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.visitPrefs || changes.visitState)) rpc('activity.status').then(renderVisit).catch(() => {});
});
