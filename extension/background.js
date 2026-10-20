import { safeError } from './lib/core.js';
import { createService } from './lib/service.js';
import { createQbtSession } from './lib/qbt-session.js';

// There are no content scripts or externally_connectable entrypoints.
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
const qbtSession = createQbtSession(chrome);
const handle = createService({
  storage: chrome.storage.local, downloads: chrome.downloads, alarms: chrome.alarms,
  openTab: options => chrome.tabs.create(options), getURL: path => chrome.runtime.getURL(path),
  apiOptions: { canAccess: origin => chrome.permissions.contains({ origins: [`${origin}/*`] }) },
  qbtOptions: { canAccess: origin => chrome.permissions.contains({ origins: [origin] }) },
  prepareQbt: config => qbtSession.prepare(config),
  cleanupQbt: () => qbtSession.cleanup()
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const allowed = ['popup.html', 'options.html'].map(path => chrome.runtime.getURL(path));
  const senderPage = String(sender.url || '').split('?')[0].split('#')[0];
  if (sender.id !== chrome.runtime.id || !allowed.includes(senderPage)) return false;
  if (((message?.type?.startsWith('config.') && message.type !== 'config.status') ||
    ['activity.configure', 'downloaders.save', 'downloaders.remove'].includes(message?.type)) && senderPage !== chrome.runtime.getURL('options.html')) {
    respond({ ok: false, error: { code: 'FORBIDDEN', message: '请通过设置页修改配置。' } }); return false;
  }
  handle(message).then(data => respond({ ok: true, data }), error => respond({ ok: false, error: safeError(error) }));
  return true;
});

// MV3 workers can stop at any time. Alarms and pending verification are restored from local state.
chrome.alarms?.onAlarm.addListener(alarm => { handle.onAlarm(alarm).catch(() => {}); });
chrome.runtime.onStartup?.addListener(() => { handle.reconcile().catch(() => {}); });
chrome.runtime.onInstalled?.addListener(() => { handle.reconcile().catch(() => {}); });
handle.reconcile().catch(() => {});
