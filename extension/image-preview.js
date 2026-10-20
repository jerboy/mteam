import { contentUrl } from './lib/content-url.js';

export function createImagePreview(document) {
  const dialog = document.getElementById('image-dialog');
  const stage = document.getElementById('image-stage');
  const status = document.getElementById('image-status');
  const close = document.getElementById('close-image');
  const previousButton = document.getElementById('image-previous');
  const nextButton = document.getElementById('image-next');
  const count = document.getElementById('image-count');
  const zoomButton = document.getElementById('image-zoom');
  let current = null;
  let returnFocus = null;
  let gallery = [];
  let index = 0;
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  let drag = null;

  function geometry() {
    const rect = stage.getBoundingClientRect();
    const width = current?.naturalWidth || 0, height = current?.naturalHeight || 0;
    const fit = width && height ? Math.min(1, rect.width / width, rect.height / height) : 0;
    return { rect, width: width * fit, height: height * fit };
  }

  function paint() {
    const { rect, width, height } = geometry();
    const limitX = Math.max(0, (width * zoom - rect.width) / 2);
    const limitY = Math.max(0, (height * zoom - rect.height) / 2);
    pan.x = Math.max(-limitX, Math.min(limitX, pan.x));
    pan.y = Math.max(-limitY, Math.min(limitY, pan.y));
    if (current) current.style.transform = `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    stage.classList.toggle('zoomed', zoom > 1);
    if (zoom === 1 && dialog.open && document.activeElement === zoomButton) close.focus({ preventScroll: true });
    zoomButton.hidden = zoom === 1;
    zoomButton.textContent = `${Math.round(zoom * 100)}%`;
  }

  function stopDrag() {
    const previous = drag;
    drag = null;
    stage.classList.remove('dragging');
    if (previous && stage.hasPointerCapture?.(previous.id)) stage.releasePointerCapture(previous.id);
  }

  function resetZoom() {
    stopDrag();
    zoom = 1;
    pan = { x: 0, y: 0 };
    paint();
  }

  function changeZoom(value, clientX, clientY) {
    if (!current || current.hidden || !dialog.open) return;
    const next = Math.max(1, Math.min(8, value));
    const { rect } = geometry();
    const x = Number.isFinite(clientX) ? clientX - rect.left - rect.width / 2 : 0;
    const y = Number.isFinite(clientY) ? clientY - rect.top - rect.height / 2 : 0;
    // Keep the point under the pointer stationary, then constrain the image edges.
    pan = { x: x - (x - pan.x) * next / zoom, y: y - (y - pan.y) * next / zoom };
    zoom = next;
    stopDrag();
    paint();
  }

  function showImage() {
    const previous = current;
    const img = document.createElement('img');
    current = img;
    previous?.removeAttribute('src');
    resetZoom();
    const item = gallery[index];
    img.alt = item.label;
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.draggable = false;
    img.hidden = true;
    status.textContent = '加载中…';
    status.hidden = false;
    stage.setAttribute('aria-busy', 'true');
    count.textContent = `${index + 1} / ${gallery.length}`;
    count.hidden = previousButton.hidden = nextButton.hidden = gallery.length < 2;
    img.addEventListener('load', () => {
      if (current !== img || !dialog.open) return;
      img.hidden = false;
      status.hidden = true;
      stage.removeAttribute('aria-busy');
      paint();
    }, { once: true });
    img.addEventListener('error', () => {
      if (current !== img || !dialog.open) return;
      img.hidden = true;
      status.textContent = '图片加载失败';
      status.hidden = false;
      stage.removeAttribute('aria-busy');
    }, { once: true });
    stage.replaceChildren(img);
    img.src = item.url;
  }

  function move(offset) {
    if (!dialog.open || gallery.length < 2) return;
    index = (index + offset + gallery.length) % gallery.length;
    showImage();
  }

  close.addEventListener('click', () => dialog.close());
  previousButton.addEventListener('click', () => move(-1));
  nextButton.addEventListener('click', () => move(1));
  zoomButton.addEventListener('click', resetZoom);
  stage.addEventListener('dblclick', resetZoom);
  stage.addEventListener('wheel', event => {
    if (!dialog.open) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? geometry().rect.height : 1;
    const delta = Math.max(-240, Math.min(240, event.deltaY * unit));
    if (Number.isFinite(delta) && delta) changeZoom(zoom * Math.exp(-delta * .002), event.clientX, event.clientY);
  }, { passive: false });
  stage.addEventListener('pointerdown', event => {
    if (!dialog.open || !current || current.hidden || zoom === 1 || event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, pan: { ...pan } };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    pan = { x: drag.pan.x + event.clientX - drag.x, y: drag.pan.y + event.clientY - drag.y };
    paint();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    stage.addEventListener(type, event => { if (drag?.id === event.pointerId) stopDrag(); });
  }
  dialog.addEventListener('keydown', event => {
    if (!dialog.open || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') move(event.key === 'ArrowLeft' ? -1 : 1);
    else if (event.key === '+' || event.key === '=') changeZoom(zoom * 1.25);
    else if (event.key === '-') changeZoom(zoom / 1.25);
    else if (event.key === '0') resetZoom();
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  document.defaultView.addEventListener('resize', () => { if (dialog.open) { stopDrag(); paint(); } });
  dialog.addEventListener('close', () => {
    if (dialog.open) return; // Ignore an older queued close event after reopening.
    const previous = current;
    current = null;
    gallery = [];
    resetZoom();
    previous?.removeAttribute('src');
    stage.replaceChildren();
    stage.removeAttribute('aria-busy');
    status.hidden = true;
    count.hidden = previousButton.hidden = nextButton.hidden = true;
    if (returnFocus?.isConnected && !returnFocus.disabled) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  });

  return {
    open(value, label = '图片预览', trigger = document.activeElement, images = []) {
      const url = contentUrl(value);
      if (!url) return false;
      const unique = new Map();
      for (const item of Array.isArray(images) ? images : []) {
        const safe = contentUrl(item?.url);
        if (safe && !unique.has(safe)) unique.set(safe, { url: safe, label: String(item.label || '图片预览') });
      }
      unique.set(url, { url, label: String(label || '图片预览') });
      gallery = [...unique.values()];
      index = gallery.findIndex(item => item.url === url);
      if (!dialog.open) returnFocus = trigger;
      if (!dialog.open) dialog.showModal();
      showImage();
      close.focus({ preventScroll: true });
      return true;
    }
  };
}
