import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { releaseVersion } from './release-config.mjs';

if (process.platform !== 'darwin') throw new Error('macOS 启动器需在 macOS 上编译。');
const [manifest, root, extension] = await Promise.all(['extension/manifest.json', 'package.json', 'extension/package.json'].map(async path => JSON.parse(await readFile(path, 'utf8'))));
const version = releaseVersion(manifest, [root, extension], process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : '');
const temporary = await mkdtemp(join(tmpdir(), 'mteam-launcher-'));
const destination = resolve(`release/mteam-launcher-macos-${version}.zip`);
const appName = 'M-Team 资源助手.app';
try {
  const app = join(temporary, appName), contents = join(app, 'Contents');
  await mkdir(join(contents, 'MacOS'), { recursive: true });
  await mkdir(join(contents, 'Resources'), { recursive: true });
  for (const arch of ['arm64', 'x86_64']) {
    execFileSync('swiftc', ['-O', '-target', `${arch}-apple-macos13.0`,
      'launcher/macos/Sources/LauncherCore/LaunchConfiguration.swift', 'launcher/macos/App/main.swift',
      '-framework', 'AppKit', '-o', join(temporary, arch)], { stdio: 'inherit' });
  }
  execFileSync('lipo', ['-create', join(temporary, 'arm64'), join(temporary, 'x86_64'), '-output', join(contents, 'MacOS', 'MTeamLauncher')]);
  const icons = join(temporary, 'AppIcon.iconset');
  await mkdir(icons);
  for (const size of [16, 32, 128]) await cp(`extension/icons/${size}.png`, join(icons, `icon_${size}x${size}.png`));
  await cp('extension/icons/32.png', join(icons, 'icon_16x16@2x.png'));
  await cp('extension/icons/128.png', join(icons, 'icon_64x64@2x.png'));
  execFileSync('iconutil', ['-c', 'icns', icons, '-o', join(contents, 'Resources', 'AppIcon.icns')]);
  await writeFile(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>io.github.jerboy.mteam-launcher</string>
<key>CFBundleName</key><string>M-Team 资源助手</string>
<key>CFBundleDisplayName</key><string>M-Team 资源助手</string>
<key>CFBundleExecutable</key><string>MTeamLauncher</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${version}</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
`);
  await cp('LICENSE', join(contents, 'Resources', 'LICENSE'));
  execFileSync('codesign', ['--force', '--sign', '-', app], { stdio: 'inherit' });
  await mkdir('release', { recursive: true });
  await rm(destination, { force: true });
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, destination]);
  const hash = createHash('sha256').update(await readFile(destination)).digest('hex');
  await writeFile(`${destination}.sha256`, `${hash}  ${basename(destination)}\n`);
  await rm(resolve('release', appName), { recursive: true, force: true });
  await cp(app, resolve('release', appName), { recursive: true });
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  console.log(destination);
} finally { await rm(temporary, { recursive: true, force: true }); }
