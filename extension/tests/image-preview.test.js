import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { createImagePreview } from '../image-preview.js';
import { createPoster } from '../lib/poster.js';

function fixture() {
  const { document, Event } = parseHTML(readFileSync(new URL('../popup.html', import.meta.url), 'utf8'));
  const get = id => document.getElementById(id);
  const dialog = get('image-dialog');
  const trigger = document.createElement('button');
  document.body.append(trigger);
  let focused = null;
  let showCount = 0;
  trigger.focus = () => { focused = trigger; };
  get('close-image').focus = () => { focused = get('close-image'); };
  // Native dialog state is simulated; these unit tests never open a browser.
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; showCount++; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new Event('close')); };
  const preview = createImagePreview(document);
  return { document, Event, get, dialog, trigger, preview, focused: () => focused, showCount: () => showCount };
}

test('image preview opens an isolated modal and returns focus when closed', () => {
  const { get, dialog, trigger, preview, Event, focused } = fixture();
  get('detail-dialog').open = true;
  assert.equal(preview.open('https://example.org/a.png', '海报', trigger), true);
  assert.equal(dialog.open, true);
  assert.equal(focused(), get('close-image'));
  assert.equal(get('image-stage').getAttribute('aria-busy'), 'true');
  const img = get('image-stage').querySelector('img');
  assert.equal(img.src, 'https://example.org/a.png');
  assert.equal(img.alt, '海报');
  assert.equal(img.referrerPolicy, 'no-referrer');
  img.dispatchEvent(new Event('load'));
  assert.equal(img.hidden, false);
  assert.equal(get('image-status').hidden, true);
  assert.equal(get('image-stage').getAttribute('aria-busy'), null);
  get('close-image').dispatchEvent(new Event('click'));
  assert.equal(dialog.open, false);
  assert.equal(get('detail-dialog').open, true);
  assert.equal(focused(), trigger);
  assert.equal(img.getAttribute('src'), null);
  assert.equal(get('image-stage').childNodes.length, 0);
});

test('new images reset loading and ignore obsolete load/error events', () => {
  const { preview, get, trigger, Event, showCount, dialog } = fixture();
  preview.open('https://example.org/first.jpg', 'first', trigger);
  const first = get('image-stage').firstElementChild;
  preview.open('https://example.org/second.jpg', 'second');
  const second = get('image-stage').firstElementChild;
  assert.equal(first.getAttribute('src'), null);
  assert.equal(showCount(), 1);
  first.dispatchEvent(new Event('error'));
  assert.equal(get('image-status').textContent, '加载中…');
  second.dispatchEvent(new Event('error'));
  assert.equal(get('image-status').textContent, '图片加载失败');
  assert.equal(get('image-stage').getAttribute('aria-busy'), null);
  assert.equal(second.hidden, true);
  // Closing via native Esc/backdrop emits the same close event as the button.
  dialog.close();
  second.dispatchEvent(new Event('load'));
  assert.equal(get('image-stage').childNodes.length, 0);
  assert.equal(get('image-status').hidden, true);
});

test('preview rejects unsafe sources before opening or creating an image', () => {
  const { preview, dialog, get, showCount } = fixture();
  for (const url of ['javascript:alert(1)', 'data:image/svg+xml,test', 'file:///tmp/a.png', '/options.html', 'https://user:secret@example.org/a']) {
    assert.equal(preview.open(url), false);
  }
  assert.equal(dialog.open, false);
  assert.equal(showCount(), 0);
  assert.equal(get('image-stage').querySelector('img'), null);
});

test('poster buttons preview the actual artwork and disable after a loading error', () => {
  const { document, Event } = fixture();
  const calls = [];
  const poster = createPoster(document, 'https://example.org/poster.jpg', { label: '资源', onPreview: (...args) => calls.push(args) });
  assert.equal(poster.tagName, 'BUTTON');
  assert.equal(poster.getAttribute('aria-hidden'), null);
  assert.equal(poster.getAttribute('aria-label'), '预览海报：资源');
  const img = poster.querySelector('img');
  img.dispatchEvent(new Event('load'));
  assert.ok(poster.classList.contains('has-poster'));
  poster.dispatchEvent(new Event('click'));
  assert.deepEqual(calls[0], ['https://example.org/poster.jpg', '资源', poster]);
  img.dispatchEvent(new Event('error'));
  assert.equal(poster.disabled, true);
  assert.equal(poster.querySelector('img'), null);
  poster.dispatchEvent(new Event('click'));
  assert.equal(calls.length, 1);
  for (const url of ['', 'javascript:alert(1)']) {
    const placeholder = createPoster(document, url, { onPreview: () => assert.fail('placeholder cannot preview') });
    assert.equal(placeholder.tagName, 'DIV');
    assert.equal(placeholder.querySelector('img'), null);
  }
});
