export const API_ORIGINS = ['https://api.m-team.cc', 'https://api.m-team.io'];
export const DEFAULT_CONFIG = { apiOrigin: API_ORIGINS[0], siteOrigin: 'https://kp.m-team.cc', pageSize: 20 };
export const MODES = ['normal', 'movie', 'tvshow', 'anime', 'music', 'all', 'adult'];
export const SORT_FIELDS = ['CREATED_DATE', 'SEEDERS', 'SIZE', 'TIMES_COMPLETED', 'LEECHERS', 'NAME'];
export const DISCOUNTS = ['NORMAL', 'PERCENT_70', 'PERCENT_50', 'FREE', '_2X_FREE', '_2X', '_2X_PERCENT_50'];

export class AppError extends Error {
  constructor(code, message, retryAfterSeconds) { super(message); this.name = 'AppError'; this.code = code; this.retryAfterSeconds = retryAfterSeconds; }
}

export function mteamUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new AppError('BAD_URL', '站点返回了无效链接。'); }
  const validHost = ['m-team.cc', 'm-team.io'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
  if (!validHost || url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new AppError('BAD_URL', '只接受 M-Team 官方域名的 HTTPS 链接。');
  }
  return url;
}

export function validateConfig(input) {
  const config = { ...DEFAULT_CONFIG, ...input };
  if (!API_ORIGINS.includes(config.apiOrigin)) throw new AppError('CONFIG', '请选择受支持的 API 域名。');
  const site = mteamUrl(config.siteOrigin);
  if (site.pathname !== '/' || site.search || site.hash) throw new AppError('CONFIG', '站点地址仅填写域名，例如 https://kp.m-team.cc。');
  config.siteOrigin = site.origin;
  config.apiKey = String(config.apiKey || '').trim();
  if (/[^\x21-\x7e]/.test(config.apiKey) || config.apiKey.length > 512) throw new AppError('CONFIG', 'API Key 格式无效。');
  config.pageSize = Number(config.pageSize);
  if (![20, 50, 100].includes(config.pageSize)) throw new AppError('CONFIG', '每页条数应为 20、50 或 100。');
  return config;
}

export function torrentId(value) {
  const id = String(value ?? '');
  if (!/^[1-9]\d{0,18}$/.test(id)) throw new AppError('INPUT', '资源 ID 无效。');
  return id;
}

export function searchPayload(input = {}, pageSize = 20) {
  const keyword = String(input.keyword || '').trim();
  if (keyword.length > 100) throw new AppError('INPUT', '关键词不能超过 100 个字符。');
  const pageNumber = Number(input.pageNumber ?? 1);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 1000) throw new AppError('INPUT', '页码应在 1–1000 之间。');
  const mode = input.mode || 'normal';
  const sortField = input.sortField || 'CREATED_DATE';
  const sortDirection = input.sortDirection || 'DESC';
  if (!MODES.includes(mode) || !SORT_FIELDS.includes(sortField) || !['ASC', 'DESC'].includes(sortDirection)) {
    throw new AppError('INPUT', '搜索筛选项无效。');
  }
  const categories = input.category ? [Number(torrentId(input.category))] : [];
  if (categories.some(id => !Number.isSafeInteger(id))) throw new AppError('INPUT', '分类 ID 无效。');
  const result = { keyword, mode, categories, pageNumber, pageSize, sortField, sortDirection };
  if (input.discount) {
    if (!DISCOUNTS.includes(input.discount)) throw new AppError('INPUT', '促销筛选项无效。');
    result.discount = input.discount;
  }
  if (input.onlyFav) result.onlyFav = true;
  return result;
}

export function safeError(error) {
  if (error instanceof AppError) return { code: error.code, message: error.message, ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) };
  return { code: 'INTERNAL', message: '操作失败，请重试或重新打开扩展。' };
}

