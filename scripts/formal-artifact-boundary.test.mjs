import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  verifyFormalArtifactBoundary,
  verifyM0FormalCandidate,
} from './formal-artifact-boundary.mjs';

function withTemporaryProject(run) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-formal-artifact-'));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('accepts generic contract vocabulary without desktop fixture modules', () => {
  withTemporaryProject((root) => {
    mkdirSync(path.join(root, 'dist'));
    writeFileSync(
      path.join(root, 'dist', 'contract.js'),
      "export const collectionModes = ['synthetic', 'approved_redacted'];\n",
    );

    const result = verifyFormalArtifactBoundary({
      projectRoot: root,
      artifactRoots: ['dist'],
    });

    assert.equal(result.scannedFileCount, 1);
  });
});

test('rejects a desktop synthetic fixture import', () => {
  withTemporaryProject((root) => {
    mkdirSync(path.join(root, 'dist'));
    writeFileSync(
      path.join(root, 'dist', 'leak.js'),
      "import { SYNTHETIC_SCRIPTS } from '../apps/desktop/src/renderer/data/synthetic-scripts';\n",
    );

    assert.throws(
      () => verifyFormalArtifactBoundary({ projectRoot: root, artifactRoots: ['dist'] }),
      /FORMAL_ARTIFACT_BOUNDARY_VIOLATION/u,
    );
  });
});

test('rejects symlinks inside a formal artifact root', () => {
  withTemporaryProject((root) => {
    mkdirSync(path.join(root, 'dist'));
    writeFileSync(path.join(root, 'outside.js'), 'export const value = 1;\n');
    symlinkSync(path.join(root, 'outside.js'), path.join(root, 'dist', 'linked.js'));

    assert.throws(
      () => verifyFormalArtifactBoundary({ projectRoot: root, artifactRoots: ['dist'] }),
      /FORMAL_ARTIFACT_SYMLINK/u,
    );
  });
});

test('rejects missing artifact roots instead of silently passing', () => {
  withTemporaryProject((root) => {
    assert.throws(
      () => verifyFormalArtifactBoundary({ projectRoot: root, artifactRoots: ['dist'] }),
      /FORMAL_ARTIFACT_ROOT_MISSING/u,
    );
  });
});

test('rejects unknown and credential-like file types instead of skipping them', () => {
  withTemporaryProject((root) => {
    mkdirSync(path.join(root, 'dist'));
    writeFileSync(path.join(root, 'dist', 'runtime.pem'), 'placeholder');

    assert.throws(
      () => verifyFormalArtifactBoundary({ projectRoot: root, artifactRoots: ['dist'] }),
      /FORMAL_ARTIFACT_FILE_TYPE_NOT_ALLOWED/u,
    );
  });
});

test('rejects a fine-grained GitHub credential marker in an allowed file type', () => {
  withTemporaryProject((root) => {
    mkdirSync(path.join(root, 'dist'));
    writeFileSync(
      path.join(root, 'dist', 'runtime.js'),
      `export const token = 'github_pat_${'a'.repeat(30)}';\n`,
    );

    assert.throws(
      () => verifyFormalArtifactBoundary({ projectRoot: root, artifactRoots: ['dist'] }),
      /GITHUB_FINE_GRAINED_TOKEN/u,
    );
  });
});

test('rejects a formal candidate built from a different Git commit', () => {
  withTemporaryProject((root) => {
    const candidateRoot = path.join(root, 'release', 'm0-formal-runtime-candidate');
    mkdirSync(candidateRoot, { recursive: true });
    writeFileSync(
      path.join(candidateRoot, 'manifest.json'),
      `${JSON.stringify({
        schema: 'customer-agent-m0-formal-runtime-candidate/v1',
        evidence_scope: 'contracts-database-api-build-separation-only',
        deployable: false,
        runtime_activated: false,
        build_git_sha: 'a'.repeat(40),
        artifacts: [{ path: 'placeholder.js', bytes: 1, sha256: 'b'.repeat(64) }],
      })}\n`,
    );

    assert.throws(
      () => verifyM0FormalCandidate({
        projectRoot: root,
        expectedBuildGitSha: 'c'.repeat(40),
      }),
      /M0_FORMAL_CANDIDATE_BUILD_SHA_DRIFT/u,
    );
  });
});

