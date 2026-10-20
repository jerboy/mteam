import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { renderMarkdown } from '../lib/markdown.js';

function render(source, options) {
  // In-memory DOM only; never load a website, image, or account API.
  const { document, Event } = parseHTML('<html><body><div id="content"></div></body></html>');
  const root = document.getElementById('content');
  renderMarkdown(root, source, options);
  return { root, Event };
}

test('M-Team attribution syntax renders nested BBCode before Markdown interpretation', () => {
  const text = '[quote][b][color=Blue]转自字幕组，感谢原作者发布[/color][/b][/quote]\n' +
    '# 文件信息\n**保留星号** _保留下划线_\n    Video   : AVC\nC:\\video\\release.mkv\n' +
    '![普通文本](https://example.org/md.png)';
  const { root } = render(text);
  assert.equal(root.querySelector('blockquote strong span').style.color, 'Blue');
  assert.equal(root.querySelector('blockquote strong').textContent, '转自字幕组，感谢原作者发布');
  assert.equal(root.querySelectorAll('h3, em, img, pre').length, 0);
  assert.ok(root.textContent.endsWith(text.slice(text.indexOf('\n'))));
});

test('quotes support authors, repeated nested tags, case and line breaks', () => {
  const { root } = render('[QuOtE="作者"]第一行\n[quote]内层 [b]重点 [b]嵌套[/b][/b][/quote]尾行[/QUOTE]');
  assert.equal(root.querySelector('cite').textContent, '作者');
  assert.equal(root.querySelector('blockquote blockquote').textContent, '内层 重点 嵌套');
  assert.equal(root.querySelector('strong strong').textContent, '嵌套');
  assert.ok(root.textContent.includes('第一行\n'));
  assert.ok(root.textContent.endsWith('尾行'));
});

test('inline styles, alignment, spacing and separators keep a compact bounded presentation', () => {
  const { root } = render('[center][i]斜体[/i] [u]下划线[/u] [s]删除[/s] [sub]下标[/sub][sup]上标[/sup][/center]' +
    '[font=Courier New]  对齐   文本[/font][size=7]大字[/size][size=999%]有限大字[/size][br][hr]');
  assert.equal(root.querySelector('div').style.textAlign, 'center');
  assert.equal(root.querySelector('em').textContent, '斜体');
  assert.equal(root.querySelector('u').textContent, '下划线');
  assert.equal(root.querySelector('del').textContent, '删除');
  assert.equal(root.querySelector('sub').textContent, '下标');
  assert.equal(root.querySelector('sup').textContent, '上标');
  assert.equal(root.querySelector('.bbcode-monospace').textContent, '  对齐   文本');
  assert.equal([...root.querySelectorAll('span')].filter(span => span.style.fontSize === '20px').length, 2);
  assert.equal(root.querySelectorAll('br, hr').length, 2);
});

test('code, pre, NFO and MediaInfo contents remain literal including tag-looking text', () => {
  const body = 'Video   : AVC\n[b]not bold[/b]\n**plain**\n<img onerror=alert(1)> &amp;\n[img]https://example.org/a.png[/img]';
  for (const tag of ['code', 'pre', 'nfo', 'mediainfo']) {
    const { root } = render(`[${tag}]${body}[/${tag}]`);
    assert.equal(root.querySelector('pre code').textContent, body);
    assert.equal(root.querySelectorAll('strong,img,button,script').length, 0);
  }
});

test('BBCode raw blocks and ordinary backticks cannot prematurely close a quote', () => {
  const { root } = render('[quote]`开头 [code][/quote][b]示例[/b][/code] 结尾`[/quote]');
  assert.equal(root.querySelector('blockquote code').textContent, '[/quote][b]示例[/b]');
  assert.ok(root.querySelector('blockquote').textContent.endsWith(' 结尾`'));
});

test('lists split only their own markers and support nested lists and explicit items', () => {
  const { root } = render('[list=3][*]第一项[list][*]子项一[*]子项二[/list][*][b]第二项[/b][/*][/list]' +
    '[ul][li]甲[/li][li]乙[/li][/ul][list=A][*]字母列表[/list]');
  const ordered = root.querySelector('ol');
  assert.equal(ordered.getAttribute('start'), '3');
  assert.equal(ordered.children.length, 2);
  assert.equal(ordered.querySelectorAll('ul li').length, 2);
  assert.equal(ordered.lastElementChild.querySelector('strong').textContent, '第二项');
  assert.equal(root.children[1].textContent, '甲乙');
  assert.equal(root.querySelectorAll('ol')[1].getAttribute('type'), 'A');
});

