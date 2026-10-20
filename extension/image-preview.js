import { contentUrl } from './lib/content-url.js';

export function createImagePreview(document) {
  const dialog = document.getElementById('image-dialog');
  const stage = document.getElementById('image-stage');
  const status = document.getElementById('image-status');
  const close = document.getElementById('close-image');
  let current = null;
  let returnFocus = null;

  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    const previous = current;
    current = null;
    previous?.removeAttribute('src');
    stage.replaceChildren();
    stage.removeAttribute('aria-busy');
    status.hidden = true;
    if (returnFocus?.isConnected && !returnFocus.disabled) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  });

  return {
    open(value, label = '图片预览', trigger = document.activeElement) {
      const url = contentUrl(value);
      if (!url) return false;
      const previous = current;
      const img = document.createElement('img');
      current = img;
      previous?.removeAttribute('src');
      if (!dialog.open) returnFocus = trigger;
      img.alt = label || '图片预览';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.hidden = true;
      status.textContent = '加载中…';
      status.hidden = false;
      stage.setAttribute('aria-busy', 'true');
      img.addEventListener('load', () => {
        if (current !== img) return;
        img.hidden = false;
        status.hidden = true;
        stage.removeAttribute('aria-busy');
      }, { once: true });
      img.addEventListener('error', () => {
        if (current !== img) return;
        img.hidden = true;
        status.textContent = '图片加载失败';
        status.hidden = false;
        stage.removeAttribute('aria-busy');
      }, { once: true });
      stage.replaceChildren(img);
      if (!dialog.open) dialog.showModal();
      close.focus({ preventScroll: true });
      img.src = url;
      return true;
    }
  };
}
