import { cp, lstat, mkdir, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

if (process.platform !== 'darwin') throw new Error('仅支持在 macOS 安装启动器。');
const source = resolve('release/M-Team 资源助手.app');
const destination = join(homedir(), 'Applications', 'M-Team 资源助手.app');
const identifier = '<string>io.github.jerboy.mteam-launcher</string>';
if (!(await readFile(join(source, 'Contents/Info.plist'), 'utf8')).includes(identifier)) throw new Error('请先运行 npm run package:launcher。');
const existing = await lstat(destination).catch(error => { if (error.code !== 'ENOENT') throw error; });
if (existing) {
  if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('目标不是应用目录，未覆盖。');
  const installed = await readFile(join(destination, 'Contents/Info.plist'), 'utf8');
  if (!installed.includes(identifier)) throw new Error('目标存在其他应用，未覆盖。');
}
await mkdir(join(homedir(), 'Applications'), { recursive: true });
// Copy the complete signed bundle. Configuration lives outside the app and survives updates.
await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
console.log(`已安装到 ${destination}。`);
