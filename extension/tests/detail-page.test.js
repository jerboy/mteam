import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { createDetailPage } from '../detail-page.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; }
const resource = { id: '9007199254740993', name: '电影 <script>标题</script>', subtitle: '副标题', category: '401',
  size: '1073741824', seeders: 12, leechers: 2, createdDate: '2026-10-21 10:00:00', discount: 'FREE', discountEndTime: '',
  description: '[quote][b]简介[/b][/quote][img]https://example.org/1.png[/img][img]https://example.org/2.png[/img]' };

function fixture(options = {}) {
  // Actual page markup with an in-memory DOM; no browser or live requests.
  const { document, Event } = parseHTML(readFileSync(new URL('../detail.html', import.meta.url), 'utf8'));
  const calls = [], copies = [], downloads = [], previews = [], notices = [];
  let settings = 0;
  const page = createDetailPage({
    document, query: options.query ?? `?id=${resource.id}`, request: async (type, payload) => {
      calls.push({ type, ...payload });
      if (options.request) return options.request(type, payload);
      if (type === 'config.status') return { configured: true };
      if (type === 'detail') return { ...resource };
      if (type === 'categories') return [{ id: '401', name: '电影' }];
      if (type === 'open.detail') return { opened: true };
      assert.fail(type);
    },
    onCopy: options.onCopy || (item => copies.push(item)),
    onDownload: item => downloads.push(item), onPreview: (...args) => previews.push(args),
    onSettings: () => settings++, notify: (...args) => notices.push(args)
  });
  const get = id => document.getElementById(id);
  const click = id => get(id).dispatchEvent(new Event('click'));
  return { document, get, click, page, calls, copies, downloads, previews, notices, settings: () => settings };
}

test('a direct resource URL loads independently, preserves large IDs and renders BBCode with the preview gallery', async () => {
  const h = fixture();
  assert.equal(h.get('detail-content').hidden, true);
  assert.equal(h.get('detail-download').disabled, true);
  await h.page.load(); await tick();
  assert.deepEqual(h.calls.map(call => call.type), ['config.status', 'detail', 'categories']);
  assert.equal(h.calls[1].id, resource.id);
  assert.equal(h.document.title, `${resource.name} · M-Team`);
  assert.equal(h.get('detail-title').textContent, resource.name);
  assert.equal(h.get('detail-title').querySelector('script'), null);
  assert.equal(h.get('detail-content').hidden, false);
  assert.equal(h.get('detail-main').getAttribute('aria-busy'), 'false');
  assert.equal(h.get('detail-download').disabled, false);
  assert.ok(h.get('detail-meta').textContent.includes('电影'));
  assert.equal(h.get('detail-description').querySelector('blockquote strong').textContent, '简介');
  h.get('detail-description').querySelector('button').click();
  assert.equal(h.previews[0][0], 'https://example.org/1.png');
  assert.equal(h.previews[0][3].length, 2);
  assert.equal(h.downloads.length, 0);
  assert.equal(h.copies.length, 0);
});

test('missing, duplicate or unsafe IDs do not reach account APIs or enable actions', async () => {
  for (const query of ['', '?id=0', '?id=../123', '?id=1&id=2', '?id=javascript:alert(1)', '?id=123%0A']) {
    const h = fixture({ query });
    await h.page.load();
    h.click('detail-download'); h.click('detail-copy'); h.click('detail-open');
    assert.deepEqual(h.calls, [], query);
    assert.equal(h.get('detail-content').hidden, true);
    assert.equal(h.get('detail-download').disabled, true);
    assert.equal(h.get('detail-retry').hidden, true);
    assert.match(h.get('detail-message').textContent, /ID 无效/);
    assert.equal(h.downloads.length, 0);
  }
});

test('an unconfigured page offers settings without requesting resource data or download links', async () => {
  const h = fixture({ request: async type => { assert.equal(type, 'config.status'); return { configured: false }; } });
  await h.page.load();
  assert.equal(h.get('detail-setup').hidden, false);
  assert.equal(h.get('detail-retry').hidden, true);
  assert.equal(h.get('detail-main').getAttribute('aria-busy'), 'false');
  h.click('detail-setup');
  assert.equal(h.settings(), 1);
  assert.equal(h.calls.length, 1);
});

