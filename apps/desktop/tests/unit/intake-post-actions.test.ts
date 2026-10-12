import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { actionsForIntakePost, DEFAULT_INTAKE_POST, INTAKE_POSTS, intakePostForActions, intakePostStatusForGrants, intakePostsCoveredBy } from '../../src/shared/intake-post-actions';

const MODULE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/shared/intake-post-actions.ts');

describe('intake post actions', () => {
  it('maps 客服 to query only', () => {
    expect(actionsForIntakePost('客服')).toEqual({ ok: true, actions: ['query'] });
  });

  it('maps 客服主管 to manage, upload, source confirm, and publish', () => {
    expect(actionsForIntakePost('客服主管')).toEqual({
      ok: true,
      actions: ['content-manage', 'import', 'source-confirm', 'publish'],
    });
  });

  it('returns unknown-post instead of guessing', () => {
    expect(actionsForIntakePost('')).toEqual({ ok: false, error: 'unknown-post' });
    expect(actionsForIntakePost('客服 ')).toEqual({ ok: false, error: 'unknown-post' });
    expect(actionsForIntakePost('主管')).toEqual({ ok: false, error: 'unknown-post' });
    expect(actionsForIntakePost('review')).toEqual({ ok: false, error: 'unknown-post' });
    expect(actionsForIntakePost(null)).toEqual({ ok: false, error: 'unknown-post' });
  });

  it('locks the two posts and the default', () => {
    expect([...INTAKE_POSTS]).toEqual(['客服', '客服主管']);
    expect(DEFAULT_INTAKE_POST).toBe('客服');
    expect(actionsForIntakePost(DEFAULT_INTAKE_POST).ok).toBe(true);
  });

  it('recognizes only an exact post action set', () => {
    for (const post of INTAKE_POSTS) {
      const mapped = actionsForIntakePost(post);
      expect(mapped.ok).toBe(true);
      if (!mapped.ok) return;
      expect(intakePostForActions(mapped.actions)).toBe(post);
      expect(intakePostForActions([...mapped.actions].reverse())).toBe(post);
      expect(intakePostForActions([...mapped.actions, 'rollback'])).toBeNull();
    }
    expect(intakePostForActions([])).toBeNull();
    expect(intakePostForActions(['query', 'query'])).toBeNull();
    expect(intakePostForActions(['nope'])).toBeNull();
  });

  it('offers a post only when the scope covers every action', () => {
    const supervisor = actionsForIntakePost('客服主管');
    const agent = actionsForIntakePost('客服');
    expect(supervisor.ok).toBe(true);
    expect(agent.ok).toBe(true);
    if (!supervisor.ok || !agent.ok) return;
    expect(intakePostsCoveredBy([...agent.actions])).toEqual(['客服']);
    expect(intakePostsCoveredBy([...supervisor.actions, ...agent.actions])).toEqual(['客服', '客服主管']);
    expect(intakePostsCoveredBy(supervisor.actions.slice(0, -1))).toEqual([]);
    expect(intakePostsCoveredBy([])).toEqual([]);
  });

  it('reads grant status from live actions', () => {
    const agent = actionsForIntakePost('客服');
    expect(agent.ok).toBe(true);
    if (!agent.ok) return;
    const live = agent.actions.map(action => ({ action, revoked: false }));
    expect(intakePostStatusForGrants(live)).toEqual({ post: '客服', status: '已授权' });
    expect(intakePostStatusForGrants(live.map(grant => ({ ...grant, revoked: true })))).toEqual({ post: null, status: '已撤销' });
    expect(intakePostStatusForGrants([])).toEqual({ post: null, status: '未授权' });
    expect(intakePostStatusForGrants([{ action: 'rollback', revoked: false }])).toEqual({ post: null, status: '已授权' });
    expect(intakePostStatusForGrants([...live, ...live])).toEqual({ post: '客服', status: '已授权' });
  });

  it('does not import a UI runtime', () => {
    const source = readFileSync(MODULE_PATH, 'utf8');
    const imports = source.split('\n').filter((line) => /^\s*import\b/.test(line)).join('\n');
    expect(imports).not.toMatch(/\breact\b/);
    expect(imports).not.toMatch(/\belectron\b/);
  });
});
