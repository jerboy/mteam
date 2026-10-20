import { formatSize } from './lib/core.js';
import { $, node, rpc, notice, promotion, formatDate } from './lib/ui.js';
import { createPoster } from './lib/poster.js';
import { RefreshLoop } from './lib/refresh.js';
import { createDownloadDialog } from './download-dialog.js';
import { createTaskCenter } from './task-center.js';

if (new URLSearchParams(location.search).get('view') === 'tab') document.body.classList.add('tab-view');
const state = { result: null, query: null, categories: [], direction: 'DESC', busy: false, revision: '', detail: null };
let toastTimer;
const downloadDialog = createDownloadDialog(toast);
const taskCenter = createTaskCenter();
const refreshLoop = new RefreshLoop(() => search(state.query, state.result.pageNumber, { fresh: true }), {
  canRun: () => state.result && !state.busy && $('filter-panel').hidden && document.visibilityState === 'visible' && !$('detail-dialog').open && !$('link-dialog').open && !$('send-dialog').open && !$('tasks-dialog').open
});

function toast(text, error = false) {
  const target = $('link-dialog').open ? $('link-status') : $('detail-dialog').open ? $('detail-status') : null;
  if (target) { target.textContent = text; target.classList.toggle('error', error); target.hidden = false; return; }
  $('toast').textContent = text; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
}

function setConnection(text, kind = '') {
  $('connection').textContent = text; $('connection').className = `connection ${kind}`;
}

function empty(title, text, setup = false) {
  const root = node('div', 'empty-state');
  const symbol = node('div', 'empty-symbol');
  symbol.setAttribute('data-icon', setup ? 'settings' : 'search');
  symbol.setAttribute('aria-hidden', 'true');
  root.append(symbol, node('h3', '', title));
  if (text) root.append(node('p', '', text));
  if (setup) { const button = node('button', 'button secondary', '前往设置'); button.addEventListener('click', () => chrome.runtime.openOptionsPage()); root.append(button); }
  $('results').replaceChildren(root);
}

function categoryName(id) { return state.categories.find(item => item.id === String(id))?.name || (id ? `分类 ${id}` : '资源'); }

function renderCategories(selected = $('category').value) {
  const options = [new Option('全部分类', '')];
  // The official category API may omit mode; do not guess category IDs or hide them.
  for (const category of state.categories) options.push(new Option(category.name, category.id));
  $('category').replaceChildren(...options);
  if (options.some(option => option.value === selected)) $('category').value = selected;
  renderFilterCount();
}

function currentQuery() {
  return { keyword: $('keyword').value, mode: $('mode').value, category: $('category').value, discount: $('discount').value,
    sortField: $('sort').value, sortDirection: state.direction, onlyFav: $('only-fav').checked };
}

function populateQuery(query) {
  if (!query) return;
  $('keyword').value = query.keyword || ''; $('mode').value = query.mode || 'normal';
  $('discount').value = query.discount || ''; $('sort').value = query.sortField || 'CREATED_DATE';
  $('only-fav').checked = Boolean(query.onlyFav); state.direction = query.sortDirection || 'DESC';
  renderDirection(); renderCategories(query.category || '');
}

function renderDirection() {
  const label = state.direction === 'DESC' ? '降序' : '升序';
  $('direction').setAttribute('data-direction', state.direction.toLowerCase());
  $('direction').title = `切换为${state.direction === 'DESC' ? '升序' : '降序'}`;
  $('direction').setAttribute('aria-label', `切换排序方向：当前${label}`);
}

function renderFilterCount() {
  const count = Number($('mode').value !== 'normal') + Number(Boolean($('category').value)) + Number(Boolean($('discount').value)) + Number($('only-fav').checked);
  $('filter-count').textContent = String(count);
  $('filter-count').hidden = !count;
  $('filters-toggle').classList.toggle('active', count > 0);
  $('filters-toggle').setAttribute('aria-label', count ? `筛选，已选 ${count} 项` : '筛选');
}

function closeFilters(restoreFocus = false) {
  $('filter-panel').hidden = true;
  $('filters-toggle').setAttribute('aria-expanded', 'false');
  if (restoreFocus) $('filters-toggle').focus();
}

async function withAction(button, task) {
  const original = button.textContent;
  const changeLabel = !button.classList.contains('icon-button') && !button.classList.contains('result-title');
  button.disabled = true; button.setAttribute('aria-busy', 'true');
  if (changeLabel) button.textContent = '处理中…';
  try { await task(); } catch (error) {
    if ($('link-dialog').open || $('detail-dialog').open) { toast(error.message, true); }
    else notice($('notice'), error.message);
  }
  finally {
    button.disabled = false; button.removeAttribute('aria-busy');
    if (changeLabel) button.textContent = original;
  }
}

