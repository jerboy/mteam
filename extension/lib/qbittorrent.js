import { AppError, mteamUrl } from './core.js';
import { normalizeTask, sameTask, taskHash, taskQuery, TASK_PAGE_SIZE } from './tasks.js';

export function downloaderUrl(value) {
  const text = String(value || '').trim();
  let url;
  try { url = new URL(text); } catch { throw new AppError('QBT_CONFIG', '请输入完整的下载器 URL。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      /[\u0000-\u0020\\]/.test(text) || text.length > 1024) {
    throw new AppError('QBT_CONFIG', 'URL 仅填写 http(s) 地址，可包含端口和路径。');
  }
  return url.href.replace(/\/+$/, '');
}

export function downloaderPermission(value) {
  return `${new URL(downloaderUrl(value)).origin}/*`;
}

export function validateDownloader(input = {}, previous) {
  const name = String(input.name || '').trim();
  const url = downloaderUrl(input.url);
  const auth = input.auth || 'password';
  const username = auth === 'password' ? String(input.username || '').trim() : '';
  if (!name || name.length > 60) throw new AppError('QBT_CONFIG', '请填写名称，最多 60 个字符。');
  if (!['password', 'apikey'].includes(auth)) throw new AppError('QBT_CONFIG', '认证方式无效。');
  if (auth === 'password' && (!username || username.length > 256)) throw new AppError('QBT_CONFIG', '请填写用户名。');
  const sameAccount = previous?.url === url && previous.auth === auth && previous.username === username;
  const secret = (auth === 'apikey' ? String(input.apiKey || '').trim() : String(input.password || '')) ||
    (sameAccount ? (auth === 'apikey' ? previous.apiKey : previous.password) : '');
  if (!secret) throw new AppError('QBT_CONFIG', auth === 'apikey' ? '请填写 API Key。' : '请填写密码。');
  if (secret.length > 1024 || /\u0000/.test(secret) || (auth === 'apikey' && /[^\x21-\x7e]/.test(secret))) {
    throw new AppError('QBT_CONFIG', '认证信息格式无效。');
  }
  return { name, url, auth, username, ...(auth === 'apikey' ? { apiKey: secret } : { password: secret }) };
}

export function publicDownloader(config) {
  return { id: config.id, revision: config.revision, name: config.name, url: config.url,
    auth: config.auth, username: config.username, hasSecret: Boolean(config.apiKey || config.password) };
}

export function downloadPath(value) {
  const path = String(value || '').trim();
  if (path.length > 1024 || /[\u0000-\u001f\u007f]/.test(path) ||
      !(/^\//.test(path) || /^[a-z]:[\\/]/i.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path))) {
    throw new AppError('QBT_PATH', '请输入下载器上的完整目录路径。');
  }
  return path;
}

export function resolveLocation(location = { kind: 'default' }, metadata) {
  if (location.kind === 'default') return { choice: { kind: 'default' }, fields: { savepath: metadata.defaultPath, autoTMM: 'false' } };
  if (location.kind === 'category') {
    const category = metadata.categories.find(item => item.name === location.name);
    if (!category) throw new AppError('QBT_PATH', '分类已变更，请重新选择目录。');
    // qBittorrent resolves relative paths and inherited subcategory paths itself.
    return { choice: { kind: 'category', name: category.name }, fields: { category: category.name, autoTMM: 'true' } };
  }
  if (location.kind === 'path') {
    const path = downloadPath(location.path);
    return { choice: { kind: 'path', path }, fields: { savepath: path, autoTMM: 'false' } };
  }
  throw new AppError('QBT_PATH', '请选择下载目录。');
}

const HEADER_ENDPOINTS = [
  ['auth/login', 'post'],
  ['app/defaultSavePath', 'get'],
  ['app/getDirectoryContent\\?dirPath=[^&#]*&mode=dirs', 'get'],
  ['torrents/categories', 'get'],
  ['torrents/add', 'post'],
  ['torrents/delete', 'post'],
  ['torrents/info\\?filter=(all|downloading|completed)&sort=added_on&reverse=true&limit=51&offset=[0-9]+', 'get'],
  ['torrents/info\\?hashes=[a-f0-9]+', 'get']
];
export const QBT_HEADER_RULE_IDS = Object.freeze(HEADER_ENDPOINTS.map((_, index) => 23001 + index));

// Chrome limits each compiled RE2 expression to 2 KB. Keep endpoints in separate
// rules, scoped to this extension, the exact configured base URL and HTTP method.
export function passwordHeaderRules(config, extensionId) {
  const base = downloaderUrl(config.url);
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return HEADER_ENDPOINTS.map(([endpoint, method], index) => ({
    id: QBT_HEADER_RULE_IDS[index], priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [
      { header: 'Origin', operation: 'set', value: new URL(base).origin },
      { header: 'Referer', operation: 'set', value: `${base}/` },
      { header: 'Sec-Fetch-Site', operation: 'set', value: 'same-origin' }
    ] },
    condition: { regexFilter: `^${escaped}/api/v2/${endpoint}$`,
      initiatorDomains: [extensionId], resourceTypes: ['xmlhttprequest'],
      requestMethods: [method], isUrlFilterCaseSensitive: true }
  }));
}

export class QBittorrent {
  constructor(config, { fetchFn = (...args) => fetch(...args), canAccess = async () => true, timeout = 20000 } = {}) {
    this.config = { ...config, ...validateDownloader(config) };
    this.fetchFn = fetchFn; this.canAccess = canAccess; this.timeout = timeout;
  }

  async request(endpoint, { body, query, json = false, submission = false, deletion = false, timeout = this.timeout } = {}) {
    if (!await this.canAccess(downloaderPermission(this.config.url))) {
      throw new AppError('QBT_PERMISSION', '请在设置中编辑并保存此下载器，授权访问。');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const headers = this.config.auth === 'apikey' ? { Authorization: `Bearer ${this.config.apiKey}` } : {};
      const search = query ? `?${new URLSearchParams(query)}` : '';
      const response = await this.fetchFn(`${this.config.url}/api/v2/${endpoint}${search}`, {
        method: body ? 'POST' : 'GET', body, headers, signal: controller.signal,
        credentials: this.config.auth === 'apikey' ? 'omit' : 'include',
        redirect: 'manual', cache: 'no-store', referrerPolicy: 'no-referrer'
      });
      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        throw new AppError('QBT_REDIRECT', '下载器地址发生跳转，请填写最终 URL。');
      }
      if ([401, 403].includes(response.status)) throw new AppError('QBT_AUTH',
        this.config.auth === 'apikey' ? '认证失败，请检查 API Key 和版本（需 5.2+）。' : '认证失败，请检查账号、密码及 WebUI 访问设置。');
      if (response.status === 404) throw new AppError('QBT_URL', '未找到 qBittorrent 接口，请检查 URL。');
      if (!response.ok) throw new AppError(submission || deletion ? 'QBT_UNCERTAIN' : 'QBT_HTTP',
        deletion ? '删除结果未知，请到下载器中确认。' : submission ? '提交未获确认，请先到下载器中查看。' : '下载器请求失败，请稍后重试。');
      const text = await response.text();
      if (!json) return text.trim();
      try { return JSON.parse(text); } catch { throw new AppError('QBT_RESPONSE', '下载器返回了无效数据，请检查 URL。'); }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(submission || deletion ? 'QBT_UNCERTAIN' : 'QBT_NETWORK',
        deletion ? '删除结果未知，请到下载器中确认。' : submission ? '提交结果未知，请先到下载器中查看。' : '无法连接下载器，请检查地址、网络和证书。');
    } finally { clearTimeout(timer); }
  }

  async login() {
    if (this.config.auth === 'apikey') return;
    const reply = await this.request('auth/login', { body: new URLSearchParams({ username: this.config.username, password: this.config.password }) });
    if (reply !== 'Ok.') throw new AppError('QBT_AUTH', '登录失败，请检查用户名和密码。');
  }

  async locations() {
    const [path, raw] = await Promise.all([
      this.request('app/defaultSavePath'),
      this.request('torrents/categories', { json: true })
    ]);
    if (!raw || Array.isArray(raw) || typeof raw !== 'object') throw new AppError('QBT_RESPONSE', '无法读取下载器分类。');
    const defaultPath = downloadPath(path);
    const categories = Object.entries(raw).filter(([name, value]) =>
      name && name.length <= 256 && value && typeof value.savePath === 'string' && value.savePath.length <= 1024
    ).map(([name, value]) => ({ name, path: value.savePath })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return { defaultPath, categories };
  }

  async directories(path) {
    const directory = downloadPath(path);
    let raw;
    try {
      raw = await this.request('app/getDirectoryContent', {
        query: { dirPath: directory, mode: 'dirs' }, json: true, timeout: Math.min(this.timeout, 8000)
      });
    } catch (error) {
      // A missing directory or an older server without this endpoint has no remote suggestions.
      if (error.code === 'QBT_URL') return [];
      throw error;
    }
    if (!Array.isArray(raw)) throw new AppError('QBT_RESPONSE', '无法读取目录。');
    return [...new Set(raw.filter(path => {
      if (typeof path !== 'string') return false;
      try { downloadPath(path); return true; } catch { return false; }
    }))];
  }

  async add(url, fields) {
    // Only a freshly minted, validated M-Team URL can be handed to a downloader.
    const body = new FormData();
    for (const [key, value] of Object.entries({ urls: mteamUrl(url).href, ...fields, stopped: 'false', paused: 'false' })) body.set(key, value);
    const reply = await this.request('torrents/add', { body, submission: true });
    if (reply === 'Fails.') throw new AppError('QBT_ADD', '下载器未接受此资源。');
    if (reply !== 'Ok.') throw new AppError('QBT_UNCERTAIN', '提交未获确认，请先到下载器中查看。');
    return { submitted: true };
  }

  async tasks(options) {
    const raw = await this.request('torrents/info', { query: taskQuery(options), json: true });
    if (!Array.isArray(raw)) throw new AppError('QBT_RESPONSE', '无法读取下载任务。');
    return { items: raw.slice(0, TASK_PAGE_SIZE).map(normalizeTask), hasMore: raw.length > TASK_PAGE_SIZE };
  }

  async deleteTask(hash, expected) {
    const id = taskHash(hash);
    // Recheck the exact task immediately before deletion. A changed name, path or
    // re-added torrent must be reviewed again, never deleted from a stale row.
    const raw = await this.request('torrents/info', { query: { hashes: id }, json: true });
    if (!Array.isArray(raw)) throw new AppError('QBT_RESPONSE', '无法确认下载任务。');
    if (!raw.length) throw new AppError('QBT_TASK_GONE', '任务已不存在，请刷新列表。');
    if (raw.length !== 1) throw new AppError('QBT_TASK_CHANGED', '任务已变更，请刷新后重新确认。');
    const current = normalizeTask(raw[0]);
    if (current.hash !== id || !sameTask(current, expected)) {
      throw new AppError('QBT_TASK_CHANGED', '任务已变更，请刷新后重新确认。');
    }
    const result = await this.request('torrents/delete', {
      body: new URLSearchParams({ hashes: id, deleteFiles: 'true' }), deletion: true
    });
    if (result !== '') throw new AppError('QBT_UNCERTAIN', '删除未获确认，请到下载器中查看。');
    return { requested: true };
  }
}
