import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (mode !== 'local' && mode !== 'distribution') {
  throw new Error('Usage: node scripts/verify-mac-package.mjs <local|distribution>');
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(
  root,
  'release',
  mode === 'local' ? 'local-unsigned' : 'distribution',
);
const appContainer = path.join(outputDir, 'mac-universal');
const appName = readdirSync(appContainer).find((name) => name.endsWith('.app'));
if (!appName) {
  throw new Error(`Universal .app not found in ${appContainer}`);
}

const appPath = path.join(appContainer, appName);
const resources = path.join(appPath, 'Contents', 'Resources');
const infoPlist = path.join(appPath, 'Contents', 'Info.plist');
const executable = execFileSync(
  '/usr/libexec/PlistBuddy',
  ['-c', 'Print :CFBundleExecutable', infoPlist],
  { encoding: 'utf8' },
).trim();
const executablePath = path.join(appPath, 'Contents', 'MacOS', executable);
const architectures = execFileSync('lipo', ['-archs', executablePath], {
  encoding: 'utf8',
}).trim().split(/\s+/);

for (const architecture of ['arm64', 'x86_64']) {
  if (!architectures.includes(architecture)) {
    throw new Error(`Missing ${architecture} architecture in ${executablePath}`);
  }
}

for (const relativePath of [
  'THIRD_PARTY_NOTICES.md',
  'licenses/Electron-LICENSE.txt',
  'licenses/Chromium-LICENSES.html',
]) {
  const licensePath = path.join(resources, relativePath);
  if (!existsSync(licensePath) || statSync(licensePath).size === 0) {
    throw new Error(`Missing packaged license notice: ${relativePath}`);
  }
}

for (const forbiddenKey of [
  'NSAppTransportSecurity',
  'NSAudioCaptureUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
]) {
  try {
    execFileSync('/usr/bin/plutil', ['-extract', forbiddenKey, 'raw', infoPlist], {
      stdio: 'ignore',
    });
    throw new Error(`Forbidden Info.plist key is still present: ${forbiddenKey}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Forbidden Info.plist')) {
      throw error;
    }
  }
}

const outputFiles = readdirSync(outputDir, { recursive: true }).map(String);
if (
  outputFiles.some((name) => {
    const basename = path.basename(name);
    return (
      basename === 'app-update.yml' ||
      /^latest.*\.ya?ml$/.test(basename) ||
      basename.endsWith('.blockmap')
    );
  })
) {
  throw new Error('Update metadata must not be generated for this offline Demo.');
}

const artifacts = readdirSync(outputDir).filter(
  (name) => name.endsWith('.dmg') || name.endsWith('.zip'),
);
if (!artifacts.some((name) => name.endsWith('.dmg')) || !artifacts.some((name) => name.endsWith('.zip'))) {
  throw new Error('Both Universal DMG and ZIP artifacts are required.');
}

if (mode === 'local') {
  if (artifacts.some((name) => !name.includes('-UNSIGNED.'))) {
    throw new Error('Every local proof artifact must be marked UNSIGNED.');
  }
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], {
      stdio: 'ignore',
    });
    throw new Error('The local proof package unexpectedly passed code-sign verification.');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('The local proof package')) {
      throw error;
    }
  }
} else {
  if (artifacts.some((name) => name.includes('UNSIGNED'))) {
    throw new Error('Distribution artifacts must never carry the UNSIGNED marker.');
  }
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], {
    stdio: 'inherit',
  });
  execFileSync('spctl', ['--assess', '--type', 'execute', appPath], {
    stdio: 'inherit',
  });
  execFileSync('xcrun', ['stapler', 'validate', appPath], {
    stdio: 'inherit',
  });
}

console.log(
  `macOS ${mode === 'local' ? 'local unsigned' : 'signed distribution'} package verification passed.`,
);
