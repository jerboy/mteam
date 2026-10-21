import { rpc } from './lib/ui.js';

// Both search and resource pages use the same explicit link-generation action.
export function createLinkCopy({ document, request = rpc, notify, writeText = text => navigator.clipboard.writeText(text) }) {
  const get = id => document.getElementById(id);
  const dialog = get('link-dialog'), field = get('download-link'), retry = get('copy-again');
  let generation = 0;
  get('close-link').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { generation++; field.value = ''; });
  retry.addEventListener('click', async () => {
    if (retry.disabled || !dialog.open || !field.value) return;
    const current = generation;
    retry.disabled = true;
    try {
      await writeText(field.value);
      if (current !== generation) return;
      dialog.close(); notify('下载链接已复制');
    } catch {
      if (current !== generation) return;
      field.select(); notify('自动复制不可用，请选中链接后按 Ctrl/Cmd+C。', true);
    } finally { retry.disabled = false; }
  });
  return {
    async copy(item) {
      const { url } = await request('link', { id: item.id });
      try { await writeText(url); notify('下载链接已复制'); }
      catch {
        generation++;
        field.value = url; get('link-status').hidden = true;
        if (!dialog.open) dialog.showModal();
        field.select();
      }
    }
  };
}
