import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { feishuAdmitOpenId, feishuUserId } from '../src/feishu-admit.js';
import { JOB_ROSTER, matchJobRoster, parseRosterJobResponse } from '@customer-agent/job-roster';

const rosterPackageFiles = [
  'packages/job-roster/package.json',
  'packages/job-roster/src/index.ts',
  'packages/job-roster/tsconfig.json',
  'packages/job-roster/tsconfig.build.json',
] as const;

describe('job roster', () => {
  it('reads the shared roster package that login and the desktop both use', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const pkg = JSON.parse(readFileSync(path.join(root, rosterPackageFiles[0]), 'utf8')) as { name: string; private: boolean };
    expect(pkg).toMatchObject({ name: '@customer-agent/job-roster', private: true });
    for (const file of rosterPackageFiles) {
      expect(readFileSync(path.join(root, file), 'utf8').length).toBeGreaterThan(0);
    }
  });

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

  it('keeps seat and director rights on the desktop row', () => {
    const seat = matchJobRoster('客服坐席');
    const director = matchJobRoster('客服总监');
    if (seat.status !== 'matched' || director.status !== 'matched') throw new Error('roster titles missing');
    expect(seat.row.rights).toMatchObject({ publish: false, grant: false, uploadSop: false, search: true });
    expect(director.row.rights).toMatchObject({ publish: true, grant: true, uploadSop: true, search: true });
    expect(seat.row.jobId).toBe('job-customer-service-seat');
  });

  it('matches one live alias and stops on an expired or ambiguous alias', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const live = { title: '坐席', jobId: 'job-customer-service-seat', validFrom: '2026-01-01T00:00:00Z', validUntil: '2027-01-01T00:00:00Z' };
    const expired = { ...live, validUntil: '2026-05-01T00:00:00Z' };
    const other = { ...live, jobId: 'job-customer-service-agent' };
    expect(matchJobRoster('坐席', now, [live])).toMatchObject({ status: 'matched', row: { jobId: 'job-customer-service-seat' } });
    expect(matchJobRoster('坐席', now, [expired])).toEqual({ status: 'unmatched', reason: 'expired' });
    expect(matchJobRoster('坐席', now, [live, other])).toEqual({ status: 'unmatched', reason: 'ambiguous' });
    expect(matchJobRoster('客服坐席', now, [other])).toMatchObject({ status: 'matched', row: { jobId: 'job-customer-service-seat' } });
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

  // Value: protects=parseRosterJobResponse exact-key contract; fails_when=extra top-level or directory keys slip through desktop main; why_new=desktop main is the only caller test for strict parsing; seam=none; no_claim=preload copy parity
  it('rejects extra keys and wrong denial messages on the job route body', () => {
    const valid = {
      title: '客服坐席',
      directory: [{ name: '客服坐席', enabled: true }],
      permission_state: 'revoked',
      message: '没有权限，请找人开通。',
    };
    expect(parseRosterJobResponse(valid)).toEqual(valid);
    expect(parseRosterJobResponse({ ...valid, trace: 'x' })).toBeNull();
    expect(parseRosterJobResponse({
      ...valid,
      directory: [{ name: '客服坐席', enabled: true, extra: true }],
    })).toBeNull();
    expect(parseRosterJobResponse({ ...valid, message: null })).toBeNull();
    expect(parseRosterJobResponse({
      title: '客服坐席',
      directory: [{ name: '客服坐席', enabled: true }],
      permission_state: 'ready',
      message: null,
    })).toMatchObject({ permission_state: 'ready', message: null });
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
