import { contentUrl } from './content-url.js';

export function createPoster(document, value, { label = '资源海报', onPreview } = {}) {
  const url = contentUrl(value);
  const interactive = Boolean(url && onPreview);
  const wrapper = document.createElement(interactive ? 'button' : 'div');
  wrapper.className = 'resource-poster';
  if (interactive) {
    wrapper.type = 'button';
    wrapper.title = '预览海报';
    wrapper.setAttribute('aria-label', `预览海报：${label}`);
    wrapper.addEventListener('click', () => { if (!wrapper.disabled) onPreview(url, label, wrapper); });
  } else wrapper.setAttribute('aria-hidden', 'true');
  const placeholder = document.createElement('span');
  placeholder.className = 'poster-placeholder';
  placeholder.setAttribute('data-icon', 'image');
  placeholder.setAttribute('aria-hidden', 'true');
  wrapper.append(placeholder);
  if (!url) return wrapper;

  const image = document.createElement('img');
  image.alt = '';
  image.width = 44;
  image.height = 64;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  image.addEventListener('load', () => wrapper.classList.add('has-poster'), { once: true });
  image.addEventListener('error', () => {
    image.remove(); wrapper.classList.remove('has-poster');
    if (interactive) {
      wrapper.disabled = true;
      wrapper.removeAttribute('title');
      wrapper.setAttribute('aria-label', `海报加载失败：${label}`);
    }
  }, { once: true });
  image.src = url;
  wrapper.append(image);
  return wrapper;
}
