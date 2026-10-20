import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { packageEntry, releaseVersion } from './release-config.mjs';

const [manifest, rootPackage, extensionPackage] = await Promise.all(
  ['extension/manifest.json', 'package.json', 'extension/package.json'].map(async path => JSON.parse(await readFile(path, 'utf8')))
);
const version = releaseVersion(manifest, [rootPackage, extensionPackage],
  process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : '');
await mkdir('release', { recursive: true });
const destination = resolve(`release/mteam-extension-${version}.zip`);
const temp = await mkdtemp(join(tmpdir(), 'mteam-package-'));
try {
  await cp('extension', join(temp, 'mteam-extension'), { recursive: true,
    filter: path => packageEntry(relative(resolve('extension'), resolve(path)).split(sep).join('/')) });
  await cp('LICENSE', join(temp, 'mteam-extension', 'LICENSE'));
  await rm(destination, { force: true });
  execFileSync('zip', ['-q', '-X', '-r', destination, 'mteam-extension'], { cwd: temp });
  const hash = createHash('sha256').update(await readFile(destination)).digest('hex');
  await writeFile(`${destination}.sha256`, `${hash}  ${basename(destination)}\n`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  console.log(destination);
} finally { await rm(temp, { recursive: true, force: true }); }