async function copyLink(item) {
  const { url } = await rpc('link', { id: item.id });
  try { await navigator.clipboard.writeText(url); toast('下载链接已复制'); }
  catch { $('download-link').value = url; $('link-status').hidden = true; $('link-dialog').showModal(); $('download-link').select(); }
}

async function download(item) {
  await downloadDialog.open(item);
}

async function showDetail(item) {
  const detail = await rpc('detail', { id: item.id });
  state.detail = detail;
  $('detail-status').hidden = true;
  $('detail-title').textContent = detail.name; $('detail-subtitle').textContent = detail.subtitle;
  const metadata = [formatSize(detail.size), `↑ ${detail.seeders} 做种`, `↓ ${detail.leechers} 下载`, categoryName(detail.category), formatDate(detail.createdDate)];
  const promo = promotion(detail);
  if (promo) metadata.push(`${promo}${detail.discountEndTime ? ` · 截止 ${detail.discountEndTime}` : ''}`);
  $('detail-meta').replaceChildren(...metadata.map(value => node('span', '', value)));
  $('detail-description').textContent = detail.description || '暂无简介';
  $('detail-dialog').showModal();
}

function resultCard(item) {
  const card = node('article', 'result-card');
  const mark = createPoster(document, item.posterUrl);
  const info = node('div', 'result-info');
  const title = node('button', 'result-title', item.name); title.title = item.name;
  title.addEventListener('click', () => withAction(title, () => showDetail(item)));
  info.append(title);
  if (item.subtitle) info.append(node('p', 'result-subtitle', item.subtitle));
  const meta = node('div', 'result-meta');
  const promo = promotion(item);
  if (promo) meta.append(node('span', `tag ${promo.includes('FREE') ? 'free' : 'promo'}`, promo));
  meta.append(node('span', 'size', formatSize(item.size)), node('span', 'seeds', `↑ ${item.seeders}`), node('span', 'peers', `↓ ${item.leechers}`), node('span', '', categoryName(item.category)), node('span', '', formatDate(item.createdDate)));
  info.append(meta);
  const actions = node('div', 'result-actions');
  const copy = node('button', 'icon-button');
  copy.setAttribute('data-icon', 'copy'); copy.setAttribute('aria-label', `复制下载链接：${item.name}`); copy.title = '复制下载链接';
  copy.addEventListener('click', () => withAction(copy, () => copyLink(item)));
  const save = node('button', 'button download-action', '下载');
  save.setAttribute('data-icon', 'download'); save.setAttribute('aria-label', `下载：${item.name}`);
  save.addEventListener('click', () => withAction(save, () => download(item)));
  actions.append(copy, save); card.append(mark, info, actions);
  return card;
}

function renderResults() {
  const result = state.result;
  if (!result) { empty('搜索资源'); return; }
  $('result-count').textContent = result.total === null ? `本页 ${result.items.length} 项` : `共 ${result.total.toLocaleString()} 项`;
  if (!result.items.length) empty('无结果');
  else $('results').replaceChildren(...result.items.map(resultCard));
  $('page-info').textContent = `第 ${result.pageNumber} 页${result.total === null ? '' : ` / 共 ${Math.max(1, Math.ceil(result.total / result.pageSize))} 页`}`;
  $('previous').disabled = state.busy || result.pageNumber <= 1;
  $('next').disabled = state.busy || result.pageNumber >= 1000 || (result.total === null ? result.items.length < result.pageSize : result.pageNumber * result.pageSize >= result.total);
}

