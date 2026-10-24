import { describe, expect, it } from 'vitest';
import { observeSessionJob } from '../../src/shared/product-session';
import { accessBlock } from '../../src/shared/workbench-access';

const job = (title: string, permission: 'ready' | 'expired' = 'ready') => observeSessionJob({
  title,
  directory: [{ name: title, enabled: true }],
  actions: { query: true, import: false, publish: false, rollback: false },
  permissionState: permission,
});

describe('workbench access display', () => {
  it('shows nothing while the session has not answered', () => {
    expect(accessBlock('grant', null, null)).toBeNull();
  });

  it('asks a signed-out person to sign in, not to request access', () => {
    expect(accessBlock('grant', false, null)).toEqual({ need: '给他人开通权限', ask: '管理员', detail: '请先登录。' });
  });

  it('sends an unrecognised title to the administrator', () => {
    expect(accessBlock('upload-sop', true, job('不存在的职务'))).toMatchObject({ ask: '管理员', detail: '你的职务还没有登记，请联系管理员。' });
  });

  it('asks for a fresh sign-in when the session did not deliver a job', () => {
    expect(accessBlock('grant', true, observeSessionJob(null))).toMatchObject({ detail: '请重新登录后再查看职务。' });
    expect(accessBlock('grant', true, null)).toMatchObject({ detail: '请重新登录后再查看职务。' });
  });

  it('names the role that can open each missing ability', () => {
    expect(accessBlock('grant', true, job('客服主管'))).toEqual({ need: '给他人开通权限', ask: '你的经理' });
    expect(accessBlock('upload-sop', true, job('普通客服'))).toEqual({ need: '上传 SOP', ask: '客服主管' });
  });

  it('stays out of the way when the roster already allows the ability', () => {
    expect(accessBlock('grant', true, job('客服经理'))).toBeNull();
    expect(accessBlock('upload-sop', true, job('客服主管'))).toBeNull();
  });

  it('treats an expired facts window as a sign-in problem, not a missing grant', () => {
    expect(accessBlock('grant', true, job('客服经理', 'expired'))).toMatchObject({ detail: '登录状态需要确认，请重新登录。' });
  });
});