test('rejects a symlinked formal candidate root', () => {
  withTemporaryProject((root) => {
    const releaseRoot = path.join(root, 'release');
    const outsideRoot = path.join(root, 'outside-candidate');
    mkdirSync(releaseRoot);
    mkdirSync(outsideRoot);
    symlinkSync(outsideRoot, path.join(releaseRoot, 'm0-formal-runtime-candidate'));

    assert.throws(
      () => verifyM0FormalCandidate({
        projectRoot: root,
        expectedBuildGitSha: 'c'.repeat(40),
      }),
      /M0_FORMAL_CANDIDATE_ROOT_UNSAFE/u,
    );
  });
});

test('canonical candidate checks build once, test that build, then bind the copied bytes to HEAD', async () => {
  const { buildM0FormalCandidate } = await import('./build-m0-formal-candidate.mjs');
  const { execFileSync } = await import('node:child_process');
  const { readFileSync, chmodSync } = await import('node:fs');
  const sandbox = mkdtempSync(path.join(os.tmpdir(), 'customer-agent-build-order-'));
  const projectRoot = path.join(sandbox,'project');
  const bin = path.join(sandbox,'bin');
  const previousPath = process.env.PATH;
  mkdirSync(projectRoot); mkdirSync(bin);
  const git = (...args) => execFileSync('git',args,{cwd:projectRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  try {
    git('init');
    mkdirSync(path.join(projectRoot,'contracts/upstream/customer-agent'),{recursive:true});
    writeFileSync(path.join(projectRoot,'contracts/upstream/customer-agent/contract-set.lock.json'),JSON.stringify({contract_set_id:'synthetic',source_git_sha:'a'.repeat(40)}));
    writeFileSync(path.join(projectRoot,'.gitignore'),'apps/\npackages/\nrelease/\ncommands.json\n');
    git('add','.gitignore','contracts');
    git('-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','-c','core.hooksPath=/dev/null','commit','-m','synthetic fixture');
    writeFileSync(path.join(bin,'pnpm'),`#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const commands = existsSync('commands.json') ? JSON.parse(readFileSync('commands.json','utf8')) : [];
commands.push(process.argv[2]); writeFileSync('commands.json',JSON.stringify(commands));
if (process.argv[2] === 'build') {
  for (const dir of ['apps/api/dist','packages/contracts/dist','packages/database/dist']) {
    mkdirSync(dir,{recursive:true}); writeFileSync(dir+'/index.js','export const build = "fresh";');
  }
} else if (process.argv[2] !== 'test:built' || !readFileSync('apps/api/dist/index.js','utf8').includes('fresh')) process.exitCode = 1;
`);
    chmodSync(path.join(bin,'pnpm'),0o700);
    process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
    const result = buildM0FormalCandidate({projectRoot,check:true});
    assert.deepEqual(JSON.parse(readFileSync(path.join(projectRoot,'commands.json'),'utf8')),['build','test:built']);
    assert.equal(result.manifest.build_git_sha,git('rev-parse','HEAD'));
    assert.equal(result.manifest.deployable,false);
    assert.equal(readFileSync(path.join(result.candidateRoot,'apps/api/dist/index.js'),'utf8'),'export const build = "fresh";');
    writeFileSync(path.join(projectRoot,'dirty.txt'),'uncommitted');
    assert.throws(() => buildM0FormalCandidate({projectRoot,check:true}),/REQUIRES_CLEAN_WORKTREE/u);
    assert.deepEqual(JSON.parse(readFileSync(path.join(projectRoot,'commands.json'),'utf8')),['build','test:built']);
  } finally {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    rmSync(sandbox,{recursive:true,force:true});
  }
});
