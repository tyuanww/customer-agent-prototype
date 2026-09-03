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
