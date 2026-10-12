import { parseContractSchema, type components } from '@customer-agent/contracts';
import { INTAKE_POLICY } from '@customer-agent/content-intake';
import { canonical, digest } from './material.js';
import { IntakeRejection } from './transaction.js';

type Key = components['schemas']['IntakeCandidateKey'];
type BindingBase = {
  reviewRequestId: string; evidenceVersion: number; tenantId: string; appId: string;
  definitionId: string; nodeId: string; createUuid: string;
  packageObjectId: string; packageSha256: string; packageBytes: number;
  createdAt: string;
  instanceCode: string | null; attachmentFileCode: string | null;
};
export type CandidateReviewBinding = BindingBase & { key: Key };
export type RollbackReviewBinding = BindingBase & { rollbackPlanId: string; impactDigest: string };
export type ReviewBinding = CandidateReviewBinding | RollbackReviewBinding;
export type ReviewRoute = Pick<ReviewBinding, 'tenantId' | 'appId' | 'definitionId' | 'nodeId'>;
export type HumanDecision = { identityScope: string; personKey: string; taskId: string; decidedAt: string };
export type ApprovalObservation = { state: 'pending' | 'approved' | 'rejected' | 'revoked';
  rawDigest: string; packageSha256: string | null; human: HumanDecision | null };

/** Server-owned transport, never a request body or worker's `approved` declaration.
 * This normalized protocol is consumed by the synthetic transport only today.
 * A real Feishu transport must authenticate its tenant/app, translate native task/
 * timeline/form data and recover creation by this same UUID; it is not implemented here.
 * No URL/path is accepted. Each implementation must honor AbortSignal and byte limits. */
export type ApprovalTransport = {
  create(binding: ReviewBinding, packageBytes: Buffer, signal: AbortSignal): Promise<unknown>;
  instance(binding: ReviewBinding, signal: AbortSignal): Promise<unknown>;
  attachment(fileCode: string, binding: ReviewBinding, signal: AbortSignal): AsyncIterable<Buffer>;
};

function record(raw: unknown, keys: string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || Object.keys(raw).length !== keys.length || keys.some(k => !Object.hasOwn(raw, k))) {
    throw new IntakeRejection('APPROVAL_BINDING');
  }
  return raw as Record<string, unknown>;
}
function id(raw: unknown): string { return parseContractSchema('IntakeId', raw); }
function instant(raw: unknown): string {
  if (typeof raw !== 'string' || !Number.isFinite(Date.parse(raw)) || new Date(raw).toISOString() !== raw) {
    throw new IntakeRejection('HUMAN_REVIEW_REQUIRED');
  }
  return raw;
}
function fileCode(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 512 || [...raw].some(c => c.charCodeAt(0)<32)) {
    throw new IntakeRejection('ATTACHMENT_UNVERIFIED');
  }
  return raw;
}

export function reviewForm(binding: ReviewBinding) {
  return 'key' in binding
    ? { reviewRequestId: binding.reviewRequestId, key: binding.key, packageSha256: binding.packageSha256 }
    : { reviewRequestId: binding.reviewRequestId, rollbackPlanId: binding.rollbackPlanId, impactDigest: binding.impactDigest, packageSha256: binding.packageSha256 };
}

/** Hides provider I/O, strict binding validation and streamed attachment verification.
 * Database eligibility and the five-minute validity window belong to the evidence owner. */
