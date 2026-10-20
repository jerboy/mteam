import { AppError, MTeamApi, safeFilename, torrentId, validateConfig } from './core.js';
import { createActivity } from './activity.js';
import { createDownloaders } from './downloaders.js';

export function createService({ storage, downloads, openTab, getURL, alarms, apiOptions = {}, qbtOptions = {}, prepareQbt, cleanupQbt, now }) {
  let currentConfig;
  let api;
  async function configuredApi() {
    const config = validateConfig((await storage.get('config')).config || {});
    const identity = JSON.stringify(config);
    if (identity !== currentConfig) { api = new MTeamApi(config, apiOptions); currentConfig = identity; }
    return api;
  }
  const activity = createActivity({ storage, alarms, openTab, now, readProfile: async () => (await configuredApi()).profile() });
  const downloaders = createDownloaders({ storage, qbtOptions, prepare: prepareQbt, cleanup: cleanupQbt,
    makeLink: async id => (await configuredApi()).link(id) });
  const handle = async function handle(message) {
    if (!message || typeof message.type !== 'string') throw new AppError('INPUT', '操作类型无效。');
    if (message.type.startsWith('downloaders.')) return downloaders(message);
    switch (message.type) {
      case 'config.status': {
        const saved = await storage.get(['config', 'configRevision']);
        const config = validateConfig(saved.config || {});
        const { apiKey, ...publicConfig } = config;
        return { ...publicConfig, configured: Boolean(apiKey), revision: saved.configRevision || '' };
      }
      case 'config.save': {
        // Only the settings page sends a key; no message response ever returns it.
        const config = validateConfig(message.config || {});
        if (!config.apiKey) throw new AppError('CONFIG', '请填写 API Key。');
        await storage.set({ config, configRevision: crypto.randomUUID() });
        await activity.reset();
        currentConfig = undefined; api = undefined;
        return { saved: true };
      }
      case 'config.clear': {
        await storage.remove(['config', 'configRevision']); currentConfig = undefined; api = undefined;
        await activity.reset();
        return { cleared: true };
      }
      case 'test': {
        const categories = await (await configuredApi()).categories();
        return { connected: true, categoryCount: categories.length };
      }
      case 'categories': return (await configuredApi()).categories();
      case 'search': return (await configuredApi()).search(message.query, { fresh: Boolean(message.fresh) });
      case 'activity.status': return activity.status();
      case 'activity.configure': return activity.configure(message.preferences);
      case 'activity.check': return { ...await activity.status(), ...await (await configuredApi()).profile() };
      case 'activity.visit': return activity.visit();
      case 'detail': return (await configuredApi()).detail(message.id);
      case 'link': return { url: await (await configuredApi()).link(message.id) };
      case 'download': {
        const id = torrentId(message.id);
        const url = await (await configuredApi()).link(id);
        let downloadId;
        try { downloadId = await downloads.download({ url, filename: safeFilename(message.name, id), saveAs: true, conflictAction: 'uniquify' }); }
        catch { throw new AppError('DOWNLOAD', '浏览器未开始下载，可能已取消保存。你也可以复制链接到下载器。'); }
        return { downloadId };
      }
      case 'open.detail': {
        const client = await configuredApi();
        const url = `${client.config.siteOrigin}/detail/${torrentId(message.id)}`;
        await openTab({ url }); return { opened: true };
      }
      case 'open.dashboard': await openTab({ url: getURL('popup.html?view=tab') }); return { opened: true };
      default: throw new AppError('INPUT', '不支持的操作。');
    }
  };
  handle.onAlarm = activity.onAlarm;
  handle.reconcile = activity.reconcile;
  return handle;
}
