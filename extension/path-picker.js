import { PathCompletion } from './lib/path-completion.js';

export function createPathPicker({ input, menu, list, feedback, status, retry, fetchDirectories, enabled = () => true, onChange = () => {}, timing = {} }) {
  let paths = [], activeIndex = -1, composing = false;
  const available = () => enabled() && !input.disabled && !input.readOnly && !composing;
  const completion = new PathCompletion({ ...timing, fetchDirectories, onSuggestions: render });

  function highlight(index, scroll = false) {
    activeIndex = index;
    for (const [i, option] of [...list.children].entries()) option.setAttribute('aria-selected', String(i === index));
    const option = list.children[index];
    if (option) {
      input.setAttribute('aria-activedescendant', option.id);
      if (scroll) option.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  function render(next, state = {}) {
    const selected = paths[activeIndex];
    paths = next;
    menu.hidden = !state.active || (!paths.length && !state.directory);
    input.setAttribute('aria-expanded', String(!menu.hidden));
    list.setAttribute('aria-busy', String(Boolean(state.loading)));
    list.replaceChildren(...paths.map((path, index) => {
      const option = document.createElement('div');
      option.id = `${list.id}-${index}`;
      option.className = 'path-option';
      option.setAttribute('role', 'option');
      option.textContent = path;
      option.title = path;
      // Keep focus in the combobox so pointer selection does not dismiss the list first.
      option.addEventListener('pointerdown', event => event.preventDefault());
      option.addEventListener('mouseenter', () => highlight(index));
      option.addEventListener('click', () => accept(index));
      return option;
    }));
    highlight(paths.length ? Math.max(0, paths.indexOf(selected)) : -1);
    feedback.hidden = menu.hidden || Boolean(paths.length && !state.failed);
    retry.hidden = !state.failed;
    const failure = ({ QBT_TIMEOUT: '读取超时', QBT_AUTH: '下载器认证失败', QBT_PERMISSION: '下载器未授权',
      QBT_NETWORK: '无法连接下载器', QBT_CHANGED: '下载器配置已变更' })[state.errorCode] || '暂时无法读取目录';
    status.textContent = state.loading ? '读取中…' : state.failed ? failure : '没有匹配目录';
  }
  function update() {
    if (available()) completion.update(input.value);
  }
  function accept(index) {
    const path = paths[index];
    if (!path || !available()) return;
    input.value = path;
    onChange(path);
    input.focus();
    input.setSelectionRange(path.length, path.length);
    completion.update(path);
  }
  input.addEventListener('input', event => {
    if (!available() || event.isComposing) return;
    onChange(input.value);
    update();
  });
  input.addEventListener('focus', update);
  input.addEventListener('click', update);
  input.addEventListener('blur', event => { if (!menu.contains(event.relatedTarget)) completion.stop(); });
  menu.addEventListener('focusout', event => {
    if (event.relatedTarget !== input && !menu.contains(event.relatedTarget)) completion.stop();
  });
  retry.addEventListener('pointerdown', event => event.preventDefault());
  retry.addEventListener('click', () => {
    if (!available()) return;
    input.focus();
    completion.retry();
  });
  input.addEventListener('compositionstart', () => { composing = true; completion.stop(); });
  input.addEventListener('compositionend', () => { composing = false; if (available()) { onChange(input.value); update(); } });
  input.addEventListener('keydown', event => {
    if (!available() || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape' && !menu.hidden) {
      event.preventDefault(); event.stopPropagation(); completion.stop();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const wasOpen = !menu.hidden && paths.length > 0;
      if (!wasOpen) update();
      if (paths.length) highlight(wasOpen
        ? (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + paths.length) % paths.length
        : event.key === 'ArrowDown' ? 0 : paths.length - 1, true);
    } else if ((event.key === 'Tab' && !event.shiftKey || event.key === 'Enter') && !menu.hidden && paths.length) {
      event.preventDefault();
      accept(Math.max(0, activeIndex));
    }
  });
  return {
    setContext: context => { composing = false; completion.setContext(context); },
    stop: () => completion.stop(),
    update
  };
}
