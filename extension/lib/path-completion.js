import { downloadPath } from './qbittorrent.js';

const windowsPath = value => /^[a-z]:/i.test(value) || value.startsWith('\\\\') || value.startsWith('//');
const normalized = value => windowsPath(value) ? value.replaceAll('\\', '/') : value;

export function directoryValue(value) {
  const path = downloadPath(value);
  const separator = windowsPath(path) && path.includes('\\') ? '\\' : '/';
  return path.replace(windowsPath(path) ? /[\\/]+$/ : /\/+$/, '') + separator;
}

export function directoryQuery(value) {
  const path = String(value || '');
  try { downloadPath(path); } catch { return null; }
  const clean = normalized(path);
  const split = clean.lastIndexOf('/');
  const directory = clean.slice(0, split + 1);
  if (!directory || (windowsPath(path) && directory.startsWith('//') && !/^\/\/[^/]+\/[^/]+\//.test(directory))) return null;
  return directory;
}

export function pathSuggestions(value, metadata = {}, remote = []) {
  const input = String(value || '');
  const windows = windowsPath(input || metadata.defaultPath || '');
  const compare = path => windows ? normalized(path).toLocaleLowerCase() : path;
  const prefix = compare(input);
  const separator = windows && input.includes('\\') ? '\\' : '/';
  const candidates = [...remote, metadata.defaultPath, ...(metadata.recentPaths || []),
    ...(metadata.categories || []).map(category => category.path)];
  const seen = new Set();
  const matches = [];
  for (const value of candidates) {
    if (typeof value !== 'string') continue;
    try { downloadPath(value); } catch { continue; } // Relative category paths are resolved by qBittorrent, not guessed here.
    let path = normalized(value).replace(/\/+$/, '') + '/';
    const key = compare(path);
    if (seen.has(key) || !key.startsWith(prefix) || key === prefix) continue;
    seen.add(key);
    if (windows) path = path.replaceAll('/', separator);
    matches.push(path);
  }
  return matches.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
}

export class PathCompletion {
  constructor({ fetchDirectories, onSuggestions,
    setTimer = (...args) => globalThis.setTimeout(...args), clearTimer = id => globalThis.clearTimeout(id),
    setReadTimer = (...args) => globalThis.setTimeout(...args), clearReadTimer = id => globalThis.clearTimeout(id),
    now = Date.now, delay = 250, readTimeout = 10000 }) {
    Object.assign(this, { fetchDirectories, onSuggestions, setTimer, clearTimer, setReadTimer, clearReadTimer, now, delay, readTimeout });
    this.context = null; this.contextId = 0; this.cache = new Map();
    this.timer = null; this.running = null; this.pending = null; this.active = false; this.value = '';
  }

  setContext(context) {
    this.stop();
    this.context = context; this.contextId++;
    this.cache.clear();
  }

  stop() {
    this.active = false; this.pending = null;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.running?.cancel();
    this.onSuggestions([], { active: false });
  }

  cached(directory) {
    const entry = this.cache.get(directory);
    return entry && entry.expires > this.now() ? entry.paths : null;
  }

  publish() {
    if (!this.active) return;
    const directory = directoryQuery(this.value);
    const cached = this.cached(directory);
    this.onSuggestions(pathSuggestions(this.value, this.context, cached || []), {
      active: true, directory, loading: Boolean(directory && cached === null),
      failed: cached !== null && Boolean(this.cache.get(directory)?.failed),
      errorCode: cached !== null ? this.cache.get(directory)?.errorCode : ''
    });
  }

  update(value) {
    if (!this.context) return;
    this.value = value; this.active = true; this.pending = null;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.publish();
    const directory = directoryQuery(value);
    if (!directory || this.cached(directory) !== null) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.pending = { directory, contextId: this.contextId, downloaderId: this.context.downloaderId, revision: this.context.revision };
      this.drain();
    }, this.delay);
  }

  retry() {
    if (!this.active || !this.context) return;
    this.cache.delete(directoryQuery(this.value));
    this.update(this.value);
  }

  drain() {
    if (this.running || !this.pending || !this.active) return;
    const request = this.pending;
    this.pending = null;
    // Another query for the same parent may have just finished.
    if (this.cached(request.directory) !== null) { this.publish(); return; }
    const operation = {};
    this.running = operation;
    let deadline;
    const finish = ({ paths = [], error, cancelled = false } = {}) => {
      // A late response after cancellation or timeout must not overwrite a retry.
      if (this.running !== operation) return;
      this.clearReadTimer(deadline);
      this.running = null;
      try {
        if (!cancelled && request.contextId === this.contextId) {
          if (this.cache.size >= 30) this.cache.delete(this.cache.keys().next().value);
          this.cache.set(request.directory, { paths: Array.isArray(paths) ? paths : [],
            expires: this.now() + (error ? 5000 : 30000), failed: Boolean(error), errorCode: error?.code || '' });
          if (directoryQuery(this.value) === request.directory) this.publish();
        }
      } finally {
        this.drain();
      }
    };
    operation.cancel = () => finish({ cancelled: true });
    // Bound the entire extension RPC, including time spent waiting in the background queue.
    deadline = this.setReadTimer(() => finish({ error: { code: 'QBT_TIMEOUT' } }), this.readTimeout);
    try {
      Promise.resolve(this.fetchDirectories(request)).then(paths => finish({ paths }), error => finish({ error }));
    } catch (error) { finish({ error }); }
  }
}