export function createApprovalAdapter(route: ReviewRoute, transport: ApprovalTransport) {
  const trusted = Object.freeze({ tenantId: id(route.tenantId), appId: id(route.appId),
    definitionId: id(route.definitionId), nodeId: id(route.nodeId) });
  function checkRoute(binding: ReviewBinding): void {
    if (Object.entries(trusted).some(([key, value]) => Reflect.get(binding, key) !== value)) throw new IntakeRejection('APPROVAL_BINDING');
  }
  async function bounded<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([work(controller.signal), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new IntakeRejection('APPROVAL_UNAVAILABLE', 'OVERLOADED')); }, 30_000);
      })]);
    } finally { clearTimeout(timer); controller.abort(); }
  }
  return {
    route: trusted,
    async create(binding: ReviewBinding, bytes: Buffer): Promise<{ instanceCode: string; attachmentFileCode: string }> {
      checkRoute(binding);
      if (bytes.length !== binding.packageBytes || digest(bytes) !== binding.packageSha256) throw new IntakeRejection('ATTACHMENT_UNVERIFIED');
      return bounded(async signal => {
        const raw = record(await transport.create(binding, bytes, signal), ['instanceCode', 'attachmentFileCode']);
        return { instanceCode: id(raw.instanceCode), attachmentFileCode: fileCode(raw.attachmentFileCode) };
      });
    },
    async observe(binding: ReviewBinding): Promise<ApprovalObservation> {
      checkRoute(binding);
      if (!binding.instanceCode || !binding.attachmentFileCode) throw new IntakeRejection('APPROVAL_UNAVAILABLE');
      return bounded(async signal => {
        const raw = record(await transport.instance(binding, signal), ['tenantId','appId','definitionId','nodeId','createUuid',
          'instanceCode','form','attachmentFileCode','state','task','timeline']);
        for (const key of ['tenantId','appId','definitionId','nodeId','createUuid','instanceCode','attachmentFileCode'] as const) {
          if (raw[key] !== binding[key]) throw new IntakeRejection('APPROVAL_BINDING');
        }
        const form = record(raw.form, 'key' in binding ? ['reviewRequestId','key','packageSha256']
          : ['reviewRequestId','rollbackPlanId','impactDigest','packageSha256']);
        if ('key' in binding) parseContractSchema('IntakeCandidateKey',form.key);
        else { id(form.rollbackPlanId); parseContractSchema('IntakeDigest',form.impactDigest); }
        if (canonical(form as Parameters<typeof canonical>[0]) !== canonical(reviewForm(binding))) throw new IntakeRejection('APPROVAL_BINDING');
        if (!['PENDING','APPROVED','REJECTED','REVOKED'].includes(String(raw.state))) throw new IntakeRejection('HUMAN_REVIEW_REQUIRED');
        const rawDigest = digest(canonical(raw as Parameters<typeof canonical>[0]));
        if (raw.state !== 'APPROVED') {
          const state = ({ REVOKED:'revoked',REJECTED:'rejected',PENDING:'pending' } as const)[raw.state as 'REVOKED'|'REJECTED'|'PENDING'];
          return { state,rawDigest,packageSha256:null,human:null };
        }
        const task = record(raw.task, ['taskId','nodeId','kind','status','identityScope','personKey','endTime']);
        if (task.kind !== 'HUMAN' || task.status !== 'APPROVED' || task.nodeId !== binding.nodeId) throw new IntakeRejection('HUMAN_REVIEW_REQUIRED');
        const human = { taskId: id(task.taskId), identityScope: id(task.identityScope), personKey: id(task.personKey), decidedAt: instant(task.endTime) };
        if (Date.parse(human.decidedAt)<Date.parse(binding.createdAt)) throw new IntakeRejection('HUMAN_REVIEW_REQUIRED');
        if (!Array.isArray(raw.timeline) || raw.timeline.length !== 1) throw new IntakeRejection('HUMAN_REVIEW_REQUIRED');
        const pass = record(raw.timeline[0], ['type','taskId','identityScope','personKey','time']);
        if (pass.type !== 'PASS' || pass.taskId !== human.taskId || pass.identityScope !== human.identityScope
          || pass.personKey !== human.personKey || instant(pass.time) !== human.decidedAt) throw new IntakeRejection('HUMAN_REVIEW_REQUIRED');
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of transport.attachment(binding.attachmentFileCode!, binding, signal)) {
          if (signal.aborted || !Buffer.isBuffer(chunk)) throw new IntakeRejection('ATTACHMENT_UNVERIFIED');
          size += chunk.length;
          if (size > binding.packageBytes || size > INTAKE_POLICY.outputBytes) throw new IntakeRejection('ATTACHMENT_UNVERIFIED');
          chunks.push(chunk);
        }
        if (size !== binding.packageBytes || digest(Buffer.concat(chunks, size)) !== binding.packageSha256) throw new IntakeRejection('ATTACHMENT_UNVERIFIED');
        return { state: 'approved', rawDigest, packageSha256: binding.packageSha256, human };
      });
    },
  };
}
export type ApprovalAdapter = ReturnType<typeof createApprovalAdapter>;