async function search(query, pageNumber = 1, { fresh = false } = {}) {
  if (state.busy) return;
  state.busy = true; document.body.classList.add('busy');
  $('search-button').disabled = true; $('search-button').textContent = '…';
  for (const id of ['sort', 'direction', 'apply-filters']) $(id).disabled = true;
  $('results').setAttribute('aria-busy', 'true');
  $('previous').disabled = true; $('next').disabled = true;
  $('refresh-results').disabled = true;
  notice($('notice'), ''); $('results').replaceChildren(node('div', 'skeleton'), node('div', 'skeleton'));
  try {
    const result = await rpc('search', { query: { ...query, pageNumber }, fresh });
    state.result = result; state.query = query; setConnection('已连接', 'ready');
    await chrome.storage.session.set({ viewState: { version: 2, result, query, revision: state.revision } });
    $('refresh-results').title = `刷新结果 · 更新于 ${new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
  } catch (error) {
    notice($('notice'), error.message); setConnection('请求失败', 'error');
    if (error.code === 'RATE_LIMIT') refreshLoop.pauseFor((error.retryAfterSeconds || 60) * 1000);
    else if (['NO_KEY', 'AUTH', 'API', 'PERMISSION'].includes(error.code)) { refreshLoop.setInterval(0); $('auto-refresh').value = '0'; }
  }
  finally {
    state.busy = false; document.body.classList.remove('busy');
    $('search-button').disabled = false; $('search-button').textContent = '搜索';
    for (const id of ['sort', 'direction', 'apply-filters']) $(id).disabled = false;
    $('results').setAttribute('aria-busy', 'false');
    $('refresh-results').disabled = !state.result;
    renderResults(); $('results').scrollTop = 0;
  }
}

$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('open-tasks').addEventListener('click', () => taskCenter.open());
$('auto-refresh').addEventListener('change', () => refreshLoop.setInterval(Number($('auto-refresh').value)));
$('refresh-results').addEventListener('click', () => { if (state.result) search(state.query, state.result.pageNumber, { fresh: true }); });
$('dashboard').addEventListener('click', () => withAction($('dashboard'), () => rpc('open.dashboard')));
$('search-form').addEventListener('submit', event => { event.preventDefault(); closeFilters(); search(currentQuery()); });
$('sort').addEventListener('change', () => { if (state.result) search(currentQuery()); });
$('direction').addEventListener('click', () => { state.direction = state.direction === 'DESC' ? 'ASC' : 'DESC'; renderDirection(); if (state.result) search(currentQuery()); });
$('filters-toggle').addEventListener('click', () => {
  if (!$('filter-panel').hidden) { closeFilters(); return; }
  $('filter-panel').hidden = false;
  $('filters-toggle').setAttribute('aria-expanded', 'true');
  $('mode').focus();
});
for (const id of ['mode', 'category', 'discount', 'only-fav']) $(id).addEventListener('change', renderFilterCount);
$('clear-filters').addEventListener('click', () => {
  $('mode').value = 'normal'; $('category').value = ''; $('discount').value = ''; $('only-fav').checked = false;
  renderFilterCount();
});
document.addEventListener('click', event => {
  if (!$('filter-panel').hidden && !$('filter-panel').contains(event.target) && !$('filters-toggle').contains(event.target)) closeFilters();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('filter-panel').hidden) { event.preventDefault(); closeFilters(true); }
});
$('previous').addEventListener('click', () => search(state.query, state.result.pageNumber - 1));
$('next').addEventListener('click', () => search(state.query, state.result.pageNumber + 1));
$('close-detail').addEventListener('click', () => $('detail-dialog').close());
$('close-link').addEventListener('click', () => { $('link-dialog').close(); $('download-link').value = ''; });
$('link-dialog').addEventListener('close', () => { $('download-link').value = ''; });
$('detail-copy').addEventListener('click', () => withAction($('detail-copy'), () => copyLink(state.detail)));
$('detail-download').addEventListener('click', () => withAction($('detail-download'), () => download(state.detail)));
$('detail-open').addEventListener('click', () => withAction($('detail-open'), () => rpc('open.detail', { id: state.detail.id })));
$('copy-again').addEventListener('click', () => withAction($('copy-again'), async () => {
  try { await navigator.clipboard.writeText($('download-link').value); $('link-dialog').close(); toast('下载链接已复制'); }
  catch { $('download-link').select(); throw new Error('自动复制不可用，请选中链接后按 Ctrl/Cmd+C。'); }
}));
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => { if (event.target === dialog && !(dialog.id === 'send-dialog' && downloadDialog.isSending())) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });

async function initialize() {
  try {
    const config = await rpc('config.status'); state.revision = config.revision;
    if (!config.configured) {
      empty('未配置 API Key', '', true);
      $('search-button').disabled = true;
      return;
    }
    setConnection('已配置', 'ready');
    const saved = (await chrome.storage.session.get('viewState')).viewState;
    if (saved?.revision === state.revision) { state.result = saved.version === 2 ? saved.result : null; state.query = saved.query; populateQuery(saved.query); }
    renderResults();
    $('refresh-results').disabled = !state.result;
    try {
      state.categories = await rpc('categories'); renderCategories(state.query?.category || '');
      setConnection('已连接', 'ready'); if (state.result) renderResults();
    } catch (error) { notice($('notice'), error.message); setConnection('未连接', 'error'); }
  } catch (error) { notice($('notice'), error.message); empty('未连接', '', true); }
}
initialize();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.config || changes.configRevision)) location.reload();
});
