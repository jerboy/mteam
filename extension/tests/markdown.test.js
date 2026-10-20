import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { renderMarkdown } from '../lib/markdown.js';
import { contentUrl } from '../lib/content-url.js';
import { Lexer } from '../vendor/marked.js';

function render(source, options) {
  // In-memory DOM only: no browser, script execution, image loading or network.
  const { document, Event } = parseHTML('<html><body><div id="content"></div></body></html>');
  const root = document.getElementById('content');
  renderMarkdown(root, source, options);
  return { root, Event };
}

test('Markdown renders headings, emphasis, quotes, nested lists and task lists', () => {
  const { root } = render('# 简介\n\n**粗体** *斜体* ~~删除~~\n换行\n\n> 引用\n\n3. 条目\n   - 子项\n\n- [x] 已完成\n- [ ] 待完成\n\n---');
  assert.equal(root.querySelector('h3').textContent, '简介');
  assert.equal(root.querySelector('strong').textContent, '粗体');
  assert.equal(root.querySelector('em').textContent, '斜体');
  assert.equal(root.querySelector('del').textContent, '删除');
  assert.equal(root.querySelectorAll('br').length, 1);
  assert.equal(root.querySelector('blockquote').textContent, '引用');
  assert.equal(root.querySelector('ol').getAttribute('start'), '3');
  assert.equal(root.querySelector('ol ul li').textContent, '子项');
  const checkboxes = [...root.querySelectorAll('input')];
  assert.deepEqual(checkboxes.map(input => [input.type, input.checked, input.disabled]), [['checkbox', true, true], ['checkbox', false, true]]);
  assert.ok(root.querySelector('hr'));
});

test('Markdown tables scroll independently and retain alignment and inline content', () => {
  const { root } = render('| 名称 | 大小 |\n| :--- | ---: |\n| **资源** | 10 GiB |');
  assert.equal(root.querySelector('.markdown-table').getAttribute('role'), 'region');
  assert.equal(root.querySelector('th').getAttribute('scope'), 'col');
  assert.equal(root.querySelectorAll('th')[1].style.textAlign, 'right');
  assert.equal(root.querySelector('td strong').textContent, '资源');
});

test('character references decode once while code and backslash escapes remain literal', () => {
  const { root } = render('A &amp; B &copy; &#x4e2d; &lt;img&gt; &amp;lt;\n\n`&amp; <script>`\n\n```html\n<b>&amp;</b>\n```\n\n\\&copy;');
  assert.equal(root.querySelector('p').textContent, 'A & B © 中 <img> &lt;');
  assert.equal(root.querySelector('code').textContent, '&amp; <script>');
  assert.equal(root.querySelector('pre code').textContent, '<b>&amp;</b>');
  assert.equal(root.lastElementChild.textContent, '&copy;');
  assert.equal(root.querySelectorAll('img,script,b').length, 0);
});

test('safe links and references open without a referrer or opener', () => {
  const { root } = render('[站点](https://example.org/a?a=1&amp;b=2 "A &amp; B")\n\n[引用][r]\n\n[r]: http://example.org/x\n\n<https://example.org/?a=1&amp;b=2>');
  const links = [...root.querySelectorAll('a')];
  assert.equal(links.length, 3);
  assert.equal(links[0].href, 'https://example.org/a?a=1&b=2');
  assert.equal(links[0].title, 'A & B');
  assert.equal(links[1].href, 'http://example.org/x');
  assert.equal(links[2].href, 'https://example.org/?a=1&amp;b=2');
  assert.equal(links[2].textContent, 'https://example.org/?a=1&amp;b=2');
  for (const link of links) {
    assert.equal(link.target, '_blank');
    assert.equal(link.rel, 'noopener noreferrer');
    assert.equal(link.referrerPolicy, 'no-referrer');
  }
});

test('raw HTML and encoded markup are inert text, including event handlers and DOM-clobbering names', () => {
  const payloads = [
    '<script>alert(1)</script>', '<img src=x onerror=alert(1)>',
    '<svg><a href="javascript:alert(1)">x</a></svg>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<form id="detail-dialog"><input name="showModal"></form>',
    '&lt;img src=x onerror=alert(1)&gt;', '<a href="javascript:alert(1)">x</a>',
    '<style>body{display:none}</style>', '<math><mtext><img src=x></mtext></math>'
  ];
  for (const payload of payloads) {
    const { root } = render(payload);
    assert.equal(root.querySelectorAll('script,img,svg,iframe,form,input,style,math,a').length, 0, payload);
    assert.ok(root.textContent.length > 0);
  }
});

test('URL schemes, credentials and encoded protocol tricks cannot create links or images', () => {
  const unsafe = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'jav&#x61;script:alert(1)',
    'java&#x09;script:alert(1)', 'javascript&colon;alert(1)', 'data:image/svg+xml,test',
    'file:///tmp/image.png', 'blob:https://example.org/id', 'chrome-extension://id/options.html',
    'https://user:secret@example.org/a', 'https://user&#x3a;secret@example.org/a',
    '../options.html', '//example.org/a', 'https://example.org/&#10;private'];
  for (const value of unsafe) {
    const { root } = render(`[链接](${value})\n\n![图片](${value})`);
    assert.equal(root.querySelectorAll('a,img,button').length, 0, value);
    assert.ok(root.textContent.includes('链接'));
    assert.ok(root.textContent.includes('图片'));
  }
  for (const value of [null, {}, '', 'https://', 'https://user@example.org/', 'https://example.org/\npath']) assert.equal(contentUrl(value), '');
  assert.equal(contentUrl(' https://example.org/a b '), 'https://example.org/a%20b');
});

