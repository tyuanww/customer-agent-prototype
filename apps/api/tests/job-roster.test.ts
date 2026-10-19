import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { feishuAdmitOpenId, feishuUserId } from '../src/feishu-admit.js';
import { JOB_ROSTER, matchJobRoster } from '../src/job-roster.js';

describe('job roster', () => {
  it('matches one exact Feishu title and keeps search on the content shops', () => {
    const match = matchJobRoster('  AI赋能工程师  ');
    expect(match).toMatchObject({
      status: 'matched',
      row: { title: 'AI赋能工程师', shops: 'content-shops', actions: { search: true, grant: true } },
    });
    expect(JOB_ROSTER.map((row) => row.title)).toEqual([
      '客服总监', '客服经理', '客服主管', '客服组长', 'AI赋能工程师', '普通客服', '客服坐席',
    ]);
  });

  it('rejects a blank title and a title that is not on the roster', () => {
    expect(matchJobRoster('   ')).toEqual({ status: 'unmatched', reason: 'blank' });
    expect(matchJobRoster('服务赋能师')).toEqual({ status: 'unmatched', reason: 'unknown' });
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
