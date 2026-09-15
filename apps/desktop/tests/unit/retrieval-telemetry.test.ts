import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createFileTelemetry,
  summarizeNeverHit,
} from '../../src/main/retrieval-telemetry-store';

const hash = 'a'.repeat(64);

describe('retrieval never-hit ledger', () => {
  it('records impressions and reports scripts that were never shown or never copied', () => {
    const repo = mkdtempSync(join(tmpdir(), 'telemetry-repo-'));
    const path = join(mkdtempSync(join(tmpdir(), 'telemetry-out-')), 'retrieval-telemetry.json');
    const store = createFileTelemetry(path, repo);
    store.recordQuery({
      queryId: 'q1', at: '2026-09-15T00:00:00.000Z', releaseId: 'rel_6',
      hitStatus: 'hit', intent: 'shipping',
      impressions: [{ scriptId: 'ship', rank: 1, contentHash: hash }],
      adoptedScriptId: null, outcome: null,
    });
    store.recordQuery({
      queryId: 'q2', at: '2026-09-15T00:01:00.000Z', releaseId: 'rel_6',
      hitStatus: 'no_hit', intent: 'other',
      impressions: [], adoptedScriptId: null, outcome: null,
    });
    store.markAdopted('q1', 'ship');
    const report = summarizeNeverHit(
      [
        { scriptId: 'ship', title: '发货时效' },
        { scriptId: 'inci', title: '成分表' },
        { scriptId: 'shown', title: '未复制' },
      ],
      store.snapshot().events,
    );
    expect(report).toMatchObject({ queries: 2, hits: 1, noHits: 1, noHitRate: 0.5, catalog: 3 });
    expect(report.neverImpressed.map((row) => row.scriptId).sort()).toEqual(['inci', 'shown']);
    store.recordQuery({
      queryId: 'q3', at: '2026-09-15T00:02:00.000Z', releaseId: 'rel_6',
      hitStatus: 'hit', intent: 'product',
      impressions: [{ scriptId: 'shown', rank: 1, contentHash: hash }],
      adoptedScriptId: null, outcome: null,
    });
    const later = summarizeNeverHit(
      [
        { scriptId: 'ship', title: '发货时效' },
        { scriptId: 'inci', title: '成分表' },
        { scriptId: 'shown', title: '未复制' },
      ],
      store.snapshot().events,
    );
    expect(later.neverImpressed.map((row) => row.scriptId)).toEqual(['inci']);
    expect(later.impressedNeverAdopted.map((row) => row.scriptId)).toEqual(['shown']);
    expect(readFileSync(path, 'utf8')).not.toContain('排骨');
  });

  it('refuses to write inside the git worktree', () => {
    const repo = mkdtempSync(join(tmpdir(), 'telemetry-repo-'));
    expect(() => createFileTelemetry(join(repo, 'retrieval-telemetry.json'), repo)).toThrow(/outside the git worktree/);
  });
});
