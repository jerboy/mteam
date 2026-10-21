const WINDOW_KEY = 'appWindowId';
const PAGES = ['popup.html', 'detail.html', 'options.html'];

export function createAppWindow(chrome) {
  let opening;
  const root = chrome.runtime.getURL('');
  function isAppWindow(window) {
    return window?.type === 'popup' && !window.incognito && window.tabs?.length === 1 && window.tabs.every(tab => {
      try {
        const url = new URL(tab.pendingUrl || tab.url);
        return PAGES.some(page => url.href.split(/[?#]/)[0] === root + page) && url.searchParams.get('view') === 'app';
      } catch { return false; }
    });
  }
  async function openWindow() {
    const saved = (await chrome.storage.session.get(WINDOW_KEY))[WINDOW_KEY];
    let window;
    if (Number.isInteger(saved)) {
      try { window = await chrome.windows.get(saved, { populate: true }); } catch { /* Closed since last launch. */ }
    }
    if (!isAppWindow(window)) {
      window = (await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] })).find(isAppWindow);
    }
    if (window) {
      await chrome.windows.update(window.id, { focused: true, ...(window.state === 'minimized' ? { state: 'normal' } : {}) });
    } else {
      window = await chrome.windows.create({ url: root + 'popup.html?view=app', type: 'popup', width: 1080, height: 800, focused: true });
    }
    await chrome.storage.session.set({ [WINDOW_KEY]: window.id });
    return { opened: true, windowId: window.id };
  }
  return {
    open() {
      // Coalesce repeated launcher clicks, including while the worker is starting.
      if (!opening) opening = openWindow().finally(() => { opening = undefined; });
      return opening;
    },
    async closeLauncher(tabId) {
      if (!Number.isInteger(tabId)) return;
      try {
        const tab = await chrome.tabs.get(tabId);
        const url = new URL(tab.pendingUrl || tab.url);
        if (url.href.split(/[?#]/)[0] === root + 'launch.html') await chrome.tabs.remove(tabId);
      } catch { /* The user may have closed or navigated the temporary tab. */ }
    }
  };
}