test('safe BBCode links support label formatting without nested links or preview buttons', () => {
  const { root, Event } = render('[url]https://example.org/a[/url]' +
    '[url="https://example.org/?a=1&amp;b=2"][b]链接[/b][/url]' +
    '[url=https://example.org/outer][url=https://example.org/inner]内链[/url][/url]' +
    '[url=https://example.org/page][img]https://example.org/a.jpg[/img][/url]');
  const links = [...root.querySelectorAll('a')];
  assert.equal(links.length, 3);
  assert.equal(links[1].href, 'https://example.org/?a=1&b=2');
  assert.equal(links[1].querySelector('strong').textContent, '链接');
  assert.equal(links[2].href, 'https://example.org/inner');
  assert.equal(root.querySelectorAll('a a, a button').length, 0);
  assert.ok(root.querySelector('button img'));
  root.querySelector('button').dispatchEvent(new Event('click'));
  for (const link of links) {
    assert.equal(link.target, '_blank');
    assert.equal(link.rel, 'noopener noreferrer');
    assert.equal(link.referrerPolicy, 'no-referrer');
  }
});

test('BBCode rejects unsafe URLs, CSS and HTML attributes while retaining readable content', () => {
  const unsafe = ['javascript:alert(1)', 'jav&#x61;script:alert(1)', 'data:text/html,test',
    'https://user:secret@example.org/', 'https://example.org/&#10;path', '//example.org/a'];
  for (const url of unsafe) {
    const { root } = render(`[url=${url}][b]链接[/b][/url][img]${url}[/img]`);
    assert.equal(root.querySelectorAll('a,img,button').length, 0, url);
    assert.equal(root.querySelector('strong').textContent, '链接');
  }
  const { root } = render('[quote="<img src=x onerror=alert(1)>"]<script>alert(1)</script>[/quote]' +
    '[color=red;position:fixed]颜色[/color][size=999px;display:none]字号[/size]' +
    '[font=url(https://example.org/font)]字体[/font][align=left;position:fixed]对齐[/align]' +
    '[b onclick=alert(1)]粗体[/b]');
  assert.equal(root.querySelectorAll('img,script,[style],[onclick],[onerror]').length, 0);
  assert.ok(root.querySelector('cite').textContent.includes('<img'));
  assert.ok(root.textContent.includes('<script>alert(1)</script>'));
  assert.equal(root.querySelector('strong').textContent, '粗体');
});

test('spoilers stay collapsed and images in nested containers share the preview gallery', () => {
  const calls = [];
  const { root, Event } = render('[quote][img]https://example.org/1.jpg[/img][/quote]' +
    '[hide=截图][list][*][img]https://example.org/2.jpg[/img][/list][/hide]' +
    '[spoiler][mediainfo]Format : AVC[/mediainfo][/spoiler]', { onPreview: (...args) => calls.push(args) });
  const details = [...root.querySelectorAll('details')];
  assert.equal(details.length, 2);
  assert.ok(details.every(node => !node.hasAttribute('open')));
  assert.equal(details[0].querySelector('summary').textContent, '截图');
  assert.equal(details[1].querySelector('summary').textContent, '展开内容');
  root.querySelector('button').dispatchEvent(new Event('click'));
  assert.deepEqual(calls[0][3].map(item => item.url), ['https://example.org/1.jpg', 'https://example.org/2.jpg']);
});

test('unknown and malformed markup remains readable without invalid inline block nesting', () => {
  const { root } = render('[unknown]正文[/unknown][b]开头[quote]引用[/quote]末尾[/b][i]未闭合');
  assert.ok(root.textContent.startsWith('[unknown]正文[/unknown]'));
  assert.ok(root.textContent.endsWith('[i]未闭合'));
  assert.equal(root.querySelectorAll('strong blockquote, p blockquote').length, 0);
  assert.equal(root.querySelector('blockquote').textContent, '引用');
  const malformed = '[b]开头[list][*]条目[/b]';
  assert.equal(render(malformed).root.textContent, malformed);
});

test('excessive nesting and repeated unclosed raw tags fall back to bounded inert text', () => {
  for (const source of [
    '[quote]'.repeat(45) + '正文' + '[/quote]'.repeat(45),
    '[img]'.repeat(5000)
  ]) {
    const { root } = render(source);
    assert.equal(root.querySelector('.markdown-fallback').textContent, source);
    assert.equal(root.querySelectorAll('img,button,blockquote').length, 0);
  }
});
