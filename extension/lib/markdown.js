import { Marked } from '../vendor/marked.js';
import { contentUrl } from './content-url.js';
import { lexBBCode, bbcodeColor, bbcodeSize } from './bbcode.js';

const markdown = new Marked({ gfm: true, breaks: true });
const blockElements = new Set(['BLOCKQUOTE', 'PRE', 'UL', 'OL', 'DETAILS', 'DIV', 'P', 'H3', 'H4', 'H5', 'H6', 'HR']);

// M-Team descriptions use BBCode first; Markdown is a fallback for other content.
// Site-provided HTML is never inserted into the DOM.
export function renderMarkdown(target, value, { onPreview = () => {} } = {}) {
  const document = target.ownerDocument;
  const source = String(value || '').slice(0, 30000);
  const entityDecoder = document.createElement('span');
  const gallery = [];
  function decode(text = '') {
    return String(text ?? '').replace(/&(?:#[xX][\da-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z\d]{1,31});/g, entity => {
      // This sink accepts a single character reference, never markup or attributes.
      entityDecoder.innerHTML = entity;
      return entityDecoder.textContent;
    });
  }
  function element(tag, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function children(tokens = [], literal = false) {
    const fragment = document.createDocumentFragment();
    for (const token of tokens) fragment.append(render(token, literal));
    return fragment;
  }
  function plainText(tokens = []) {
    return tokens.map(token => token.tokens ? plainText(token.tokens) :
      ['escape', 'codespan', 'html'].includes(token.type) ? token.text : decode(token.text || '')).join('');
  }
  function wrapInline(tag, content) {
    // BBCode may nest block tags inside inline styles. Keep valid DOM structure.
    const result = document.createDocumentFragment();
    let wrapper = element(tag);
    const flush = () => {
      if (tag === 'p') {
        while (wrapper.firstChild?.nodeName === 'BR') wrapper.firstChild.remove();
        while (wrapper.lastChild?.nodeName === 'BR') wrapper.lastChild.remove();
      }
      if (wrapper.childNodes.length) result.append(wrapper);
      wrapper = element(tag);
    };
    for (const child of [...content.childNodes]) {
      if (blockElements.has(child.nodeName)) { flush(); result.append(child); }
      else wrapper.append(child);
    }
    flush();
    return result;
  }
  function linkTo(url, content, title = '') {
    if (!url || content.querySelector('a, button, input, details, summary')) return content;
    const link = element('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.referrerPolicy = 'no-referrer';
    if (title) link.title = title;
    link.append(content);
    return link;
  }
  function image(token) {
    const label = plainText(token.tokens) || decode(token.text) || '简介图片';
    const url = contentUrl(decode(token.href));
    if (!url) return document.createTextNode(token.type === 'bbcode' ? token.raw : label);
    const button = element('button');
    button.type = 'button';
    button.className = 'description-image';
    button.title = '预览图片';
    button.setAttribute('aria-label', `预览图片：${label}`);
    const img = element('img');
    img.alt = label;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      button.disabled = true;
      button.classList.add('image-failed');
      button.textContent = '图片加载失败';
      button.removeAttribute('title');
      button.setAttribute('aria-label', `图片加载失败：${label}`);
    }, { once: true });
    gallery.push({ url, label, trigger: button });
    button.addEventListener('click', () => {
      if (!button.disabled) onPreview(url, label, button, gallery.filter(item => !item.trigger.disabled));
    });
    img.src = url;
    button.append(img);
    return button;
  }
  function bbcode(token) {
    const value = decode(token.value);
    const inlineTag = { b: 'strong', i: 'em', u: 'u', s: 'del', strike: 'del', del: 'del', sub: 'sub', sup: 'sup' }[token.tag];
    if (inlineTag) return wrapInline(inlineTag, children(token.tokens));
    if (['code', 'pre', 'nfo', 'mediainfo'].includes(token.tag)) {
      const pre = element('pre'); pre.append(element('code', token.text)); return pre;
    }
    if (token.tag === 'img') return image({ ...token, href: token.text.trim(), text: '简介图片' });
    if (token.tag === 'br' || token.tag === 'hr') return element(token.tag);
    if (token.tag === 'url') return linkTo(contentUrl(decode(token.value || token.text.trim())), children(token.tokens));
    if (token.tag === 'quote') {
      const quote = element('blockquote');
      if (value) {
        const author = element('cite', value);
        author.className = 'bbcode-author'; quote.append(author);
      }
      quote.append(children(token.tokens)); return quote;
    }
    if (['list', 'ul', 'ol'].includes(token.tag)) {
      const ordered = token.tag === 'ol' || (token.tag === 'list' && /^(?:\d{1,6}|[aAiI])$/.test(value));
      const list = element(ordered ? 'ol' : 'ul');
      if (ordered && /^[aAiI]$/.test(value)) list.setAttribute('type', value);
      if (ordered && /^\d{1,6}$/.test(value)) list.setAttribute('start', String(Math.max(1, Number(value))));
      for (const tokens of token.items) {
        const li = element('li'); li.append(children(tokens)); list.append(li);
      }
      return list;
    }
    if (token.tag === 'spoiler' || token.tag === 'hide') {
      const details = element('details');
      details.className = 'bbcode-spoiler';
      details.append(element('summary', value || '展开内容'), children(token.tokens));
      return details;
    }
    if (['left', 'center', 'right', 'align', 'li'].includes(token.tag)) {
      const container = element('div');
      const align = token.tag === 'align' ? value.toLowerCase() : token.tag;
      if (['left', 'center', 'right', 'justify'].includes(align)) container.style.textAlign = align;
      container.append(children(token.tokens)); return container;
    }
    const content = wrapInline('span', children(token.tokens));
    for (const span of content.childNodes) {
      if (span.nodeName !== 'SPAN') continue;
      if (token.tag === 'color' && bbcodeColor(value)) span.style.color = bbcodeColor(value);
      if (token.tag === 'size' && bbcodeSize(value)) span.style.fontSize = bbcodeSize(value);
      if (token.tag === 'font' && /^(?:courier(?: new)?|consolas|monospace)$/i.test(value)) span.className = 'bbcode-monospace';
    }
    return content;
  }
  function render(token, literal = false) {
    const group = tag => {
      const node = element(tag);
      node.append(children(token.tokens, literal));
      return node;
    };
    switch (token.type) {
      case 'space': case 'def': return document.createTextNode('');
      case 'heading': return group(`h${Math.min(token.depth + 2, 6)}`);
      case 'paragraph': return wrapInline('p', children(token.tokens, literal));
      case 'blockquote': return group('blockquote');
      case 'strong': case 'em': case 'del': return wrapInline(token.type, children(token.tokens, literal));
      case 'br': case 'hr': return element(token.type);
      case 'text': return token.tokens ? children(token.tokens, literal) : document.createTextNode(literal ? token.text : decode(token.text));
      case 'escape': case 'html': return document.createTextNode(token.text);
      case 'codespan': return element('code', token.text);
      case 'code': {
        const pre = element('pre');
        pre.append(element('code', token.text));
        return pre;
      }
      case 'checkbox': {
        const checkbox = element('input');
        checkbox.type = 'checkbox';
        checkbox.disabled = true;
        checkbox.checked = token.checked;
        checkbox.setAttribute('aria-label', token.checked ? '已完成' : '未完成');
        return checkbox;
      }
      case 'list': {
        const list = element(token.ordered ? 'ol' : 'ul');
        if (token.ordered) list.setAttribute('start', String(token.start));
        for (const item of token.items) {
          const li = element('li');
          if (item.task) li.className = 'task-list-item';
          li.append(children(item.tokens));
          list.append(li);
        }
        return list;
      }
      case 'table': {
        const scroll = element('div');
        scroll.className = 'markdown-table';
        scroll.tabIndex = 0;
        scroll.setAttribute('role', 'region');
        scroll.setAttribute('aria-label', '表格');
        const table = element('table');
        const row = (cells, header = false) => {
          const tr = element('tr');
          for (const cell of cells) {
            const td = element(header ? 'th' : 'td');
            if (header) td.setAttribute('scope', 'col');
            if (['left', 'center', 'right'].includes(cell.align)) td.style.textAlign = cell.align;
            td.append(children(cell.tokens));
            tr.append(td);
          }
          return tr;
        };
        const head = element('thead'); head.append(row(token.header, true));
        const body = element('tbody');
        for (const cells of token.rows) body.append(row(cells));
        table.append(head, body); scroll.append(table);
        return scroll;
      }
      case 'link': {
        const content = children(token.tokens, Boolean(token.autolink));
        const url = contentUrl(token.autolink ? token.href : decode(token.href));
        return linkTo(url, content, decode(token.title));
      }
      case 'image': return image(token);
      case 'bbcode': return bbcode(token);
      case 'bbtext': {
        const text = element('span', token.text);
        text.className = 'bbcode-text';
        return text;
      }
      default: return document.createTextNode(token.raw || '');
    }
  }
  try {
    target.replaceChildren(source.trim() ? children(lexBBCode(source) ?? markdown.lexer(source)) : element('p', '暂无简介'));
  } catch {
    // A malformed or excessively nested description must not prevent opening details.
    const fallback = element('pre', source || '暂无简介');
    fallback.className = 'markdown-fallback';
    target.replaceChildren(fallback);
  }
}