export class MTeamApi {
  constructor(config, { fetchFn = (...args) => globalThis.fetch(...args), canAccess = async () => true, minInterval = 1600, timeout = 20000, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
    this.config = validateConfig(config);
    this.fetchFn = fetchFn;
    this.canAccess = canAccess;
    this.minInterval = minInterval;
    this.timeout = timeout;
    this.now = now;
    this.sleep = sleep;
    this.nextAt = 0;
    this.cooldownUntil = 0;
    this.queue = Promise.resolve();
    this.cache = new Map();
    this.inflight = new Map();
  }

  request(path, data = {}, { json = false, ttl = 0, fresh = false } = {}) {
    // Each instance belongs to one credential configuration; caches never cross accounts.
    const cacheKey = `${path}:${JSON.stringify(data)}`;
    const hit = this.cache.get(cacheKey);
    if (!fresh && hit && hit.expires > this.now()) return Promise.resolve(hit.data);
    if (fresh) this.cache.delete(cacheKey);
    if (this.inflight.has(cacheKey)) return this.inflight.get(cacheKey);
    const run = this.queue.then(async () => {
      if (!this.config.apiKey) throw new AppError('NO_KEY', '请先在设置中填写 M-Team API Key。');
      if (!await this.canAccess(this.config.apiOrigin)) throw new AppError('PERMISSION', `未获准访问 ${new URL(this.config.apiOrigin).hostname}，请在扩展详情中允许站点访问。`);
      if (this.now() < this.cooldownUntil) throw new AppError('RATE_LIMIT', '请求过于频繁，请稍后重试。', Math.ceil((this.cooldownUntil - this.now()) / 1000));
      const wait = this.nextAt - this.now();
      if (wait > 0) await this.sleep(wait);
      this.nextAt = this.now() + this.minInterval;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        let response;
        try {
          response = await this.fetchFn(`${this.config.apiOrigin}/api${path}`, {
            method: 'POST',
            headers: { 'x-api-key': this.config.apiKey, Accept: 'application/json', 'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: json ? JSON.stringify(data) : new URLSearchParams(data).toString(),
            credentials: 'omit', redirect: 'manual', cache: 'no-store', signal: controller.signal
          });
        } catch {
          throw new AppError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK', controller.signal.aborted ? '连接超时。' : `无法连接 ${new URL(this.config.apiOrigin).hostname}。`);
        }
        if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) throw new AppError('REDIRECT', `${new URL(this.config.apiOrigin).hostname} 返回了重定向，请切换 API 域名或检查网络。`);
        if (response.status === 401 || response.status === 403) throw new AppError('AUTH', '认证失败或访问被拒绝。请检查 API Key、账号权限和网络。');
        if (response.status === 429) {
          const header = response.headers.get('retry-after');
          const retry = /^\d+$/.test(header || '') ? Number(header) : (Date.parse(header) - this.now()) / 1000;
          this.cooldownUntil = this.now() + Math.max(60, Number.isFinite(retry) ? retry : 60) * 1000;
          throw new AppError('RATE_LIMIT', '请求过于频繁，请稍后重试。', Math.ceil((this.cooldownUntil - this.now()) / 1000));
        }
        if (!response.ok) throw new AppError('HTTP', `API 暂时不可用（HTTP ${response.status}）。`);
        let envelope;
        try { envelope = await response.json(); } catch { throw new AppError('FORMAT', 'API 未返回 JSON，可能被网络验证页面拦截。'); }
        if (!envelope || typeof envelope !== 'object' || !Object.hasOwn(envelope, 'code')) throw new AppError('FORMAT', 'API 响应结构异常。');
        if (String(envelope.code) !== '0') {
          const code = String(envelope.code);
          if (['401', '403'].includes(code)) throw new AppError('AUTH', 'API Key 无效或没有访问权限。');
          if (code === '429') {
            this.cooldownUntil = this.now() + 60000;
            throw new AppError('RATE_LIMIT', '请求过于频繁，请稍后重试。');
          }
          // Do not echo remote messages, which may contain credentials or token URLs.
          const label = /^-?\d{1,10}$/.test(code) ? `（代码 ${code}）` : '';
          throw new AppError('API', `M-Team 拒绝了请求${label}。请检查账号权限、资源状态及筛选条件。`);
        }
        if (ttl) {
          if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value);
          this.cache.set(cacheKey, { data: envelope.data, expires: this.now() + ttl });
        }
        return envelope.data;
      } finally { clearTimeout(timer); }
    });
    this.queue = run.catch(() => {});
    this.inflight.set(cacheKey, run);
    run.finally(() => this.inflight.delete(cacheKey)).catch(() => {});
    return run;
  }

  async categories() {
    const data = await this.request('/torrent/categoryList', {}, { ttl: 3600000 });
    const list = Array.isArray(data) ? data : (data?.data ?? data?.list);
    if (!Array.isArray(list)) throw new AppError('FORMAT', '分类列表格式异常。');
    return list.filter(x => x && /^\d+$/.test(String(x.id))).map(x => ({ id: String(x.id), name: String(x.name || x.nameChs || x.nameCht || x.id), mode: String(x.mode || '') }));
  }

  async search(input, { fresh = false } = {}) {
    const payload = searchPayload(input, this.config.pageSize);
    const data = await this.request('/torrent/search', payload, { json: true, ttl: 30000, fresh });
    const items = Array.isArray(data) ? data : (data?.data ?? data?.list ?? data?.records);
    if (!Array.isArray(items)) throw new AppError('FORMAT', '搜索结果格式异常。');
    const count = Number(data?.total ?? data?.totalCount);
    return { items: items.map(normalizeTorrent), total: Number.isFinite(count) ? count : null, pageNumber: payload.pageNumber, pageSize: payload.pageSize };
  }

  async detail(id) {
    const data = await this.request('/torrent/detail', { id: torrentId(id), origin: 'WEB' }, { ttl: 60000 });
    if (!data || typeof data !== 'object') throw new AppError('FORMAT', '资源详情格式异常。');
    return normalizeTorrent(data);
  }

  async link(id) {
    const data = await this.request('/torrent/genDlToken', { id: torrentId(id) });
    const value = typeof data === 'string' ? data : (data?.url ?? data?.downloadUrl);
    return mteamUrl(value).href;
  }

  async profile() {
    const data = await this.request('/member/profile');
    if (!data || typeof data !== 'object') throw new AppError('FORMAT', '账号信息格式异常。');
    const value = data.memberStatus?.lastBrowse;
    return { lastWebBrowse: typeof value === 'string' ? value.slice(0, 80) : null };
  }
}

