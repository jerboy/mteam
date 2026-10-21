import { torrentId } from './core.js';

export function isAppView(search = globalThis.location?.search || '') {
  return new URLSearchParams(search).get('view') === 'app';
}

export function detailPath(id, search) {
  return `detail.html?id=${torrentId(id)}${isAppView(search) ? '&view=app' : ''}`;
}

export function searchPath(search) {
  return `popup.html?view=${isAppView(search) ? 'app' : 'tab'}`;
}

export function openSettings({ location = globalThis.location, runtime = globalThis.chrome.runtime } = {}) {
  if (isAppView(location?.search)) location.assign(runtime.getURL('options.html?view=app'));
  else return runtime.openOptionsPage();
}
