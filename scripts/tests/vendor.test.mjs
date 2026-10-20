import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('bundled Markdown parser and license match the pinned dependency', async () => {
  for (const [source, bundled] of [
    ['node_modules/marked/lib/marked.esm.js', 'extension/vendor/marked.js'],
    ['node_modules/marked/LICENSE', 'extension/vendor/marked.LICENSE.md']
  ]) {
    assert.deepEqual(await readFile(source), await readFile(bundled), `${bundled}: run npm run vendor after changing Marked`);
  }
});
