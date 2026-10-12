import { authorize, authorizationExpiry, fresh, type Authority, type Principal, type Scope, type Decision } from './permissions.js';
import { jcs, sha256, type JsonValue } from '../../tests/support/g1a-e0/content-identity.js';

export const APPROVAL_MAX_AGE_MS = 300_000;
export const TICKET_MAX_AGE_MS = 60_000;
export const RISK_POLICY_VERSION = 'p1-risk-1';
type Entry = Readonly<{ id: string; title: string; body: string; disabled: boolean; critical: boolean; version: number }>;
export type Materials = Readonly<{
  entries: readonly Entry[]; differences: readonly Readonly<{ id: string; before: Entry | null; after: Entry }>[];
  questions: readonly Readonly<{ id: string; text: string; version: number }>[];
  selectedSheets: readonly string[]; templateVersion: string; ruleVersion: string; mappingProfile: string;
  source: Readonly<{ id: string; claimedRevision: string | null; fileSha256: string }>;
  scope: Scope; vocabulary: readonly Readonly<{ id: string; version: number }>[];
  media: readonly Readonly<{ sha256: string; required: boolean; alt: string }>[];
  contributors: readonly string[]; risk: 'routine' | 'critical'; riskPolicyVersion: typeof RISK_POLICY_VERSION;
  baseReleaseId: string | null;
}>;

// This is the PROPOSED candidate-material digest, not a replacement for the existing
// governance hash. The formal canonical encoding needs versioned contract intake.
export const materialDigest = (material: Materials): string => sha256(`candidate-p1.1\n${jcs(material as unknown as JsonValue)}`);

/** Missing IDs inherit. Only explicit incoming changes can disable an entry. */
export function mergeEntries(published: readonly Entry[], incoming: readonly Entry[]): readonly Entry[] {
  if (!incoming.length || new Set(incoming.map((e) => e.id)).size !== incoming.length) throw new Error('INVALID_BATCH');
  const result = new Map(published.map((e) => [e.id, e]));
  incoming.forEach((e) => result.set(e.id, e));
  return [...result.values()];
}
export function assessRisk(changes: Materials['differences'], recentDisables: readonly Readonly<{ sourceId: string; at: number; count: number }>[], sourceId: string, now: number): Materials['risk'] {
  const disabled = changes.filter((c) => c.before !== null && !c.before.disabled && c.after.disabled).length;
  const recent = recentDisables.filter((e) => e.sourceId === sourceId && e.at > now - 86_400_000 && e.at <= now).reduce((sum, e) => sum + e.count, 0);
  return disabled + recent >= 2 || changes.some((c) => c.before?.critical || c.after.critical
    || [c.before?.title ?? '', c.before?.body ?? '', c.after.title, c.after.body].some((text) => /过敏|赔付/u.test(text))) ? 'critical' : 'routine';
}
export type Candidate = Readonly<{ id: string; version: number; digest: string; materials: Materials; status: 'awaiting-evidence' | 'ready' | 'publishing' | 'published' | 'cancelled' | 'invalidated' }>;
export type CandidateInput = Omit<Materials, 'risk' | 'riskPolicyVersion' | 'differences'>;
export function freezeCandidate(id: string, version: number, material: CandidateInput,
  riskFacts: Readonly<{ publishedEntries: readonly Entry[]; recentDisables: Parameters<typeof assessRisk>[1]; now: number }>): Candidate {
  if (!id || !Number.isSafeInteger(version) || version < 1 || !material.contributors.length
    || material.contributors.some((p) => !p) || !Number.isSafeInteger(riskFacts.now)) throw new Error('INVALID_MATERIAL');
  // One registered source owns a candidate. A grant may cover all sources, but the
  // candidate must bind the exact same source for authorization, risk and confirmation.
  if (!material.source.id || material.scope.source !== material.source.id) throw new Error('INVALID_MATERIAL');
  const previous = new Map(riskFacts.publishedEntries.map((entry) => [entry.id, entry]));
  const next = new Map(material.entries.map((entry) => [entry.id, entry]));
  if (!next.size || next.size !== material.entries.length || previous.size !== riskFacts.publishedEntries.length
    || [...previous.keys()].some((key) => !next.has(key))) throw new Error('INVALID_MATERIAL');
  // The owner computes changes from complete server snapshots. A caller cannot omit a
  // critical change from a separate diff and thereby downgrade it to self-review.
  const differences: Materials['differences'] = material.entries.flatMap((after) => {
    const before = previous.get(after.id) ?? null;
    return before && jcs(before) === jcs(after) ? [] : [{ id: after.id, before, after }];
  });
  // Copy/freeze the snapshot so a retained caller reference cannot change approved text.
  const freeze = (value: unknown): void => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  };
  const copy: Materials = structuredClone({ ...material, differences,
    risk: assessRisk(differences, riskFacts.recentDisables, material.source.id, riskFacts.now), riskPolicyVersion: RISK_POLICY_VERSION }); freeze(copy);
  return Object.freeze({ id, version, digest: materialDigest(copy), materials: copy, status: 'awaiting-evidence' });
}
export type ReviewBinding = Readonly<{
  tenant: string; app: string; instanceCode: string; uuid: string; definitionCode: string; nodeId: string;
  candidateId: string; version: number; digest: string; reviewRequestId: string;
  materialObjectSha256: string; fileCode: string; createdAt: number;
}>;
export type AttachmentProof = Readonly<{ instanceCode: string; reference: string; sha256: string; checkedAt: number }>;
export type Reviewer = Readonly<{ openId: string; atReview: Principal; current: Principal; notContributor: boolean }>;
export type VerifiedEvidence = Readonly<{
  candidateId: string; version: number; digest: string; instanceCode: string; evidenceVersion: number;
  generation: number; checkedAt: number; validUntil: number; reviewerPerson: string;
  reviewerId: string; reviewerVersion: number; reviewerGeneration: number;
}>;
function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
const reject = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/** Consumes official get-instance shaped synthetic fixtures plus independently obtained
 * server facts. tenant/app belong to the authenticated adapter context, not remote JSON.
 * Attachment addresses from the response must be fetched by a future bounded allowlisted
 * adapter; this experiment accepts only the resulting byte-hash proof. Never fetch here. */
