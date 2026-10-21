import test from 'node:test';
import assert from 'node:assert/strict';
import { detailPath, searchPath, isAppView, openSettings } from '../lib/navigation.js';

test('app navigation preserves mode and exact resource ID while regular entry points stay tab based', () => {
  assert.equal(detailPath('9007199254740993', '?view=app'), 'detail.html?id=9007199254740993&view=app');
  assert.equal(detailPath('12', ''), 'detail.html?id=12');
  assert.equal(searchPath('?id=12&view=app'), 'popup.html?view=app');
  assert.equal(searchPath('?id=12'), 'popup.html?view=tab');
  assert.equal(isAppView('?view=tab'), false);
  assert.throws(() => detailPath('../options.html', '?view=app'));
});

test('app settings use the same window and ordinary popup settings use the browser options API', async () => {
  const assigned = []; let options = 0;
  const runtime = { getURL: path => `chrome-extension://test/${path}`, async openOptionsPage() { options++; } };
  await openSettings({ runtime, location: { search: '?view=app', assign: url => assigned.push(url) } });
  assert.deepEqual(assigned, ['chrome-extension://test/options.html?view=app']); assert.equal(options, 0);
  await openSettings({ runtime, location: { search: '', assign: () => assert.fail('popup navigated') } });
  assert.equal(options, 1);
});