export function normalizeTorrent(item = {}) {
  const status = item.status || {};
  return {
    id: torrentId(item.id), name: String(item.name || '未命名资源'), subtitle: String(item.smallDescr || ''),
    size: String(item.size || 0), seeders: Number(status.seeders ?? item.seeders) || 0,
    leechers: Number(status.leechers ?? item.leechers) || 0, completed: Number(status.timesCompleted ?? item.timesCompleted) || 0,
    discount: String(status.discount || 'NORMAL'), discountEndTime: String(status.discountEndTime || ''),
    category: String(item.category?.id ?? item.category ?? ''), createdDate: String(item.createdDate || ''),
    description: String(item.descr || item.description || '').slice(0, 30000),
    imdb: String(item.imdb || ''), douban: String(item.douban || ''),
    posterUrl: posterUrl(item.imageList)
  };
}

export function posterUrl(images) {
  if (!Array.isArray(images)) return '';
  for (const value of images) {
    if (typeof value !== 'string' || !value.trim()) continue;
    try {
      const url = new URL(value.trim());
      if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
    } catch { /* Missing and malformed artwork uses the same quiet placeholder. */ }
  }
  return '';
}

export function safeFilename(name, id) {
  const base = String(name || id).normalize('NFKC').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0,140);
  return `${base || 'M-Team'}-${torrentId(id)}.torrent`;
}

export function formatSize(value) {
  let n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toLocaleString('en-US', { maximumFractionDigits: i ? 2 : 0 })} ${units[i]}`;
}
