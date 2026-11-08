import { describe, expect, it, vi } from 'vitest';
import {
  advanceSopPipeline,
  buildSopClipboardPayload,
  chooseSopPipelineBranch,
  isSopPipelineProjection,
  markSopPipelineCopied,
  projectSopPipeline,
  SopPipelinePresenter,
  startSopPipelineSession,
  updateSopPipelineLease,
  writeSopClipboard,
  type SopPipelineFlow,
  type SopPipelineLease,
  type SopMediaAsset,
} from '../../src/shared/sop-pipeline';

const flow: SopPipelineFlow = {
  sopId: 'synthetic-allergy',
  title: '合成过敏流程',
  entryStepId: 'step1',
  steps: [
    { stepId: 'step1', kind: 'instruction', sequence: 1, text: '第一步合成话术', media: [] },
    { stepId: 'step2', kind: 'instruction', sequence: 2, text: '第二步合成话术', media: ['med-a'] },
    { stepId: 'A', kind: 'decision', sequence: 3, text: '请坐席选择', media: [] },
    { stepId: 'A1', kind: 'terminal', sequence: 4, text: '分支 A 合成话术', media: [] },
  ],
  branches: [{ branchId: 'branch-a', sourceStepId: 'A', label: '选择 A', targetStepId: 'A1' }],
};

const lease: SopPipelineLease = {
  releaseId: 'rel_synthetic_1',
  sessionEpoch: 1,
  revoked: false,
  expiresAt: '2099-01-01T00:00:00.000Z',
};

const png: SopMediaAsset = {
  mediaId: 'med-a',
  mime: 'image/png',
  bytes: Uint8Array.from([137, 80, 78, 71]),
};
const mediaMetadata = [{ mediaId: png.mediaId, mime: png.mime }] as const;

