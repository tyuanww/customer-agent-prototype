import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const mode = process.argv[2] ?? 'local';
if (mode !== 'local') {
  throw new Error(
    'Windows packaging in this Demo is local-unsigned only. There is no signed distribution path.',
  );
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = 'release/local-unsigned';
const buildEnvironment = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
};

execFileSync('pnpm', ['build'], {
  cwd: root,
  env: buildEnvironment,
  stdio: 'inherit',
});

execFileSync(
  'electron-builder',
  [
    '--win',
    '--publish',
    'never',
    `-c.directories.output=${outputDirectory}`,
    '-c.win.signAndEditExecutable=false',
    '-c.win.artifactName=${productName}-${version}-win-${arch}-UNSIGNED.${ext}',
  ],
  {
    cwd: root,
    env: buildEnvironment,
    stdio: 'inherit',
  },
);
