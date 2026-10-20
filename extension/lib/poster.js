export function createPoster(document, url) {
  const wrapper = document.createElement('div');
  wrapper.className = 'resource-poster';
  wrapper.setAttribute('aria-hidden', 'true');
  const placeholder = document.createElement('span');
  placeholder.className = 'poster-placeholder';
  placeholder.setAttribute('data-icon', 'image');
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
  image.addEventListener('error', () => { image.remove(); wrapper.classList.remove('has-poster'); }, { once: true });
  image.src = url;
  wrapper.append(image);
  return wrapper;
}