test('description images, including linked and reference images, use the shared preview action', () => {
  const previews = [];
  const { root, Event } = render('![海报 **一**](https://example.org/1.jpg)\n\n[![截图](https://example.org/2.jpg)](https://example.org/page)\n\n![参考][image]\n\n[image]: https://example.org/3.png', {
    onPreview: (...args) => previews.push(args)
  });
  const buttons = [...root.querySelectorAll('button')];
  assert.equal(buttons.length, 3);
  assert.equal(root.querySelectorAll('a button').length, 0);
  assert.equal(buttons[0].getAttribute('aria-label'), '预览图片：海报 一');
  buttons.forEach(button => button.dispatchEvent(new Event('click')));
  assert.deepEqual(previews.map(([url, label, trigger]) => [url, label, buttons.includes(trigger)]), [
    ['https://example.org/1.jpg', '海报 一', true], ['https://example.org/2.jpg', '截图', true], ['https://example.org/3.png', '参考', true]
  ]);
  for (const img of root.querySelectorAll('img')) {
    assert.equal(img.loading, 'lazy');
    assert.equal(img.referrerPolicy, 'no-referrer');
    assert.equal(img.decoding, 'async');
  }
});

test('failed description images become a quiet noninteractive placeholder', () => {
  let previews = 0;
  const { root, Event } = render('![图片](https://example.org/fail.png)', { onPreview: () => previews++ });
  const button = root.querySelector('button');
  root.querySelector('img').dispatchEvent(new Event('error'));
  assert.equal(button.textContent, '图片加载失败');
  assert.equal(button.disabled, true);
  assert.equal(root.querySelector('img'), null);
  button.dispatchEvent(new Event('click'));
  assert.equal(previews, 0);
});

test('empty and very long descriptions are bounded and replace previous resource content', () => {
  const { root } = render('**old**');
  renderMarkdown(root, '  \n  ');
  assert.equal(root.textContent, '暂无简介');
  assert.equal(root.querySelector('strong'), null);
  renderMarkdown(root, 'x'.repeat(40000));
  assert.equal(root.textContent.length, 30000);
});

test('a parser failure falls back to inert readable text instead of breaking the details dialog', t => {
  t.mock.method(Lexer, 'lex', () => { throw new RangeError('excessive nesting'); });
  const source = '<img src=x onerror=alert(1)>\n**description**';
  const { root } = render(source);
  assert.equal(root.querySelector('.markdown-fallback').textContent, source);
  assert.equal(root.querySelector('img'), null);
});

test('BBCode image tags form one ordered gallery', () => {
  const calls = [];
  const { root, Event } = render('开头 [img]https://example.org/1.jpg?x=1&amp;y=2[/img]\n\n[img]https://example.org/2.jpg[/img]\n\n[IMG=600x400]\n https://example.org/3.jpg \n[/IMG]\n\n[img width=800 height=400]https://example.org/4.jpg[/img]', {
    onPreview: (...args) => calls.push(args)
  });
  const buttons = [...root.querySelectorAll('button')];
  assert.equal(buttons.length, 4);
  assert.ok(!root.textContent.includes('[img]'));
  buttons[2].dispatchEvent(new Event('click'));
  assert.equal(calls[0][0], 'https://example.org/3.jpg');
  assert.equal(calls[0][2], buttons[2]);
  assert.deepEqual(calls[0][3].map(item => item.url), [
    'https://example.org/1.jpg?x=1&y=2', 'https://example.org/2.jpg', 'https://example.org/3.jpg', 'https://example.org/4.jpg'
  ]);
  root.querySelector('img').dispatchEvent(new Event('error'));
  buttons[1].dispatchEvent(new Event('click'));
  assert.equal(calls[1][3].length, 3);
});

test('BBCode examples in Markdown code and escaped tags do not select BBCode mode', () => {
  const tag = '[img]https://example.org/a.jpg[/img]';
  const { root } = render(`- **列表**\n\n> 引用\n\n\`${tag}\`\n\n\`\`\`text\n${tag}\n\`\`\`\n\n\\${tag}`);
  assert.equal(root.querySelectorAll('img').length, 0);
  assert.ok(root.querySelector('li strong'));
  assert.ok(root.querySelector('blockquote'));
  assert.equal(root.querySelector('code').textContent, tag);
  assert.equal(root.querySelector('pre code').textContent, tag);
  assert.equal(root.lastElementChild.textContent, tag);
});

test('unsafe or incomplete BBCode remains inert text and cannot introduce HTML or gallery entries', () => {
  for (const value of ['javascript:alert(1)', 'jav&#x61;script:alert(1)', 'data:image/svg+xml,test',
    'https://user:secret@example.org/a', 'file:///tmp/a.jpg', '<img src=x onerror=alert(1)>',
    'https://example.org/&#10;attack', '/options.html']) {
    const source = `[img]${value}[/img]`;
    const { root } = render(source);
    assert.equal(root.querySelectorAll('img,button,script').length, 0, value);
    assert.equal(root.textContent, source);
  }
  const { root } = render('[img]https://example.org/a.jpg');
  assert.equal(root.querySelector('img'), null);
});

test('BBCode accepts bracketed URLs but ignores tag attributes rather than applying HTML', () => {
  const { root } = render('[img width=99999 onerror=alert(1)]https://[2001:db8::1]/a.jpg?size[width]=100[/img]');
  const img = root.querySelector('img');
  assert.equal(img.src, 'https://[2001:db8::1]/a.jpg?size[width]=100');
  assert.equal(img.getAttribute('onerror'), null);
  assert.equal(img.getAttribute('width'), null);
});
