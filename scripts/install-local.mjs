import { cp, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

const supplied = process.argv[2], expected = process.argv[3];
if (!supplied) throw new Error('用法：npm run install:local -- /已加载的扩展目录 [原版本号]');
const target = await realpath(supplied);
const source = await realpath(resolve('extension'));
if (target === source) throw new Error('Chrome 已直接使用项目源码，无需复制。');
const previous = JSON.parse(await readFile(resolve(target, 'manifest.json'), 'utf8'));
const next = JSON.parse(await readFile(resolve(source, 'manifest.json'), 'utf8'));
if (previous.name !== 'M-Team 资源助手' || previous.manifest_version !== 3) throw new Error('目标不是 M-Team 浏览器扩展，未覆盖任何文件。');
if (expected && previous.version !== expected) throw new Error(`目标版本已变为 ${previous.version}，未覆盖；请先确认该目录的最新改动。`);
await cp(source, target, { recursive: true, force: true, filter: path => !path.endsWith('.DS_Store') });
console.log(`已同步浏览器扩展 ${next.version} 到 ${target}。在扩展管理页重新加载即可保留原 ID 与浏览器配置。`);
