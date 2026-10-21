import { formatSize, torrentId } from './lib/core.js';
import { promotion, formatDate } from './lib/ui.js';
import { renderMarkdown } from './lib/markdown.js';

export function createDetailPage({ document, query, request, onPreview, onDownload, onCopy, onSettings, notify }) {
  const get = id => document.getElementById(id);
  const actions = ['detail-open', 'detail-copy', 'detail-download'].map(get);
  let detail = null, generation = 0, disposed = false;

  function renderMeta(categories = []) {
    const category = categories.find(item => item.id === detail.category)?.name || (detail.category ? `分类 ${detail.category}` : '资源');
    const values = [formatSize(detail.size), `↑ ${detail.seeders} 做种`, `↓ ${detail.leechers} 下载`, category, formatDate(detail.createdDate)];
    const promo = promotion(detail);
    if (promo) values.push(`${promo}${detail.discountEndTime ? ` · 截止 ${detail.discountEndTime}` : ''}`);
    get('detail-meta').replaceChildren(...values.map(value => {
      const span = document.createElement('span'); span.textContent = value; return span;
    }));
  }

  function showState(text, { error = false, retry = false, setup = false } = {}) {
    get('detail-state').hidden = false;
    get('detail-state').classList.toggle('error', error);
    get('detail-message').textContent = text;
    get('detail-retry').hidden = !retry;
    get('detail-setup').hidden = !setup;
  }

  async function load() {
    if (disposed) return;
    const current = ++generation;
    detail = null;
    document.title = '资源详情 · M-Team';
    actions.forEach(button => { button.disabled = true; });
    get('detail-content').hidden = true;
    get('detail-description').replaceChildren();
    get('detail-main').setAttribute('aria-busy', 'true');
    get('detail-retry').disabled = true;
    showState('加载中…');
    let id;
    try {
      const params = new URLSearchParams(query);
      id = torrentId(params.getAll('id').length === 1 ? params.get('id') : null);
      const config = await request('config.status');
      if (current !== generation) return;
      if (!config.configured) { showState('请先配置 M-Team API Key', { setup: true }); return; }
      const resource = await request('detail', { id });
      if (current !== generation) return;
      if (resource.id !== id) throw new Error('资源信息不匹配，请重试。');
      detail = resource;
      document.title = `${detail.name} · M-Team`;
      get('detail-title').textContent = detail.name;
      get('detail-subtitle').textContent = detail.subtitle;
      get('detail-subtitle').hidden = !detail.subtitle;
      renderMeta();
      renderMarkdown(get('detail-description'), detail.description, { onPreview });
      get('detail-state').hidden = true;
      get('detail-content').hidden = false;
      actions.forEach(button => { button.disabled = false; });
      // Category labels are optional and must never delay or replace the resource.
      request('categories').then(categories => {
        if (current === generation && Array.isArray(categories)) renderMeta(categories);
      }).catch(() => {});
    } catch (error) {
      if (current === generation) showState(error.message, {
        error: true, retry: Boolean(id), setup: ['NO_KEY', 'AUTH', 'CONFIG', 'PERMISSION'].includes(error.code)
      });
    } finally {
      if (current === generation) {
        get('detail-main').setAttribute('aria-busy', 'false');
        get('detail-retry').disabled = false;
      }
    }
  }

  function action(id, task) {
    const button = get(id);
    button.addEventListener('click', async () => {
      if (!detail || button.disabled || disposed) return;
      const current = generation, resource = detail;
      button.disabled = true; button.setAttribute('aria-busy', 'true');
      try { await task(resource); }
      catch (error) { if (current === generation) notify(error.message, true); }
      finally {
        button.removeAttribute('aria-busy');
        if (current === generation) button.disabled = !detail;
      }
    });
  }

  get('detail-retry').addEventListener('click', () => { if (!get('detail-retry').disabled) load(); });
  get('detail-setup').addEventListener('click', onSettings);
  action('detail-open', item => request('open.detail', { id: item.id }));
  action('detail-copy', onCopy);
  action('detail-download', onDownload);
  return { load, dispose() { disposed = true; generation++; detail = null; actions.forEach(button => { button.disabled = true; }); } };
}