describe('typed SOP pipeline desktop state', () => {
  it('requires the sales agent to choose a decision branch', () => {
    let session = startSopPipelineSession(flow, lease, mediaMetadata);
    session = advanceSopPipeline(session)!;
    expect(session.currentStepId).toBe('step2');
    session = advanceSopPipeline(session)!;
    expect(session.currentStepId).toBe('A');
    expect(advanceSopPipeline(session)).toBeNull();
    expect(projectSopPipeline(session, 1).branches).toEqual([{ branchId: 'branch-a', label: '选择 A' }]);
    expect(chooseSopPipelineBranch(session, 'missing')).toBeNull();
    expect(chooseSopPipelineBranch(session, 'branch-a')?.currentStepId).toBe('A1');
  });

  it('invalidates release changes, revocation, and expiry before copy', () => {
    let session = startSopPipelineSession(flow, lease, mediaMetadata);
    expect(projectSopPipeline(updateSopPipelineLease(session, { ...lease, releaseId: 'rel_other' }), 1))
      .toMatchObject({ state: 'invalidated', failCode: 'SOP_RELEASE_CHANGED' });
    expect(projectSopPipeline(updateSopPipelineLease(session, { ...lease, sessionEpoch: 2 }), 1))
      .toMatchObject({ state: 'invalidated', failCode: 'SOP_SESSION_CHANGED' });
    expect(projectSopPipeline(updateSopPipelineLease(session, { ...lease, revoked: true }), 1))
      .toMatchObject({ state: 'invalidated', failCode: 'SOP_REVOKED' });
    expect(projectSopPipeline(updateSopPipelineLease(session, { ...lease, expiresAt: '2020-01-01T00:00:00.000Z' }), 1))
      .toMatchObject({ state: 'invalidated', failCode: 'SOP_EXPIRED' });
    session = updateSopPipelineLease(session, { ...lease, revoked: true });
    expect(() => buildSopClipboardPayload(session, [png])).toThrow('SOP_REVOKED');
  });

  it('keeps the renderer projection minimal and serializable', () => {
    let session = startSopPipelineSession(flow, lease, mediaMetadata);
    session = advanceSopPipeline(session)!;
    const projection = projectSopPipeline(markSopPipelineCopied(session), 1);
    expect(isSopPipelineProjection(projection)).toBe(true);
    expect(JSON.stringify(projection)).not.toContain('bytes');
    expect(JSON.stringify(projection)).not.toContain('path');
    expect(isSopPipelineProjection({ ...projection, rawPath: '/synthetic/private.png' })).toBe(false);
  });

  it('fails the projection when a bound image has no metadata', () => {
    let session = startSopPipelineSession(flow, lease);
    session = advanceSopPipeline(session)!;
    expect(projectSopPipeline(session, 1)).toMatchObject({
      state: 'failed',
      failCode: 'SOP_MEDIA_MISSING',
      media: [],
    });
  });

  it('builds text plus image and performs one native clipboard write', () => {
    let session = startSopPipelineSession(flow, lease, mediaMetadata);
    session = advanceSopPipeline(session)!;
    const payload = buildSopClipboardPayload(session, [png]);
    expect(payload.text).toBe('第二步合成话术');
    expect(payload.images).toEqual([png]);
    const write = vi.fn();
    const createImage = vi.fn((bytes: Uint8Array) => ({ bytes }));
    writeSopClipboard({ write }, createImage, payload);
    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      text: '第二步合成话术',
      html: expect.stringContaining('data:image/png;base64,'),
      image: { bytes: png.bytes },
    }));
  });

  it('keeps every bound image in the single rich clipboard payload', () => {
    const gif: SopMediaAsset = {
      mediaId: 'med-b',
      mime: 'image/gif',
      bytes: Uint8Array.from([71, 73, 70, 56, 57, 97]),
    };
    const multi = startSopPipelineSession(
      {
        ...flow,
        steps: [
          ...flow.steps,
          { stepId: 'multi', kind: 'instruction', sequence: 5, text: '两张图片', media: ['med-a', 'med-b'] },
        ],
      },
      lease,
      [...mediaMetadata, { mediaId: 'med-b', mime: 'image/gif' }],
    );
    const session = { ...multi, currentStepId: 'multi' };
    const payload = buildSopClipboardPayload(session, [png, gif]);
    expect(payload.images).toEqual([png, gif]);
    expect(payload.html.match(/<img\b/gu)).toHaveLength(2);
    expect(payload.html).toContain('data:image/gif;base64,');
  });

  it('keeps text-only steps text-only and fails instead of dropping image bytes', () => {
    const textOnly = startSopPipelineSession(flow, lease, mediaMetadata);
    const payload = buildSopClipboardPayload(textOnly, []);
    const write = vi.fn();
    writeSopClipboard({ write }, vi.fn(), payload);
    expect(write).toHaveBeenCalledWith({ text: '第一步合成话术', html: '<div>第一步合成话术</div>' });
    expect(payload.images).toEqual([]);

    const imageStep = advanceSopPipeline(textOnly)!;
    expect(() => buildSopClipboardPayload(imageStep, [])).toThrow('SOP_MEDIA_MISSING');
  });

  it('rechecks the lease after asynchronous media reads and writes only the exact step', async () => {
    let current = lease;
    const writePayload = vi.fn();
    const presenter = new SopPipelinePresenter({
      flow,
      lease,
      mediaMetadata,
      sessionId: 1,
      currentLease: () => current,
      readAssets: async () => [png],
      writePayload,
    });
    presenter.nextStep();
    await expect(presenter.copyCurrent()).resolves.toMatchObject({ copied: true });
    expect(writePayload).toHaveBeenCalledOnce();
    expect(writePayload).toHaveBeenCalledWith(expect.objectContaining({
      text: '第二步合成话术',
      images: [png],
    }));

    const stalePresenter = new SopPipelinePresenter({
      flow,
      lease,
      mediaMetadata,
      sessionId: 2,
      currentLease: () => current,
      readAssets: async () => {
        current = { ...lease, revoked: true };
        return [png];
      },
      writePayload,
    });
    stalePresenter.nextStep();
    await expect(stalePresenter.copyCurrent()).rejects.toThrow('SOP_REVOKED');
    expect(writePayload).toHaveBeenCalledOnce();

    const changedStepPresenter = new SopPipelinePresenter({
      flow,
      lease,
      mediaMetadata,
      sessionId: 3,
      currentLease: () => lease,
      readAssets: async () => {
        changedStepPresenter.nextStep();
        return [png];
      },
      writePayload,
    });
    changedStepPresenter.nextStep();
    await expect(changedStepPresenter.copyCurrent()).rejects.toThrow('SOP_STEP_CHANGED');
    expect(writePayload).toHaveBeenCalledOnce();
  });

  it('restarts from the published entry step without reusing copied progress', () => {
    const presenter = new SopPipelinePresenter({
      flow,
      lease,
      mediaMetadata,
      sessionId: 1,
      currentLease: () => lease,
      readAssets: async () => [png],
      writePayload: vi.fn(),
    });
    presenter.nextStep();
    const restarted = new SopPipelinePresenter({
      flow,
      lease,
      mediaMetadata,
      sessionId: 2,
      currentLease: () => lease,
      readAssets: async () => [png],
      writePayload: vi.fn(),
    });
    expect(restarted.projection()).toMatchObject({
      sessionId: 2,
      currentStepId: 'step1',
      copied: false,
    });
  });
});
