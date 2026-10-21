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
  Object.defineProperty(document, 'activeElement', { get: () => focused });
  trigger.focus = () => { focused = trigger; };
  get('close-image').focus = () => { focused = get('close-image'); };
  get('image-zoom').focus = () => { focused = get('image-zoom'); };
  // Native dialog state is simulated; these unit tests never open a browser.
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; showCount++; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new Event('close')); };
  const stage = get('image-stage');
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 360 });
  let captured = null;
  stage.setPointerCapture = id => { captured = id; };
  stage.hasPointerCapture = id => captured === id;
  stage.releasePointerCapture = () => { captured = null; };
  const emit = (node, type, properties = {}) => {
    const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), properties);
    node.dispatchEvent(event);
    return event;
  };
  const load = (width = 1280, height = 720) => {
    const img = stage.firstElementChild;
    Object.defineProperties(img, { naturalWidth: { value: width }, naturalHeight: { value: height } });
    emit(img, 'load');
    return img;
  };
  const preview = createImagePreview(document);
  return { document, Event, get, dialog, trigger, preview, emit, load, captured: () => captured,
    focused: () => focused, showCount: () => showCount };
}

const images = [1, 2, 3].map(number => ({ url: `https://example.org/${number}.jpg`, label: `图片 ${number}` }));
function transform(img) {
  const match = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(img.style.transform);
  assert.ok(match, img.style.transform);
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
}

