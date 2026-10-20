import { Lexer } from '../vendor/marked.js';
import { contentUrl } from './content-url.js';

// Only tokenize Markdown. Site-provided HTML is never inserted into the DOM.
export function renderMarkdown(target, value, { onPreview = () => {} } = {}) {
  const document = target.ownerDocument;
  const source = String(value || '').slice(0, 30000);
  const entityDecoder = document.createElement('span');
  function decode(text = '') {
    return text.replace(/&(?:#[xX][\da-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z\d]{1,31});/g, entity => {
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
  function image(token) {
    const label = plainText(token.tokens) || decode(token.text) || '简介图片';
    const url = contentUrl(decode(token.href));
    if (!url) return document.createTextNode(label);
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
    button.addEventListener('click', () => { if (!button.disabled) onPreview(url, label, button); });
    img.src = url;
    button.append(img);
    return button;
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
      case 'paragraph': return group('p');
      case 'blockquote': return group('blockquote');
      case 'strong': case 'em': case 'del': return group(token.type);
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
        // Linked images use the preview action, avoiding nested interactive controls.
        if (!url || content.querySelector('button')) return content;
        const link = element('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.referrerPolicy = 'no-referrer';
        if (token.title) link.title = decode(token.title);
        link.append(content);
        return link;
      }
      case 'image': return image(token);
      default: return document.createTextNode(token.raw || '');
    }
  }
  try {
    target.replaceChildren(source.trim() ? children(Lexer.lex(source, { gfm: true, breaks: true })) : element('p', '暂无简介'));
  } catch {
    // A malformed or excessively nested description must not prevent opening details.
    const fallback = element('pre', source || '暂无简介');
    fallback.className = 'markdown-fallback';
    target.replaceChildren(fallback);
  }
}
