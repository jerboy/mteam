import { copyFile, mkdir } from 'node:fs/promises';

// Keep the MV3 runtime self-contained; npm dependencies are only used in development.
await mkdir('extension/vendor', { recursive: true });
await copyFile('node_modules/marked/lib/marked.esm.js', 'extension/vendor/marked.js');
await copyFile('node_modules/marked/LICENSE', 'extension/vendor/marked.LICENSE.md');
