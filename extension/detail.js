import { $, rpc } from './lib/ui.js';
import { createDetailPage } from './detail-page.js';
import { createDownloadDialog } from './download-dialog.js';
import { createImagePreview } from './image-preview.js';
import { createLinkCopy } from './link-copy.js';

let toastTimer;
function toast(text, error = false) {
  if ($('link-dialog').open) {
    $('link-status').textContent = text; $('link-status').classList.toggle('error', error); $('link-status').hidden = false;
    return;
  }
  $('toast').textContent = text; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
}

const download = createDownloadDialog(toast);
const preview = createImagePreview(document);
const links = createLinkCopy({ document, notify: toast });
const page = createDetailPage({
  document, query: location.search, request: rpc, onPreview: preview.open,
  onDownload: download.open, onCopy: links.copy, onSettings: () => chrome.runtime.openOptionsPage(), notify: toast
});
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => {
  if (event.target !== dialog || (dialog.id === 'send-dialog' && download.isSending())) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.config || changes.configRevision)) { page.dispose(); location.reload(); }
});
page.load();