export function verifyApproval(candidate: Candidate, binding: ReviewBinding, response: unknown, facts: Readonly<{
  tenant: string; app: string; attachments: readonly AttachmentProof[]; reviewers: readonly Reviewer[];
  historicalAuthority: Authority; currentAuthority: Authority; now: number; evidenceVersion: number; generation: number;
}>): Readonly<{ ok: true; evidence: VerifiedEvidence }> | Readonly<{ ok: false; reason: string }> {
  const now = facts.now, material = candidate.materials;
  if (!Number.isSafeInteger(now) || candidate.status === 'invalidated' || candidate.status === 'cancelled'
    || materialDigest(material) !== candidate.digest || binding.candidateId !== candidate.id || binding.version !== candidate.version || binding.digest !== candidate.digest) return reject('MATERIAL_CHANGED');
  if (facts.tenant !== binding.tenant || facts.app !== binding.app || material.scope.tenant !== binding.tenant || material.scope.app !== binding.app) return reject('APPROVAL_SCOPE');
  const wrapper = object(response), data = object(wrapper?.data);
  if (wrapper?.code !== 0 || !data) return reject('APPROVAL_UNAVAILABLE');
  if (data.instance_code !== binding.instanceCode || data.uuid !== binding.uuid || data.approval_code !== binding.definitionCode
    || data.modified_instance_code || data.reverted_instance_code || data.reverted === true) return reject('APPROVAL_BINDING');
  if (data.status !== 'APPROVED') return reject(data.status === 'PENDING' ? 'AWAITING_APPROVAL' : 'APPROVAL_REVOKED');
  let form: unknown;
  if (typeof data.form !== 'string') return reject('APPROVAL_FORM');
  try { form = JSON.parse(data.form); } catch { return reject('APPROVAL_FORM'); }
  if (!Array.isArray(form) || !form.every(object)) return reject('APPROVAL_FORM');
  const controls = form.map((c) => object(c)!);
  if (new Set(controls.map((c) => c.id)).size !== controls.length) return reject('APPROVAL_FORM');
  for (const [id, value] of Object.entries({ candidateDigest: candidate.digest, reviewRequestId: binding.reviewRequestId, candidateId: candidate.id, candidateVersion: String(candidate.version) })) {
    const control = controls.find((c) => c.id === id);
    if (control?.type !== 'input' || control.value !== value) return reject('APPROVAL_FORM');
  }
  const attachment = controls.find((c) => c.id === 'materials');
  const refs = attachment?.value;
  if (attachment?.type !== 'attachmentV2' || !Array.isArray(refs) || refs.length !== 1 || typeof refs[0] !== 'string') return reject('ATTACHMENT_UNVERIFIED');
  const proof = facts.attachments.find((p) => p.instanceCode === binding.instanceCode && p.reference === refs[0]
    && p.sha256 === binding.materialObjectSha256 && Number.isSafeInteger(p.checkedAt) && p.checkedAt <= now && now < p.checkedAt + APPROVAL_MAX_AGE_MS);
  if (!proof) return reject('ATTACHMENT_UNVERIFIED');
  if (!Array.isArray(data.task_list) || !Array.isArray(data.timeline)) return reject('HUMAN_REVIEW_REQUIRED');
  for (const raw of data.task_list) {
    const task = object(raw);
    if (!task || typeof task.id !== 'string' || !task.id || task.status !== 'APPROVED'
      || typeof task.type !== 'string' || !['AND', 'OR', 'SEQUENTIAL'].includes(task.type)
      || task.node_id !== binding.nodeId || typeof task.open_id !== 'string' || !task.open_id) continue;
    const end = typeof task.end_time === 'string' && /^[0-9]+$/u.test(task.end_time) ? Number(task.end_time) : NaN;
    if (!Number.isSafeInteger(end) || end < binding.createdAt || end > now) continue;
    const pass = data.timeline.some((rawLine) => {
      const line = object(rawLine);
      return line?.type === 'PASS' && line.task_id === task.id && line.open_id === task.open_id
        && typeof line.create_time === 'string' && /^[0-9]+$/u.test(line.create_time) && Number(line.create_time) >= end && Number(line.create_time) <= now;
    });
    if (!pass) continue;
    const matches = facts.reviewers.filter((r) => r.openId === task.open_id);
    if (matches.length !== 1) continue;
    const reviewer = matches[0]!;
    if (reviewer.atReview.personKey !== reviewer.current.personKey
      || !authorize(reviewer.atReview, 'review', material.scope, facts.historicalAuthority, end).ok
      || !authorize(reviewer.current, 'review', material.scope, facts.currentAuthority, now).ok) continue;
    if (material.risk === 'critical' && (material.contributors.includes(reviewer.current.personKey) || !reviewer.notContributor)) continue;
    const reviewerUntil = authorizationExpiry(reviewer.current, 'review', material.scope, facts.currentAuthority, now)!;
    return { ok: true, evidence: { candidateId: candidate.id, version: candidate.version, digest: candidate.digest,
      instanceCode: binding.instanceCode, evidenceVersion: facts.evidenceVersion, generation: facts.generation,
      checkedAt: now, validUntil: Math.min(now + APPROVAL_MAX_AGE_MS, reviewerUntil, proof.checkedAt + APPROVAL_MAX_AGE_MS),
      reviewerPerson: reviewer.current.personKey, reviewerId: reviewer.current.id,
      reviewerVersion: reviewer.current.version, reviewerGeneration: reviewer.current.generation } };
  }
  return reject('HUMAN_REVIEW_REQUIRED');
}

