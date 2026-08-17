import { createHash } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WINDOWS_LOCAL_UNSIGNED_OUTPUT = path.join(
  'release',
  'local-unsigned',
  'windows',
);

const REQUIRED_LICENSES = [
  'THIRD_PARTY_NOTICES.md',
  path.join('licenses', 'Electron-LICENSE.txt'),
  path.join('licenses', 'Chromium-LICENSES.html'),
];

function requireDirectory(directory, label) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error(`Missing ${label}: ${directory}`);
  }
}

function requireNonEmptyFile(filename, label) {
  if (!existsSync(filename) || !statSync(filename).isFile() || statSync(filename).size === 0) {
    throw new Error(`Missing or empty ${label}: ${filename}`);
  }
}

function collectFiles(directory, relativeDirectory = '') {
  const current = path.join(directory, relativeDirectory);
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(directory, relativePath);
    }
    return [relativePath];
  });
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function isForbiddenUpdateMetadata(relativePath) {
  const basename = path.basename(relativePath);
  return (
    /^app-update\.ya?ml$/i.test(basename) ||
    /^latest.*\.ya?ml$/i.test(basename) ||
    basename.toLowerCase().endsWith('.blockmap')
  );
}

export function verifyWindowsPackage(options = {}) {
  const projectRoot = options.root ?? path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
  );
  const outputDirectory = options.outputDirectory ?? path.join(
    projectRoot,
    WINDOWS_LOCAL_UNSIGNED_OUTPUT,
  );
  requireDirectory(outputDirectory, 'Windows local-unsigned output directory');

  const topLevelEntries = readdirSync(outputDirectory, { withFileTypes: true });
  const installers = topLevelEntries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'))
    .map((entry) => entry.name);
  if (installers.length === 0) {
    throw new Error(`No Windows installer found in ${outputDirectory}`);
  }
  const incorrectlyNamedInstaller = installers.find(
    (name) => !/-UNSIGNED\.exe$/i.test(name),
  );
  if (incorrectlyNamedInstaller) {
    throw new Error(
      `Every local Windows installer must be marked UNSIGNED: ${incorrectlyNamedInstaller}`,
    );
  }
  for (const installer of installers) {
    requireNonEmptyFile(
      path.join(outputDirectory, installer),
      `Windows local-unsigned installer ${installer}`,
    );
  }

  const outputFiles = collectFiles(outputDirectory);
  const forbiddenMetadata = outputFiles.find(isForbiddenUpdateMetadata);
  if (forbiddenMetadata) {
    throw new Error(
      `Update metadata must not be generated for this offline Demo: ${forbiddenMetadata}`,
    );
  }

  const unpackedDirectory = path.join(outputDirectory, 'win-unpacked');
  const resourcesDirectory = path.join(unpackedDirectory, 'resources');
  requireDirectory(unpackedDirectory, 'win-unpacked application directory');
  requireDirectory(resourcesDirectory, 'win-unpacked resources directory');

  const expectedIcon = path.join(projectRoot, 'build', 'icon.ico');
  const packagedIcon = path.join(resourcesDirectory, 'icon.ico');
  requireNonEmptyFile(expectedIcon, 'generated Windows brand icon');
  requireNonEmptyFile(packagedIcon, 'packaged Windows brand icon');
  const expectedIconBytes = readFileSync(expectedIcon);
  const packagedIconBytes = readFileSync(packagedIcon);
  const expectedIconSha256 = sha256(expectedIconBytes);
  const packagedIconSha256 = sha256(packagedIconBytes);
  if (!expectedIconBytes.equals(packagedIconBytes)) {
    throw new Error(
      `Packaged icon.ico does not match build/icon.ico (expected ${expectedIconSha256}, received ${packagedIconSha256}).`,
    );
  }

  for (const relativePath of REQUIRED_LICENSES) {
    requireNonEmptyFile(
      path.join(resourcesDirectory, relativePath),
      `packaged license notice ${relativePath}`,
    );
  }

  return {
    outputDirectory,
    installers,
    unpackedDirectory,
    iconSha256: expectedIconSha256,
    licenses: [...REQUIRED_LICENSES],
  };
}

const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  const result = verifyWindowsPackage();
  console.log(
    `Windows local-unsigned package structure verified: ${result.installers.join(', ')}`,
  );
  console.log(
    'This gate verifies packaged files only; it does not inspect the PE executable icon resource or Authenticode status.',
  );
}