test('failed detail loads remain retryable and a missing category list does not block reading', async () => {
  let attempt = 0;
  const category = deferred();
  const h = fixture({ request: async type => {
    if (type === 'config.status') return { configured: true };
    if (type === 'detail') {
      if (++attempt === 1) throw new Error('暂时无法读取');
      return { ...resource, subtitle: '' };
    }
    if (type === 'categories') return category.promise;
    assert.fail(type);
  } });
  await h.page.load();
  assert.equal(attempt, 1);
  assert.equal(h.get('detail-retry').hidden, false);
  assert.equal(h.get('detail-copy').disabled, true);
  assert.equal(h.get('detail-message').textContent, '暂时无法读取');
  h.click('detail-retry'); await tick();
  assert.equal(attempt, 2);
  assert.equal(h.get('detail-content').hidden, false);
  assert.equal(h.get('detail-subtitle').hidden, true);
  assert.equal(h.get('detail-copy').disabled, false);
  category.reject(new Error('分类不可用')); await tick();
  assert.equal(h.get('detail-state').hidden, true);
  assert.ok(h.get('detail-meta').textContent.includes('分类 401'));
});

test('resource actions use the displayed item and repeated clicks cannot duplicate a pending copy', async () => {
  const copying = deferred(), copied = [];
  const h = fixture({ onCopy: async item => { copied.push(item); return copying.promise; } });
  await h.page.load();
  h.click('detail-copy'); h.click('detail-copy');
  assert.equal(copied.length, 1);
  assert.equal(copied[0].id, resource.id);
  assert.equal(h.get('detail-copy').disabled, true);
  copying.resolve(); await tick();
  assert.equal(h.get('detail-copy').disabled, false);
  h.click('detail-download'); h.click('detail-open'); await tick();
  assert.equal(h.downloads[0].name, resource.name);
  assert.deepEqual(h.calls.at(-1), { type: 'open.detail', id: resource.id });
});

test('action errors keep the resource readable and allow a later action', async () => {
  const h = fixture({ onCopy: async () => { throw new Error('复制失败'); } });
  await h.page.load();
  h.click('detail-copy'); await tick();
  assert.deepEqual(h.notices, [['复制失败', true]]);
  assert.equal(h.get('detail-content').hidden, false);
  assert.equal(h.get('detail-copy').disabled, false);
  h.click('detail-download'); await tick();
  assert.equal(h.downloads.length, 1);
});

test('superseded requests and responses from before disposal cannot replace current content', async () => {
  const first = deferred(), categories = deferred();
  let reads = 0;
  const h = fixture({ request: async type => {
    if (type === 'config.status') return { configured: true };
    if (type === 'detail') return ++reads === 1 ? first.promise : { ...resource, name: '最新标题' };
    if (type === 'categories') return categories.promise;
    assert.fail(type);
  } });
  const initial = h.page.load(); await tick();
  await h.page.load();
  first.resolve({ ...resource, name: '旧标题' }); await initial;
  assert.equal(h.get('detail-title').textContent, '最新标题');
  h.page.dispose();
  categories.resolve([{ id: '401', name: '迟到的分类' }]); await tick();
  assert.ok(!h.get('detail-meta').textContent.includes('迟到的分类'));
  h.click('detail-download'); await h.page.load();
  assert.equal(h.downloads.length, 0);
  assert.equal(reads, 2);
});

test('a mismatched resource response cannot enable downloads for the wrong item', async () => {
  const h = fixture({ request: async type => type === 'config.status' ? { configured: true } : { ...resource, id: '123' } });
  await h.page.load();
  assert.equal(h.get('detail-content').hidden, true);
  assert.equal(h.get('detail-download').disabled, true);
  assert.match(h.get('detail-message').textContent, /信息不匹配/);
});
