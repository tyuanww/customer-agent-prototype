import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./customer-agent-release.mjs', import.meta.url));
const OLD = 'a'.repeat(40);
const NEXT = 'b'.repeat(40);
const MANIFEST = 'packages/database/migrations/manifest.generated.json';

function manifest(ids) {
  return `${JSON.stringify({
    migrations: ids.map((id, index) => ({ position: index + 1, id })),
  })}\n`;
}

function layout(releases, currentSha) {
  const root = mkdtempSync(path.join(tmpdir(), 'ca-release-'));
  for (const release of releases) {
    const dir = path.join(root, 'releases', release.sha);
    mkdirSync(path.join(dir, 'packages/database/migrations'), { recursive: true });
    writeFileSync(path.join(dir, MANIFEST), manifest(release.ids));
    if (release.entry) {
      mkdirSync(path.join(dir, 'scripts/synthetic-stack'), { recursive: true });
      writeFileSync(path.join(dir, 'scripts/synthetic-stack/stack.ts'), 'export {}\n');
    }
  }
  symlinkSync(path.join(root, 'releases', currentSha), path.join(root, 'current'));
  return root;
}

function run(root, sha, extra = []) {
  return spawnSync(process.execPath, [
    script,
    '--root', root,
    '--sha', sha,
    '--bundle', path.join(root, 'sha.bundle'),
    ...extra,
  ], { encoding: 'utf8' });
}

function combined(result) {
  return `${result.stdout}${result.stderr}`;
}

test('dry-run prints a forward ledger and leaves the temp tree alone', () => {
  const root = layout([
    { sha: OLD, ids: ['0001_base'], entry: true },
    { sha: NEXT, ids: ['0001_base', '0002_next'], entry: true },
  ], OLD);
  const before = readlinkSync(path.join(root, 'current'));
  const result = run(root, NEXT);
  const output = combined(result);
  assert.equal(result.status, 0, output);
  assert.match(output, /mode dry-run/);
  assert.match(output, /migration ledger would move forward/);
  assert.doesNotMatch(output, /a schema rollback needs a backup restore/);
  const ledgerAt = output.indexOf('migration ledger would move forward');
  const linkAt = output.indexOf('ln -sfn');
  assert.ok(ledgerAt !== -1 && linkAt !== -1 && ledgerAt < linkAt);
  assert.match(output, /nothing changed/);
  assert.match(output, /skip: remote shell/);
  assert.match(output, /skip: systemctl restart customer-agent-stack/);
  assert.doesNotMatch(output, /100\.93\.46\.46|\/var\/lib\/ca-build/);
  assert.equal(readlinkSync(path.join(root, 'current')), before);
  assert.equal(existsSync(path.join(root, 'sha.bundle')), false);
  assert.equal(existsSync(path.join(root, 'current.next')), false);
});

test('dry-run on an older manifest prints the schema restore line and changes nothing', () => {
  const root = layout([
    { sha: OLD, ids: ['0001_base', '0002_next'], entry: true },
    { sha: NEXT, ids: ['0001_base'], entry: true },
  ], OLD);
  const before = readlinkSync(path.join(root, 'current'));
  const manifestBefore = readFileSync(path.join(root, 'releases', OLD, MANIFEST), 'utf8');
  const result = run(root, NEXT);
  const output = combined(result);
  assert.equal(result.status, 0, output);
  assert.match(output, /migration ledger would not move forward/);
  assert.match(output, /a schema rollback needs a backup restore/);
  const ledgerAt = output.indexOf('migration ledger would not move forward');
  const linkAt = output.indexOf('ln -sfn');
  assert.ok(ledgerAt !== -1 && linkAt !== -1 && ledgerAt < linkAt);
  assert.equal(readlinkSync(path.join(root, 'current')), before);
  assert.equal(readFileSync(path.join(root, 'releases', OLD, MANIFEST), 'utf8'), manifestBefore);
});

