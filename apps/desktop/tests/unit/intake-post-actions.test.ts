import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { actionsForIntakeGrantChoice, actionsForIntakePost, DEFAULT_INTAKE_POST, INTAKE_POSTS, intakeGrantChoicesCoveredBy, intakeGrantStatusForGrants } from '../../src/shared/intake-post-actions';

const MODULE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/shared/intake-post-actions.ts');
const window = { startsAt: '2020-01-01T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' };
const now = Date.parse('2026-10-30T00:00:00.000Z');
const grant = (action: unknown, extra: Partial<{ revoked: boolean; startsAt: string; expiresAt: string }> = {}) => ({
  action, revoked: false, ...window, ...extra,
});

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

  it('recognizes complete choices and reports any actions outside them', () => {
    for (const post of INTAKE_POSTS) {
      const mapped = actionsForIntakePost(post);
      expect(mapped.ok).toBe(true);
      if (!mapped.ok) return;
      const status = (actions: readonly unknown[]) => intakeGrantStatusForGrants(actions.map(action => grant(action)), now);
      expect(status(mapped.actions)).toMatchObject({ choices: [post], hasOther: false });
      expect(status([...mapped.actions].reverse())).toMatchObject({ choices: [post], hasOther: false });
      expect(status([...mapped.actions, 'rollback'])).toMatchObject({ choices: [post], hasOther: true });
    }
    expect(intakeGrantStatusForGrants([], now).choices).toEqual([]);
    expect(intakeGrantStatusForGrants([grant('nope')], now)).toMatchObject({ choices: [], hasOther: true });
    expect(intakeGrantStatusForGrants(['query', 'content-manage', 'review'].map(action => grant(action)), now))
      .toEqual({ choices: ['客服', '资料审核'], hasOther: false, status: '已授权' });
    expect(intakeGrantStatusForGrants(['query', 'content-manage', 'review', 'rollback'].map(action => grant(action)), now))
      .toEqual({ choices: ['客服', '资料审核'], hasOther: true, status: '已授权' });
  });

  it('offers a post only when the scope covers every action', () => {
    const supervisor = actionsForIntakePost('客服主管');
    const agent = actionsForIntakePost('客服');
    expect(supervisor.ok).toBe(true);
    expect(agent.ok).toBe(true);
    if (!supervisor.ok || !agent.ok) return;
    expect(intakeGrantChoicesCoveredBy([...agent.actions])).toEqual(['客服']);
    expect(intakeGrantChoicesCoveredBy([...supervisor.actions, ...agent.actions])).toEqual(['客服', '客服主管']);
    expect(intakeGrantChoicesCoveredBy(supervisor.actions.slice(0, -1))).toEqual([]);
    expect(intakeGrantChoicesCoveredBy([])).toEqual([]);
  });

  it('reads grant status from live actions', () => {
    const agent = actionsForIntakePost('客服');
    expect(agent.ok).toBe(true);
    if (!agent.ok) return;
    const live = agent.actions.map(action => grant(action));
    expect(intakeGrantStatusForGrants(live, now)).toEqual({ choices: ['客服'], hasOther: false, status: '已授权' });
    expect(intakeGrantStatusForGrants(live.map(item => ({ ...item, revoked: true })), now)).toEqual({ choices: [], hasOther: false, status: '已撤销' });
    expect(intakeGrantStatusForGrants([], now)).toEqual({ choices: [], hasOther: false, status: '未授权' });
    expect(intakeGrantStatusForGrants([grant('rollback')], now)).toEqual({ choices: [], hasOther: true, status: '已授权' });
    expect(intakeGrantStatusForGrants([...live, ...live], now)).toEqual({ choices: ['客服'], hasOther: false, status: '已授权' });
    expect(intakeGrantStatusForGrants([grant('query', { startsAt: '2019-01-01T00:00:00Z', expiresAt: '2020-01-01T00:00:00Z' })], now))
      .toEqual({ choices: ['客服'], hasOther: false, status: '已过期' });
    expect(intakeGrantStatusForGrants([grant('query')], now)).toEqual({ choices: ['客服'], hasOther: false, status: '已授权' });
  });

  it('separates future, partially live and invalid time windows from current authorization', () => {
    const start='2026-10-30T00:00:01.000Z', end='2026-10-30T00:00:02.000Z';
    const future=grant('query', { startsAt:start, expiresAt:end });
    expect(intakeGrantStatusForGrants([future], now)).toEqual({ choices: ['客服'], hasOther: false, status: '未生效' });
    expect(intakeGrantStatusForGrants([future], Date.parse(start)).status).toBe('已授权');
    expect(intakeGrantStatusForGrants([future], Date.parse(end)).status).toBe('已过期');
    expect(intakeGrantStatusForGrants([grant('query', { startsAt:'2026-10-30T08:00:00+08:00', expiresAt:'2026-10-30T08:00:01+08:00' })], now).status).toBe('已授权');
    expect(intakeGrantStatusForGrants([grant('query'), grant('review', { startsAt:start, expiresAt:end })], now))
      .toEqual({ choices: ['客服'], hasOther: false, status: '部分生效' });
    for (const bad of [
      { startsAt:'not-a-date' }, { expiresAt:'' }, { startsAt:'2026-02-30T00:00:00Z' },
      { startsAt:'2099-01-01T00:00:00Z', expiresAt:'2020-01-01T00:00:00Z' },
    ]) {
      expect(intakeGrantStatusForGrants([grant('query', bad)], now)).toEqual({ choices: [], hasOther: false, status: '时间异常' });
      expect(intakeGrantStatusForGrants([grant('query'), grant('review', bad)], now).status).toBe('时间异常');
    }
  });

  it('offers quality review only as the two required actions, not as a seat post', () => {
    expect(actionsForIntakeGrantChoice('资料审核')).toEqual(['content-manage', 'review']);
    expect(actionsForIntakePost('资料审核')).toEqual({ ok: false, error: 'unknown-post' });
    expect(intakeGrantChoicesCoveredBy(['content-manage'])).toEqual([]);
    expect(intakeGrantChoicesCoveredBy(['review'])).toEqual([]);
    expect(intakeGrantChoicesCoveredBy(['content-manage', 'review'])).toEqual(['资料审核']);
    expect(intakeGrantStatusForGrants([
      grant('content-manage'), grant('review'),
    ], now)).toEqual({ choices: ['资料审核'], hasOther: false, status: '已授权' });
  });

  it('does not import a UI runtime', () => {
    const source = readFileSync(MODULE_PATH, 'utf8');
    const imports = source.split('\n').filter((line) => /^\s*import\b/.test(line)).join('\n');
    expect(imports).not.toMatch(/\breact\b/);
    expect(imports).not.toMatch(/\belectron\b/);
  });
});
