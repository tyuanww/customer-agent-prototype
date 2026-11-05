export type SopPipelineStepKind = 'instruction' | 'decision' | 'terminal';

export type SopPipelineFlow = Readonly<{
  sopId: string;
  title: string;
  entryStepId: string;
  steps: readonly Readonly<{
    stepId: string;
    kind: SopPipelineStepKind;
    sequence: number;
    text: string;
    media: readonly string[];
  }>[];
  branches: readonly Readonly<{
    branchId: string;
    sourceStepId: string;
    label: string;
    targetStepId: string;
  }>[];
}>;

export type SopPipelineLease = Readonly<{
  releaseId: string;
  sessionEpoch: number;
  revoked: boolean;
  expiresAt: string;
}>;

export type SopPipelineProjection = Readonly<{
  projectionVersion: 'sop-pipeline-v1';
  sessionId: number;
  state: 'ready' | 'invalidated' | 'failed';
  releaseId: string;
  sessionEpoch: number;
  expiresAt: string;
  sopId: string;
  title: string;
  currentStepId: string;
  stepKind: SopPipelineStepKind | 'opening';
  stepText: string;
  media: readonly Readonly<{
    mediaId: string;
    mime: 'image/png' | 'image/jpeg' | 'image/gif';
  }>[];
  branches: readonly Readonly<{
    branchId: string;
    label: string;
  }>[];
  canNext: boolean;
  terminal: boolean;
  copied: boolean;
  failCode:
    | 'SOP_SESSION_CHANGED'
    | 'SOP_RELEASE_CHANGED'
    | 'SOP_REVOKED'
    | 'SOP_EXPIRED'
    | 'SOP_MEDIA_MISSING'
    | null;
}>;

export type SopPipelineSession = Readonly<{
  flow: SopPipelineFlow;
  lease: SopPipelineLease;
  mediaMetadata: readonly Readonly<{
    mediaId: string;
    mime: 'image/png' | 'image/jpeg' | 'image/gif';
  }>[];
  currentStepId: string;
  copied: boolean;
  invalidated: SopPipelineProjection['failCode'];
}>;

export type SopMediaAsset = Readonly<{
  mediaId: string;
  mime: 'image/png' | 'image/jpeg' | 'image/gif';
  bytes: Uint8Array;
}>;

export type SopClipboardPayload = Readonly<{
  text: string;
  html: string;
  images: readonly SopMediaAsset[];
}>;

