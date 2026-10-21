import { mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'mteam-launcher-unit-'));
try {
  const executable = join(directory, 'configuration-tests');
  execFileSync('swiftc', ['launcher/macos/Sources/LauncherCore/LaunchConfiguration.swift',
    'launcher/macos/Tests/LaunchConfigurationTests.swift', '-o', executable], { stdio: 'inherit' });
  // This executable contains only pure configuration unit tests, never the app entry point.
  execFileSync(executable, [], { stdio: 'inherit' });
} finally { await rm(directory, { recursive: true, force: true }); }
