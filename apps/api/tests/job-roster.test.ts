import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { feishuAdmitOpenId, feishuUserId } from '../src/feishu-admit.js';
import { JOB_ROSTER, matchJobRoster, rosterGrantActions } from '../src/job-roster.js';

describe('job roster', () => {
  it('matches one exact Feishu title and keeps search on the content shops', () => {
    const match = matchJobRoster('  AI赋能工程师  ');
    expect(match).toMatchObject({
      status: 'matched',
      row: { jobId: 'job-ai-enablement-engineer', title: 'AI赋能工程师', role: 'engineer', shops: 'content-shops', rights: { search: true, grant: true } },
    });
    expect(JOB_ROSTER.map((row) => row.title)).toEqual([
      '客服总监', '客服经理', '客服主管', '客服组长', 'AI赋能工程师', '普通客服', '客服坐席',
    ]);
  });

  it('copies query for a seat and publish plus import for a director', () => {
    const seat = matchJobRoster('客服坐席');
    const director = matchJobRoster('客服总监');
    if (seat.status !== 'matched' || director.status !== 'matched') throw new Error('roster titles missing');
    expect(rosterGrantActions(seat.row.rights)).toEqual(['query']);
    expect(rosterGrantActions(director.row.rights)).toEqual(['query', 'publish', 'import']);
    expect(seat.row.rights.grant).toBe(false);
    expect(director.row.rights.grant).toBe(true);
  });

  it('rejects a blank title and a title that is not on the roster', () => {
    expect(matchJobRoster('   ')).toEqual({ status: 'unmatched', reason: 'blank' });
    expect(matchJobRoster('服务赋能师')).toEqual({ status: 'unmatched', reason: 'unknown' });
  });

  it('normalizes only Unicode and whitespace formatting and keeps two agent jobs distinct', () => {
    expect(matchJobRoster('\u3000客服坐席\u3000')).toMatchObject({ status: 'matched', row: { jobId: 'job-customer-service-seat' } });
    const ordinary = matchJobRoster('普通客服');
    const seat = matchJobRoster('客服坐席');
    if (ordinary.status !== 'matched' || seat.status !== 'matched') throw new Error('roster titles missing');
    expect(ordinary.row.jobId).not.toBe(seat.row.jobId);
  });
});

describe('feishu admit', () => {
  it('admits one open id and keeps the same user id on the next login', () => {
    const openId = 'ou_abcdef';
    expect(feishuAdmitOpenId('CAPABILITY_DENIED', openId)).toBe(openId);
    expect(feishuAdmitOpenId('CAPABILITY_DENIED', openId)).toBe(feishuUserId(openId).slice(4));
    expect(feishuAdmitOpenId('LOGIN_INVALID', openId)).toBeNull();
    expect(feishuAdmitOpenId('CAPABILITY_DENIED', 'not-an-open-id')).toBeNull();
    expect(feishuAdmitOpenId('CAPABILITY_DENIED', null)).toBeNull();
  });

  it('leaves an existing binding row unchanged', () => {
    const sql = readFileSync(new URL('../../../packages/database/migrations/0045_feishu_agent_admit.sql', import.meta.url), 'utf8');
    expect(sql).toContain('ON CONFLICT (binding_id) DO NOTHING');
  });
});