export type SourceConfirmation = Readonly<{ candidateId: string; version: number; digest: string;
  sourceId: string; evidenceVersion: number; generation: number; confirmed: boolean }>;
function confirmedSource(candidate: Candidate, confirmation: SourceConfirmation | null): boolean {
  return confirmation !== null && confirmation.confirmed && confirmation.candidateId === candidate.id
    && confirmation.version === candidate.version && confirmation.digest === candidate.digest
    && confirmation.sourceId === candidate.materials.source.id && Number.isSafeInteger(confirmation.evidenceVersion)
    && confirmation.evidenceVersion > 0 && Number.isSafeInteger(confirmation.generation) && confirmation.generation >= 0;
}
export function attachEvidence(candidate: Candidate, evidence: VerifiedEvidence, confirmation: SourceConfirmation | null, now: number): Candidate {
  if (candidate.status !== 'awaiting-evidence' && candidate.status !== 'ready') return candidate;
  const valid = evidence.candidateId === candidate.id && evidence.version === candidate.version && evidence.digest === candidate.digest
    && evidence.checkedAt <= now && now < evidence.validUntil && evidence.validUntil <= evidence.checkedAt + APPROVAL_MAX_AGE_MS;
  return { ...candidate, status: valid && confirmedSource(candidate, confirmation) ? 'ready' : 'awaiting-evidence' };
}
export type Ticket = Readonly<{ candidateId: string; version: number; digest: string; principalId: string;
  principalVersion: number; principalGeneration: number; evidenceVersion: number; evidenceGeneration: number;
  sourceVersion: number; sourceGeneration: number;
  issuedAt: number; expiresAt: number }>;
