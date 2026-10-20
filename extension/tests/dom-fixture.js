// Minimal in-memory DOM for event-handler unit tests; no browser or network.
export class Element {
  constructor(tagName = 'div', id = '') {
    Object.assign(this, { tagName, id, listeners: {}, attributes: {}, children: [], value: '', hidden: false,
      open: false, disabled: false, readOnly: false, classList: { toggle() {} } });
  }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  async emit(type, props = {}) {
    const event = { defaultPrevented: false, propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; }, ...props };
    for (const callback of this.listeners[type] || []) await callback(event);
    return event;
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  contains(element) { return element === this || this.children.some(child => child.contains?.(element)); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) {
    this.children = children;
    if (this.tagName === 'select') this.value = children[0]?.value || '';
  }
  showModal() { this.open = true; }
  close() { this.open = false; return this.emit('close'); }
  focus() {
    if (document.activeElement === this) return;
    document.activeElement?.emit('blur');
    document.activeElement = this;
    this.emit('focus');
  }
  setSelectionRange(start, end) { this.selection = [start, end]; }
  scrollIntoView(options) { this.scrolled = options; }
}

export function mockDocument(t) {
  const previous = { document: globalThis.document, Option: globalThis.Option };
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, new Element(['send-downloader', 'send-location', 'tasks-downloader', 'tasks-filter'].includes(id) ? 'select' : 'div', id));
    return elements.get(id);
  };
  globalThis.document = Object.assign(new Element('document'), {
    getElementById: get, createElement: tag => new Element(tag), activeElement: null, visibilityState: 'visible'
  });
  globalThis.Option = class { constructor(label, value) { this.label = label; this.value = value; } };
  t.after(() => Object.assign(globalThis, previous));
  return get;
}
