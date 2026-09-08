import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { API_ROOT, EXPERIMENT_ROOT } from '../paths.js';

const vitest = join(API_ROOT, 'node_modules/vitest/vitest.mjs');
const cli = join(EXPERIMENT_ROOT, 'cli.mjs');

function copyFixtures(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'search-decision-lab-gate-'));
  cpSync(join(EXPERIMENT_ROOT, 'fixtures'), tmp, { recursive: true });
  return tmp;
}

function mutateAndRun(target: 'MX01' | 'N01'): { status: number; reportDir: string; cleanup: () => void } {
  const tmp = copyFixtures();
  const reportDir = join(tmp, 'reports');
  if (target === 'MX01') {
    const path = join(tmp, 'cases-interface.json');
    const doc = JSON.parse(readFileSync(path, 'utf8')) as { cases: Array<{ id: string; expected: { decision: string; shownScriptIds: string[] } }> };
    const found = doc.cases.find((item) => item.id === 'MX01');
    if (found === undefined) throw new Error('MX01 not found');
    found.expected.decision = 'reject';
    found.expected.shownScriptIds = [];
    writeFileSync(path, `${JSON.stringify(doc)}\n`);
  } else {
    const path = join(tmp, 'cases-n.json');
    const doc = JSON.parse(readFileSync(path, 'utf8')) as { cases: Array<{ id: string; expected: { decision: string; shownScriptIds: string[] } }> };
    const found = doc.cases.find((item) => item.id === 'N01');
    if (found === undefined) throw new Error('N01 not found');
    found.expected.decision = 'show';
    found.expected.shownScriptIds = ['muff-contact'];
    writeFileSync(path, `${JSON.stringify(doc)}\n`);
  }
  const file = target === 'MX01'
    ? join(EXPERIMENT_ROOT, 'tests/interface.test.ts')
    : join(EXPERIMENT_ROOT, 'tests/round1-scope.test.ts');
  const result = spawnSync(process.execPath, [vitest, 'run', file], {
    cwd: API_ROOT,
    env: {
      ...process.env,
      SEARCH_DECISION_LAB_TEST_UNFROZEN: '1',
      SEARCH_DECISION_LAB_FIXTURE_ROOT: tmp,
      SEARCH_DECISION_LAB_REPORT_DIR: reportDir,
    },
    encoding: 'utf8',
  });
  return {
    status: result.status ?? 1,
    reportDir,
    cleanup: () => rmSync(tmp, { recursive: true, force: true }),
  };
}

describe('mutation fail gates', () => {
  it('interface acceptance exits non-zero and records MX01 in run.json', () => {
    const result = mutateAndRun('MX01');
    try {
      expect(result.status).not.toBe(0);
      const report = JSON.parse(readFileSync(join(result.reportDir, 'run.json'), 'utf8')) as { failedIds: string[] };
      expect(report.failedIds).toContain('MX01');
    } finally {
      result.cleanup();
    }
  });

  it('round1-scope exits non-zero and records N01 in round1.json', () => {
    const result = mutateAndRun('N01');
    try {
      expect(result.status).not.toBe(0);
      const report = JSON.parse(readFileSync(join(result.reportDir, 'round1.json'), 'utf8')) as { failedIds: string[] };
      expect(report.failedIds).toContain('N01');
    } finally {
      result.cleanup();
    }
  });

  it('ordinary CLI strips TEST_UNFROZEN and still validates frozen fixtures', () => {
    const tmp = copyFixtures();
    const sourcesPath = join(tmp, 'sources.json');
    const doc = JSON.parse(readFileSync(sourcesPath, 'utf8')) as Record<string, unknown>;
    doc.lab_unfreeze_probe = true;
    writeFileSync(sourcesPath, `${JSON.stringify(doc)}\n`);
    try {
      const result = spawnSync(process.execPath, [cli, 'round1'], {
        cwd: API_ROOT,
        env: {
          ...process.env,
          SEARCH_DECISION_LAB_TEST_UNFROZEN: '1',
          SEARCH_DECISION_LAB_FIXTURE_ROOT: tmp,
          SEARCH_DECISION_LAB_REPORT_DIR: join(tmp, 'reports'),
        },
        encoding: 'utf8',
      });
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      expect(result.status).not.toBe(0);
      expect(output).toMatch(/SEARCH_DECISION_LAB_FIXTURE_DRIFT/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