test('apply restores the previous symlink when the release has no stack entry', () => {
  const root = layout([
    { sha: OLD, ids: ['0001_base'], entry: true },
    { sha: NEXT, ids: ['0001_base', '0002_next'], entry: false },
  ], OLD);
  const before = readlinkSync(path.join(root, 'current'));
  const result = run(root, NEXT, ['--apply']);
  const output = combined(result);
  assert.equal(result.status, 1, output);
  const ledgerAt = output.indexOf('migration ledger would move forward');
  const restoredAt = output.indexOf('symlink restored to previous target');
  assert.ok(ledgerAt !== -1 && restoredAt !== -1 && ledgerAt < restoredAt);
  assert.match(output, /release missing scripts\/synthetic-stack\/stack\.ts/);
  assert.equal(readlinkSync(path.join(root, 'current')), before);
  assert.equal(existsSync(path.join(root, 'current.next')), false);
});

test('apply repoints current at an older release and leaves both manifests unchanged', () => {
  const root = layout([
    { sha: OLD, ids: ['0001_base', '0002_next'], entry: true },
    { sha: NEXT, ids: ['0001_base'], entry: true },
  ], OLD);
  const oldManifest = readFileSync(path.join(root, 'releases', OLD, MANIFEST), 'utf8');
  const nextManifest = readFileSync(path.join(root, 'releases', NEXT, MANIFEST), 'utf8');
  const result = run(root, NEXT, ['--apply']);
  const output = combined(result);
  assert.equal(result.status, 0, output);
  assert.match(output, /migration ledger would not move forward/);
  assert.match(output, /a schema rollback needs a backup restore/);
  assert.match(output, /symlink switched to /);
  assert.equal(realpathSync(readlinkSync(path.join(root, 'current'))), realpathSync(path.join(root, 'releases', NEXT)));
  assert.equal(readFileSync(path.join(root, 'releases', OLD, MANIFEST), 'utf8'), oldManifest);
  assert.equal(readFileSync(path.join(root, 'releases', NEXT, MANIFEST), 'utf8'), nextManifest);
});

test('a second apply leaves current where it already points', () => {
  const root = layout([
    { sha: OLD, ids: ['0001_base'], entry: true },
    { sha: NEXT, ids: ['0001_base', '0002_next'], entry: true },
  ], OLD);
  const first = run(root, NEXT, ['--apply']);
  assert.equal(first.status, 0, combined(first));
  const pointed = readlinkSync(path.join(root, 'current'));
  const second = run(root, NEXT, ['--apply']);
  const output = combined(second);
  assert.equal(second.status, 0, output);
  assert.match(output, /current already points at the release/);
  assert.equal(readlinkSync(path.join(root, 'current')), pointed);
});

test('--rollback-schema refuses and does not move current', () => {
  const root = layout([
    { sha: OLD, ids: ['0001_base'], entry: true },
    { sha: NEXT, ids: ['0001_base', '0002_next'], entry: true },
  ], OLD);
  const before = readlinkSync(path.join(root, 'current'));
  const result = run(root, NEXT, ['--rollback-schema', '--apply']);
  const output = combined(result);
  assert.equal(result.status, 1, output);
  assert.match(output, /a schema rollback needs a backup restore/);
  assert.doesNotMatch(output, /symlink switched/);
  assert.equal(readlinkSync(path.join(root, 'current')), before);
});

test('apply refuses a forked ledger and leaves current in place', () => {
  const root = layout([
    { sha: OLD, ids: ['0001_left'], entry: true },
    { sha: NEXT, ids: ['0001_right'], entry: true },
  ], OLD);
  const before = readlinkSync(path.join(root, 'current'));
  const result = run(root, NEXT, ['--apply']);
  const output = combined(result);
  assert.equal(result.status, 1, output);
  assert.match(output, /migration ledger would not move forward/);
  assert.match(output, /a schema rollback needs a backup restore/);
  assert.match(output, /refusing to switch onto a forked migration ledger/);
  assert.equal(readlinkSync(path.join(root, 'current')), before);
});

test('the live root is refused before any tree is required', () => {
  const result = spawnSync(process.execPath, [
    script,
    '--root', '/srv/customer-agent',
    '--sha', NEXT,
    '--bundle', path.join(tmpdir(), 'ca-release-unused.bundle'),
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(combined(result), /refusing live root/);
  assert.doesNotMatch(combined(result), /symlink switched/);
});

test('--root is required', () => {
  const result = spawnSync(process.execPath, [script, '--sha', NEXT, '--bundle', 'sha.bundle'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(combined(result), /--root is required/);
});