test('image preview opens an isolated modal and returns focus when closed', () => {
  const { get, dialog, trigger, preview, Event, focused } = fixture();
  get('link-dialog').open = true;
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
  assert.equal(get('link-dialog').open, true);
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

test('gallery starts on the clicked image and cycles with buttons or arrow keys', () => {
  const { preview, get, trigger, emit, dialog, focused } = fixture();
  preview.open(images[1].url, images[1].label, trigger, [null, ...images, images[1], { url: 'javascript:alert(1)' }]);
  assert.equal(get('image-count').textContent, '2 / 3');
  assert.equal(get('image-previous').hidden, false);
  emit(get('image-next'), 'click');
  assert.equal(get('image-stage').firstElementChild.src, images[2].url);
  const obsolete = get('image-stage').firstElementChild;
  const key = emit(dialog, 'keydown', { key: 'ArrowRight' });
  assert.equal(key.defaultPrevented, true);
  assert.equal(get('image-count').textContent, '1 / 3');
  emit(obsolete, 'error');
  assert.equal(get('image-status').textContent, '加载中…');
  emit(get('image-previous'), 'click');
  assert.equal(get('image-count').textContent, '3 / 3');
  emit(dialog, 'keydown', { key: 'ArrowLeft' });
  assert.equal(get('image-count').textContent, '2 / 3');
  emit(dialog, 'keydown', { key: 'ArrowRight', altKey: true });
  assert.equal(get('image-count').textContent, '2 / 3');
  emit(get('image-stage').firstElementChild, 'error');
  emit(dialog, 'keydown', { key: 'ArrowRight' });
  assert.equal(get('image-status').textContent, '加载中…');
  dialog.close();
  assert.equal(focused(), trigger);
});

test('single-image controls stay hidden and another resource replaces the previous gallery', () => {
  const { preview, get, trigger, emit, dialog } = fixture();
  preview.open(images[0].url, 'first', trigger, images);
  preview.open('https://example.org/other.jpg', 'other');
  assert.equal(get('image-count').hidden, true);
  assert.equal(get('image-previous').hidden, true);
  assert.equal(get('image-next').hidden, true);
  const current = get('image-stage').firstElementChild;
  emit(dialog, 'keydown', { key: 'ArrowRight' });
  assert.equal(get('image-stage').firstElementChild, current);
  dialog.close();
  assert.equal(get('image-stage').childNodes.length, 0);
  preview.open(images[2].url, 'third', trigger, images);
  assert.equal(get('image-count').textContent, '3 / 3');
});

test('wheel zoom anchors to the cursor, prevents page zoom, and stays between fit and 8x', () => {
  const { preview, get, trigger, emit, load } = fixture();
  preview.open(images[0].url, 'first', trigger);
  const img = load();
  const stage = get('image-stage');
  const wheel = emit(stage, 'wheel', { deltaY: -100, deltaMode: 0, clientX: 480, clientY: 180, ctrlKey: true });
  assert.equal(wheel.defaultPrevented, true);
  const actual = transform(img);
  assert.ok(Math.abs(actual.zoom - Math.exp(.2)) < 1e-9);
  assert.ok(Math.abs(actual.x - (160 - 160 * actual.zoom)) < 1e-9);
  assert.equal(actual.y, 0);
  assert.equal(get('image-zoom').hidden, false);
  for (let i = 0; i < 30; i++) emit(stage, 'wheel', { deltaY: -240, deltaMode: 0 });
  assert.equal(transform(img).zoom, 8);
  for (let i = 0; i < 30; i++) emit(stage, 'wheel', { deltaY: 240, deltaMode: 0 });
  assert.deepEqual(transform(img), { x: 0, y: 0, zoom: 1 });
  assert.equal(get('image-zoom').hidden, true);
});

test('line and page wheel units, keyboard zoom, double-click and percent reset are supported', () => {
  const { preview, get, trigger, emit, load, dialog, focused } = fixture();
  preview.open(images[0].url, 'first', trigger);
  const stage = get('image-stage');
  emit(stage, 'wheel', { deltaY: -100 }); // Loading images cannot be zoomed.
  const img = load();
  assert.equal(transform(img).zoom, 1);
  emit(stage, 'wheel', { deltaY: -1, deltaMode: 1 });
  assert.ok(Math.abs(transform(img).zoom - Math.exp(.032)) < 1e-9);
  emit(stage, 'dblclick');
  assert.equal(transform(img).zoom, 1);
  emit(stage, 'wheel', { deltaY: -1, deltaMode: 2 });
  assert.ok(transform(img).zoom > 1.5);
  get('image-zoom').focus();
  emit(get('image-zoom'), 'click');
  assert.equal(focused(), get('close-image'));
  emit(dialog, 'keydown', { key: '+' });
  assert.equal(transform(img).zoom, 1.25);
  emit(dialog, 'keydown', { key: '-' });
  assert.equal(transform(img).zoom, 1);
  emit(dialog, 'keydown', { key: '=' });
  emit(dialog, 'keydown', { key: '0' });
  assert.deepEqual(transform(img), { x: 0, y: 0, zoom: 1 });
  emit(stage, 'wheel', { deltaY: NaN });
  assert.equal(transform(img).zoom, 1);
});

test('zoomed images pan within their edges and release pointer capture on navigation and close', () => {
  const { preview, get, trigger, emit, load, captured, dialog } = fixture();
  preview.open(images[0].url, 'first', trigger, images);
  const img = load();
  const stage = get('image-stage');
  emit(dialog, 'keydown', { key: '+' });
  emit(stage, 'pointerdown', { pointerId: 7, button: 0, clientX: 320, clientY: 180 });
  assert.equal(captured(), 7);
  emit(stage, 'pointermove', { pointerId: 8, clientX: 10000, clientY: 10000 });
  assert.equal(transform(img).x, 0);
  emit(stage, 'pointermove', { pointerId: 7, clientX: 10000, clientY: -10000 });
  assert.deepEqual(transform(img), { x: 80, y: -45, zoom: 1.25 });
  emit(get('image-next'), 'click');
  assert.equal(captured(), null);
  assert.equal(get('image-zoom').hidden, true);
  const next = load();
  assert.deepEqual(transform(next), { x: 0, y: 0, zoom: 1 });
  emit(dialog, 'keydown', { key: '+' });
  emit(stage, 'pointerdown', { pointerId: 9, button: 0, clientX: 300, clientY: 100 });
  emit(stage, 'pointercancel', { pointerId: 9 });
  assert.equal(captured(), null);
  emit(stage, 'pointerdown', { pointerId: 10, button: 0, clientX: 300, clientY: 100 });
  dialog.close();
  assert.equal(captured(), null);
  assert.equal(stage.classList.contains('dragging'), false);
});

test('small images remain centered until scaled beyond the viewport and resize reclamps the pan', () => {
  const { preview, get, trigger, emit, load, dialog, document } = fixture();
  preview.open(images[0].url, 'first', trigger);
  const img = load(80, 60);
  const stage = get('image-stage');
  emit(stage, 'wheel', { deltaY: -200, clientX: 500, clientY: 300 });
  assert.equal(transform(img).x, 0);
  assert.equal(transform(img).y, 0);
  for (let i = 0; i < 20; i++) emit(dialog, 'keydown', { key: '+' });
  emit(stage, 'pointerdown', { pointerId: 1, button: 0, clientX: 320, clientY: 180 });
  emit(stage, 'pointermove', { pointerId: 1, clientX: 500, clientY: 500 });
  assert.deepEqual(transform(img), { x: 0, y: 60, zoom: 8 });
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  emit(document.defaultView, 'resize');
  assert.deepEqual(transform(img), { x: 0, y: 0, zoom: 8 });
});