type NativeImage = unknown;
export type SopClipboardPort = Readonly<{
  write(data: Readonly<{ text: string; html: string; image?: NativeImage }>): void;
}>;
export type SopNativeImageFactory = (bytes: Uint8Array) => NativeImage | null;

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function leaseFailure(session: SopPipelineSession, now: number): SopPipelineProjection['failCode'] {
  if (session.lease.revoked) return 'SOP_REVOKED';
  const expiresAt = Date.parse(session.lease.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return 'SOP_EXPIRED';
  return null;
}

export function startSopPipelineSession(
  flow: SopPipelineFlow,
  lease: SopPipelineLease,
  mediaMetadata: SopPipelineSession['mediaMetadata'] = [],
): SopPipelineSession {
  return {
    flow,
    lease,
    mediaMetadata,
    currentStepId: flow.entryStepId,
    copied: false,
    invalidated: leaseFailure({
      flow,
      lease,
      mediaMetadata,
      currentStepId: flow.entryStepId,
      copied: false,
      invalidated: null,
    }, Date.now()),
  };
}

export function updateSopPipelineLease(
  session: SopPipelineSession,
  lease: SopPipelineLease,
  now = Date.now(),
): SopPipelineSession {
  const invalidated = lease.releaseId !== session.lease.releaseId
    ? 'SOP_RELEASE_CHANGED'
    : lease.sessionEpoch !== session.lease.sessionEpoch
      ? 'SOP_SESSION_CHANGED'
    : leaseFailure({ ...session, lease }, now);
  return { ...session, lease, invalidated, copied: invalidated === null ? session.copied : false };
}

export function chooseSopPipelineBranch(
  session: SopPipelineSession,
  branchId: string,
  now = Date.now(),
): SopPipelineSession | null {
  const invalidated = leaseFailure(session, now);
  if (invalidated !== null || session.invalidated !== null) return null;
  const branch = session.flow.branches.find((candidate) =>
    candidate.branchId === branchId && candidate.sourceStepId === session.currentStepId);
  if (!branch || !session.flow.steps.some((step) => step.stepId === branch.targetStepId)) return null;
  return {
    ...session,
    currentStepId: branch.targetStepId,
    copied: false,
    invalidated: null,
  };
}

export function advanceSopPipeline(
  session: SopPipelineSession,
  now = Date.now(),
): SopPipelineSession | null {
  const invalidated = leaseFailure(session, now);
  if (invalidated !== null || session.invalidated !== null) return null;
  const current = currentSopPipelineStep(session);
  if (!current || current.kind === 'decision') return null;
  const next = session.flow.steps
    .filter((step) => step.sequence > current.sequence)
    .sort((left, right) => left.sequence - right.sequence)[0];
  if (!next) return null;
  return { ...session, currentStepId: next.stepId, copied: false, invalidated: null };
}

export function currentSopPipelineStep(
  session: SopPipelineSession,
): SopPipelineFlow['steps'][number] | undefined {
  return session.flow.steps.find((step) => step.stepId === session.currentStepId);
}

export function markSopPipelineCopied(session: SopPipelineSession): SopPipelineSession {
  return session.invalidated === null ? { ...session, copied: true } : session;
}

export function projectSopPipeline(
  session: SopPipelineSession,
  sessionId: number,
): SopPipelineProjection {
  const current = currentSopPipelineStep(session);
  const invalidated = session.invalidated;
  const media = (current?.media ?? []).map((mediaId) => {
    const metadata = session.mediaMetadata.find((item) => item.mediaId === mediaId);
    return metadata ?? null;
  });
  const missingMedia = media.some((item) => item === null);
  return {
    projectionVersion: 'sop-pipeline-v1',
    sessionId,
    state: missingMedia ? 'failed' : invalidated === null ? 'ready' : 'invalidated',
    releaseId: session.lease.releaseId,
    sessionEpoch: session.lease.sessionEpoch,
    expiresAt: session.lease.expiresAt,
    sopId: session.flow.sopId,
    title: session.flow.title,
    currentStepId: current?.stepId ?? session.currentStepId,
    stepKind: current?.kind ?? 'opening',
    stepText: current?.text ?? '',
    media: media.filter((item): item is NonNullable<typeof item> => item !== null),
    branches: invalidated === null && current?.kind === 'decision'
      ? session.flow.branches
          .filter((branch) => branch.sourceStepId === current.stepId)
          .map((branch) => ({ branchId: branch.branchId, label: branch.label }))
      : [],
    canNext: invalidated === null && current?.kind === 'instruction'
      && session.flow.steps.some((step) => step.sequence > current.sequence),
    terminal: invalidated === null && current?.kind === 'terminal',
    copied: invalidated === null && session.copied,
    failCode: missingMedia ? 'SOP_MEDIA_MISSING' : invalidated,
  };
}

export function isSopPipelineProjection(value: unknown): value is SopPipelineProjection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const projection = value as Record<string, unknown>;
  if (!exactKeys(projection, [
    'projectionVersion', 'sessionId', 'state', 'releaseId', 'sessionEpoch',
    'expiresAt', 'sopId', 'title', 'currentStepId', 'stepKind', 'stepText',
    'media', 'branches', 'canNext', 'terminal', 'copied', 'failCode',
  ])) return false;
  return projection.projectionVersion === 'sop-pipeline-v1'
    && Number.isSafeInteger(projection.sessionId)
    && Number(projection.sessionId) > 0
    && ['ready', 'invalidated', 'failed'].includes(String(projection.state))
    && nonEmpty(projection.releaseId)
    && Number.isSafeInteger(projection.sessionEpoch)
    && Number(projection.sessionEpoch) > 0
    && nonEmpty(projection.expiresAt)
    && nonEmpty(projection.sopId)
    && typeof projection.title === 'string'
    && nonEmpty(projection.currentStepId)
    && ['instruction', 'decision', 'terminal', 'opening'].includes(String(projection.stepKind))
    && typeof projection.stepText === 'string'
    && Array.isArray(projection.media)
    && projection.media.every((item) => item && typeof item === 'object'
      && nonEmpty((item as Record<string, unknown>).mediaId)
      && ['image/png', 'image/jpeg', 'image/gif'].includes(String((item as Record<string, unknown>).mime)))
    && Array.isArray(projection.branches)
    && projection.branches.every((item) => item && typeof item === 'object'
      && nonEmpty((item as Record<string, unknown>).branchId)
      && nonEmpty((item as Record<string, unknown>).label))
    && typeof projection.canNext === 'boolean'
    && typeof projection.terminal === 'boolean'
    && typeof projection.copied === 'boolean'
    && (projection.failCode === null || [
      'SOP_RELEASE_CHANGED',
      'SOP_SESSION_CHANGED',
      'SOP_REVOKED',
      'SOP_EXPIRED',
      'SOP_MEDIA_MISSING',
    ].includes(String(projection.failCode)));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function dataUrl(asset: SopMediaAsset): string {
  return `data:${asset.mime};base64,${Buffer.from(asset.bytes).toString('base64')}`;
}

/** Build one clipboard payload from the exact published step. Missing media is
 * a hard error, never a text-only fallback. */
export function buildSopClipboardPayload(
  session: SopPipelineSession,
  assets: readonly SopMediaAsset[],
): SopClipboardPayload {
  if (session.invalidated !== null) throw new Error(session.invalidated);
  const step = currentSopPipelineStep(session);
  if (!step) throw new Error('SOP_STEP_MISSING');
  const byId = new Map(assets.map((asset) => [asset.mediaId, asset]));
  const images = step.media.map((mediaId) => {
    const asset = byId.get(mediaId);
    if (!asset || asset.bytes.length === 0) throw new Error('SOP_MEDIA_MISSING');
    return asset;
  });
  return {
    text: step.text,
    html: [
      `<div>${escapeHtml(step.text).replaceAll('\n', '<br>')}</div>`,
      ...images.map((asset) => `<img src="${dataUrl(asset)}" alt="">`),
    ].join(''),
    images,
  };
}

/** Native callers inject Electron's clipboard and nativeImage. Image-bearing
 * steps execute exactly one `clipboard.write`; no partial text-only write runs. */
export function writeSopClipboard(
  clipboard: SopClipboardPort,
  createImage: SopNativeImageFactory,
  payload: SopClipboardPayload,
): void {
  if (payload.images.length === 0) {
    clipboard.write({ text: payload.text, html: payload.html });
    return;
  }
  const image = createImage(payload.images[0]!.bytes);
  if (!image) throw new Error('SOP_MEDIA_MISSING');
  clipboard.write({ text: payload.text, html: payload.html, image });
}

export type SopPipelinePresenterOptions = Readonly<{
  flow: SopPipelineFlow;
  lease: SopPipelineLease;
  mediaMetadata: SopPipelineSession['mediaMetadata'];
  sessionId: number;
  currentLease: () => SopPipelineLease;
  readAssets: (mediaIds: readonly string[]) => Promise<readonly SopMediaAsset[]>;
  writePayload: (payload: SopClipboardPayload) => void;
}>;

/** Main-owned state for the typed SOP surface. INT-DESKTOP wires the projection
 * and lease events; this class keeps copy authority and native bytes out of the
 * renderer and rechecks the lease before and after asynchronous asset reads. */
export class SopPipelinePresenter {
  readonly #sessionId: number;
  readonly #currentLease: () => SopPipelineLease;
  readonly #readAssets: SopPipelinePresenterOptions['readAssets'];
  readonly #writePayload: SopPipelinePresenterOptions['writePayload'];
  #session: SopPipelineSession;

  constructor(options: SopPipelinePresenterOptions) {
    if (!Number.isSafeInteger(options.sessionId) || options.sessionId < 1) {
      throw new Error('SOP_SESSION_INVALID');
    }
    this.#sessionId = options.sessionId;
    this.#currentLease = options.currentLease;
    this.#readAssets = options.readAssets;
    this.#writePayload = options.writePayload;
    this.#session = startSopPipelineSession(
      options.flow,
      options.lease,
      options.mediaMetadata,
    );
  }

  projection(): SopPipelineProjection {
    return projectSopPipeline(this.#session, this.#sessionId);
  }

  refreshLease(): SopPipelineProjection {
    this.#session = updateSopPipelineLease(this.#session, this.#currentLease());
    return this.projection();
  }

  chooseBranch(branchId: string): SopPipelineProjection {
    this.refreshLease();
    const next = chooseSopPipelineBranch(this.#session, branchId);
    if (!next) throw new Error('SOP_BRANCH_INVALID');
    this.#session = next;
    return this.projection();
  }

  nextStep(): SopPipelineProjection {
    this.refreshLease();
    const next = advanceSopPipeline(this.#session);
    if (!next) throw new Error('SOP_NEXT_INVALID');
    this.#session = next;
    return this.projection();
  }

  async copyCurrent(): Promise<SopPipelineProjection> {
    this.refreshLease();
    if (this.#session.invalidated !== null) throw new Error(this.#session.invalidated);
    const step = currentSopPipelineStep(this.#session);
    if (!step || step.kind === 'decision' || !step.text.trim()) throw new Error('SOP_STEP_NOT_COPYABLE');
    const requestedStepId = step.stepId;
    const assets = await this.#readAssets(step.media);
    this.#session = updateSopPipelineLease(this.#session, this.#currentLease());
    if (this.#session.invalidated !== null) throw new Error(this.#session.invalidated);
    if (this.#session.currentStepId !== requestedStepId) throw new Error('SOP_STEP_CHANGED');
    const payload = buildSopClipboardPayload(this.#session, assets);
    this.#writePayload(payload);
    this.#session = markSopPipelineCopied(this.#session);
    return this.projection();
  }
}