function reviewerCurrent(candidate: Candidate, evidence: VerifiedEvidence, reviewer: Principal, authority: Authority, now: number): boolean {
  return reviewer.id === evidence.reviewerId && reviewer.personKey === evidence.reviewerPerson
    && reviewer.version === evidence.reviewerVersion && reviewer.generation === evidence.reviewerGeneration
    && authorize(reviewer, 'review', candidate.materials.scope, authority, now).ok
    && (candidate.materials.risk !== 'critical' || !candidate.materials.contributors.includes(reviewer.personKey));
}
export type PublicationFacts = Readonly<{ publisher: Principal; reviewer: Principal; evidence: VerifiedEvidence;
  confirmation: SourceConfirmation; authority: Authority; now: number }>;
export function issueTicket(candidate: Candidate, facts: PublicationFacts): Ticket | null {
  const { publisher: principal, evidence, confirmation, reviewer, authority, now } = facts;
  if (candidate.status !== 'ready' || attachEvidence(candidate, evidence, confirmation, now).status !== 'ready'
    || !reviewerCurrent(candidate, evidence, reviewer, authority, now)
    || !authorize(principal, 'publish', candidate.materials.scope, authority, now).ok) return null;
  return { candidateId: candidate.id, version: candidate.version, digest: candidate.digest, principalId: principal.id,
    principalVersion: principal.version, principalGeneration: principal.generation,
    evidenceVersion: evidence.evidenceVersion, evidenceGeneration: evidence.generation, issuedAt: now,
    sourceVersion: confirmation.evidenceVersion, sourceGeneration: confirmation.generation,
    expiresAt: Math.min(now + TICKET_MAX_AGE_MS, authorizationExpiry(principal, 'publish', candidate.materials.scope, authority, now)!, evidence.validUntil) };
}
/** Commit-point predicate only: P2 must consume once and atomically write candidate,
 * release, announcement and idempotency under existing DB locks. No remote I/O here. */
export function canCommit(candidate: Candidate, ticket: Ticket, facts: PublicationFacts & Readonly<{
  currentReleaseId: string | null; consumed: boolean;
}>): Decision {
  const { publisher: principal, evidence, confirmation, reviewer, authority, now, currentReleaseId, consumed } = facts;
  if (consumed) return reject('TICKET_CONSUMED');
  if (candidate.status !== 'ready' || candidate.id !== ticket.candidateId || candidate.version !== ticket.version
    || candidate.digest !== ticket.digest || materialDigest(candidate.materials) !== ticket.digest) return reject('MATERIAL_CHANGED');
  if (currentReleaseId !== candidate.materials.baseReleaseId) return reject('BASE_CHANGED');
  if (!Number.isSafeInteger(ticket.issuedAt) || !Number.isSafeInteger(ticket.expiresAt)
    || ticket.expiresAt <= ticket.issuedAt || ticket.expiresAt > ticket.issuedAt + TICKET_MAX_AGE_MS
    || now < ticket.issuedAt || now >= ticket.expiresAt) return reject('TICKET_EXPIRED');
  if (!fresh(principal, now) || principal.id !== ticket.principalId || principal.version !== ticket.principalVersion || principal.generation !== ticket.principalGeneration) return reject('PERMISSION_CHANGED');
  if (evidence.evidenceVersion !== ticket.evidenceVersion || evidence.generation !== ticket.evidenceGeneration
    || !reviewerCurrent(candidate, evidence, reviewer, authority, now)
    || attachEvidence(candidate, evidence, confirmation, now).status !== 'ready') return reject('APPROVAL_CHANGED');
  if (confirmation.evidenceVersion !== ticket.sourceVersion || confirmation.generation !== ticket.sourceGeneration) return reject('SOURCE_CONFIRMATION_CHANGED');
  return authorize(principal, 'publish', candidate.materials.scope, authority, now);
}
/** A failed refresh cannot extend any deadline. All referenced evidence is required. */
export function usageDeadline(orgUntil: number, evidenceUntil: readonly number[], contentUntil: number, leaseUntil: number): number | null {
  const deadlines = [orgUntil, ...evidenceUntil, contentUntil, leaseUntil];
  return evidenceUntil.length && deadlines.every(Number.isFinite) ? Math.min(...deadlines) : null;
}
