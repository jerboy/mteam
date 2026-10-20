import { AppError, torrentId } from './core.js';
import { QBittorrent, downloadPath, publicDownloader, resolveLocation, validateDownloader } from './qbittorrent.js';

export function createDownloaders({ storage, makeLink, qbtOptions = {}, prepare = async () => {}, cleanup = async () => {} }) {
  // Serialize credential changes and cookie sessions, including multiple instances
  // on the same hostname. Never retry a submission whose outcome is uncertain.
  let queue = Promise.resolve();
  let authenticatedIdentity = '';
  const pending = new Set();
  function serial(task) {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  }
  async function read() {
    const saved = await storage.get(['downloaders', 'downloaderPrefs']);
    return { items: saved.downloaders || [], prefs: saved.downloaderPrefs || { locations: {} } };
  }
  function selected(items, id, revision) {
    const config = items.find(item => item.id === id);
    if (!config) throw new AppError('QBT_CONFIG', '下载器已移除，请重新选择。');
    if (revision && revision !== config.revision) throw new AppError('QBT_CHANGED', '下载器配置已更新，请重新打开下载面板。');
    return config;
  }
  async function connected(config, task, reuseSession = false) {
    const client = new QBittorrent(config, qbtOptions);
    const identity = `${config.id}:${config.revision}`;
    try {
      await prepare(config);
      const reused = reuseSession && config.auth === 'password' && authenticatedIdentity === identity;
      if (!reused) {
        await client.login();
        if (config.auth === 'password') authenticatedIdentity = identity;
      }
      try { return await task(client); }
      catch (error) {
        if (!reused || error.code !== 'QBT_AUTH') throw error;
        authenticatedIdentity = '';
        await client.login();
        authenticatedIdentity = identity;
        return await task(client);
      }
    } catch (error) {
      if (config.auth === 'password') authenticatedIdentity = '';
      throw error;
    } finally { await cleanup().catch(() => {}); }
  }
  async function run(message) {
    const { items, prefs } = await read();
    switch (message.type) {
      case 'downloaders.list':
        return { items: items.map(publicDownloader), lastId: prefs.lastId || '' };
      case 'downloaders.save': {
        const input = message.downloader || {};
        const previous = input.id ? selected(items, input.id, input.revision) : undefined;
        const validated = validateDownloader(input, previous);
        const entry = { ...validated, id: previous?.id || crypto.randomUUID(), revision: crypto.randomUUID() };
        if (previous) items[items.indexOf(previous)] = entry;
        else items.push(entry);
        if (previous && previous.url !== entry.url) delete (prefs.locations || {})[entry.id];
        await storage.set({ downloaders: items, downloaderPrefs: prefs });
        return publicDownloader(entry);
      }
      case 'downloaders.remove': {
        selected(items, message.downloaderId, message.revision);
        delete (prefs.locations || {})[message.downloaderId];
        if (prefs.lastId === message.downloaderId) delete prefs.lastId;
        await storage.set({ downloaders: items.filter(item => item.id !== message.downloaderId), downloaderPrefs: prefs });
        return { removed: true };
      }
      case 'downloaders.locations':
      case 'downloaders.test': {
        const config = selected(items, message.downloaderId, message.revision);
        const metadata = await connected(config, client => client.locations());
        const saved = prefs.locations?.[config.id] || {};
        let last = saved.last || { kind: 'default' };
        try { resolveLocation(last, metadata); } catch { last = { kind: 'default' }; }
        return { ...metadata, last, recentPaths: saved.paths || [], revision: config.revision };
      }
      case 'downloaders.directories': {
        const config = selected(items, message.downloaderId, message.revision);
        const directory = downloadPath(message.directory);
        return connected(config, client => client.directories(directory), true);
      }
      case 'downloaders.send': {
        const id = torrentId(message.id);
        const config = selected(items, message.downloaderId, message.revision);
        return connected(config, async client => {
          const metadata = await client.locations();
          const { fields, choice } = resolveLocation(message.location, metadata);
          const url = await makeLink(id);
          await client.add(url, fields);
          const saved = prefs.locations?.[config.id] || {};
          prefs.lastId = config.id;
          prefs.locations ||= {};
          prefs.locations[config.id] = { last: choice, paths: choice.kind === 'path'
            ? [choice.path, ...(saved.paths || []).filter(path => path !== choice.path)].slice(0, 5)
            : saved.paths || [] };
          // A local preference-write failure must not turn an accepted download
          // into an apparent failure and encourage the user to submit it again.
          await storage.set({ downloaderPrefs: prefs }).catch(() => {});
          return { submitted: true, name: config.name };
        });
      }
      default: throw new AppError('INPUT', '不支持的下载器操作。');
    }
  }
  return message => {
    if (message.type !== 'downloaders.send') return serial(() => run(message));
    const key = `${message.downloaderId}:${message.id}`;
    if (pending.has(key)) return Promise.reject(new AppError('QBT_BUSY', '此资源正在提交。'));
    pending.add(key);
    return serial(() => run(message)).finally(() => pending.delete(key));
  };
}
