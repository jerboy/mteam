import test from 'node:test';
import assert from 'node:assert/strict';
import { packageEntry, releaseVersion } from '../release-config.mjs';

const manifest = { manifest_version: 3, version: '1.3.3' };
test('release tag must match every manifest and package version', () => {
  assert.equal(releaseVersion(manifest, [{ version: '1.3.3' }], 'v1.3.3'), '1.3.3');
  assert.equal(releaseVersion(manifest, [{ version: '1.3.3' }]), '1.3.3');
  assert.throws(() => releaseVersion(manifest, [{ version: '1.3.2' }]));
  for (const tag of ['v1.3.4', '1.3.3', 'v1.3.3-beta', 'v1.3.3\ninjected']) {
    assert.throws(() => releaseVersion(manifest, [], tag));
  }
});

test('release filenames cannot contain invalid versions or path segments', () => {
  for (const version of [undefined, '2.0.0', '1.03.3', '1.3.3-beta', '1.65536.0', '../escape']) {
    assert.throws(() => releaseVersion({ ...manifest, version }, []));
  }
  assert.throws(() => releaseVersion({ ...manifest, manifest_version: 2 }, []));
});

test('release archive includes runtime files and excludes credentials, tests and local artifacts', () => {
  for (const path of ['', 'lib', 'icons', 'background.js', 'path-picker.js', 'popup.html', 'downloaders.css',
    'manifest.json', 'README.md', 'lib/path-completion.js', 'icons/128.png']) assert.equal(packageEntry(path), true, path);
  for (const path of ['.env', '.env.local', '.DS_Store', 'private.key', 'config.json', 'package.json', 'tests',
    'tests/core.test.js', 'node_modules', 'node_modules/lib.js', 'lib/.env', 'icons/private.txt',
    'artifacts/screenshot.png', 'legacy', '../secret.js']) assert.equal(packageEntry(path), false, path);
});
